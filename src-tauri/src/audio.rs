//! Motor de audio en Rust: symphonia decodifica y cpal reproduce.
//!
//! Arquitectura:
//! - hilo de salida: posee el stream de cpal (que no es `Send`) y lo mantiene vivo;
//! - hilo decodificador: abre la pista actual y la siguiente (ya preparada),
//!   decodifica, remuestrea y vuelca en un búfer circular compartido. Al acabar
//!   la actual continúa sin pausa con la siguiente (gapless);
//! - hilo de estado: cada 200 ms calcula posición, avisa de cambios de pista y del final.

use crate::rangecache::{HttpFetcher, RangeSource, TROZO_POR_DEFECTO};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::VecDeque;
use std::fs::File;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender, TryRecvError};
use std::sync::Arc;
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::{MediaSource, MediaSourceStream};
use symphonia::core::meta::{MetadataOptions, MetadataRevision, StandardTagKey};
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

/// Segundos de audio que se mantienen decodificados por delante.
const SEGUNDOS_BUFER: usize = 4;

#[derive(Clone, Debug)]
pub enum Origen {
    Http { url: String },
    Archivo { ruta: PathBuf },
}

#[derive(Clone, Debug)]
pub struct Pista {
    pub id: String,
    pub origen: Origen,
    pub ext: Option<String>,
    /// Ganancia (dB) que viene del servidor; solo se usa si las etiquetas no traen ReplayGain.
    pub ganancia_db: Option<f32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "tipo", rename_all = "camelCase")]
pub enum Evento {
    #[serde(rename_all = "camelCase")]
    Estado { id: Option<String>, posicion: f64, duracion: f64, reproduciendo: bool },
    #[serde(rename_all = "camelCase")]
    PistaCambiada { id: String },
    Terminada,
    #[serde(rename_all = "camelCase")]
    Error { id: Option<String>, mensaje: String },
}

pub type Emisor = Arc<dyn Fn(Evento) + Send + Sync>;

// ---------------------------------------------------------------- estado compartido

struct Segmento {
    inicio: u64, // fotograma de la línea temporal de salida donde empieza
    id: String,
    desplazamiento: f64,
    duracion: f64,
}

struct Anillo {
    buf: VecDeque<f32>,
    reproducidos: u64,
    empujados: u64,
    segmentos: VecDeque<Segmento>,
}

struct Compartido {
    anillo: Mutex<Anillo>,
    pausa: AtomicBool,
    volumen: AtomicU32,
    inactivo: AtomicBool,
    activo: AtomicBool,
    tasa: u32,
    canales: usize,
}

enum Orden {
    Reproducir(Pista, f64),
    Siguiente(Option<Pista>),
    Buscar(f64),
    Parar,
}

pub struct Motor {
    tx: Sender<Orden>,
    sh: Arc<Compartido>,
}

impl Motor {
    pub fn nuevo(emit: Emisor) -> Result<Motor, String> {
        let (tx_cfg, rx_cfg) = mpsc::channel::<Result<(u32, usize), String>>();
        let (tx_stream, rx_stream) = mpsc::channel::<Arc<Compartido>>();

        // Hilo de salida: crea y retiene el stream.
        std::thread::Builder::new()
            .name("audio-salida".into())
            .spawn(move || {
                let host = cpal::default_host();
                let Some(device) = host.default_output_device() else {
                    let _ = tx_cfg.send(Err("No hay ningún dispositivo de salida de audio.".into()));
                    return;
                };
                let cfg = match device.default_output_config() {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = tx_cfg.send(Err(format!("No se pudo configurar la salida de audio: {e}")));
                        return;
                    }
                };
                let tasa = cfg.sample_rate().0;
                let canales = cfg.channels() as usize;
                let _ = tx_cfg.send(Ok((tasa, canales)));
                let Ok(sh) = rx_stream.recv() else { return };
                let scfg: cpal::StreamConfig = cfg.clone().into();
                let stream = match cfg.sample_format() {
                    SampleFormat::F32 => construir::<f32>(&device, &scfg, sh),
                    SampleFormat::I16 => construir::<i16>(&device, &scfg, sh),
                    SampleFormat::U16 => construir::<u16>(&device, &scfg, sh),
                    SampleFormat::I32 => construir::<i32>(&device, &scfg, sh),
                    otro => Err(format!("Formato de muestra no admitido: {otro:?}")),
                };
                match stream {
                    Ok(s) => {
                        if s.play().is_ok() {
                            // El stream vive mientras viva este hilo.
                            loop {
                                std::thread::park();
                            }
                        }
                    }
                    Err(e) => eprintln!("audio: {e}"),
                }
            })
            .map_err(|e| e.to_string())?;

        let (tasa, canales) = rx_cfg
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "El sistema de audio no responde.".to_string())??;

        let sh = Arc::new(Compartido {
            anillo: Mutex::new(Anillo {
                buf: VecDeque::with_capacity(tasa as usize * canales * SEGUNDOS_BUFER),
                reproducidos: 0,
                empujados: 0,
                segmentos: VecDeque::new(),
            }),
            pausa: AtomicBool::new(false),
            volumen: AtomicU32::new(1.0f32.to_bits()),
            inactivo: AtomicBool::new(true),
            activo: AtomicBool::new(false),
            tasa,
            canales,
        });
        let _ = tx_stream.send(sh.clone());

        let (tx, rx) = mpsc::channel::<Orden>();
        {
            let sh = sh.clone();
            let emit = emit.clone();
            std::thread::Builder::new()
                .name("audio-decodificador".into())
                .spawn(move || bucle_decodificador(rx, sh, emit))
                .map_err(|e| e.to_string())?;
        }
        {
            let sh = sh.clone();
            std::thread::Builder::new()
                .name("audio-estado".into())
                .spawn(move || bucle_estado(sh, emit))
                .map_err(|e| e.to_string())?;
        }
        Ok(Motor { tx, sh })
    }

    pub fn reproducir(&self, p: Pista, inicio: f64) {
        self.sh.pausa.store(false, Ordering::Relaxed);
        self.sh.inactivo.store(false, Ordering::Relaxed);
        let _ = self.tx.send(Orden::Reproducir(p, inicio));
    }
    pub fn siguiente(&self, p: Option<Pista>) {
        self.sh.inactivo.store(false, Ordering::Relaxed);
        let _ = self.tx.send(Orden::Siguiente(p));
    }
    pub fn pausa(&self, p: bool) {
        self.sh.pausa.store(p, Ordering::Relaxed);
    }
    pub fn buscar(&self, s: f64) {
        let _ = self.tx.send(Orden::Buscar(s));
    }
    pub fn volumen(&self, v: f32) {
        self.sh.volumen.store(v.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    }
    pub fn parar(&self) {
        let _ = self.tx.send(Orden::Parar);
    }
}

fn construir<T>(device: &cpal::Device, cfg: &cpal::StreamConfig, sh: Arc<Compartido>) -> Result<cpal::Stream, String>
where
    T: SizedSample + FromSample<f32>,
{
    device
        .build_output_stream(
            cfg,
            move |data: &mut [T], _| rellenar(data, &sh),
            |e| eprintln!("audio: error de salida: {e}"),
            None,
        )
        .map_err(|e| format!("No se pudo abrir la salida de audio: {e}"))
}

fn rellenar<T: Sample + FromSample<f32>>(data: &mut [T], sh: &Compartido) {
    let ch = sh.canales;
    let vol = f32::from_bits(sh.volumen.load(Ordering::Relaxed));
    let pausa = sh.pausa.load(Ordering::Relaxed);
    let mut i = 0;
    {
        let mut r = sh.anillo.lock();
        if !pausa {
            while i + ch <= data.len() && r.buf.len() >= ch {
                for c in 0..ch {
                    let v = r.buf.pop_front().unwrap_or(0.0);
                    data[i + c] = T::from_sample((v * vol).clamp(-1.0, 1.0));
                }
                i += ch;
                r.reproducidos += 1;
            }
        }
    }
    for x in data[i..].iter_mut() {
        *x = T::EQUILIBRIUM;
    }
}

// ---------------------------------------------------------------- hilo de estado

fn bucle_estado(sh: Arc<Compartido>, emit: Emisor) {
    loop {
        std::thread::sleep(Duration::from_millis(200));
        let mut cambio: Option<String> = None;
        let estado;
        let vacio;
        {
            let mut r = sh.anillo.lock();
            while r.segmentos.len() >= 2 && r.segmentos[1].inicio <= r.reproducidos {
                r.segmentos.pop_front();
                cambio = r.segmentos.front().map(|s| s.id.clone());
            }
            estado = r.segmentos.front().map(|s| {
                let pos = s.desplazamiento + (r.reproducidos.saturating_sub(s.inicio)) as f64 / sh.tasa as f64;
                (s.id.clone(), pos.min(if s.duracion > 0.0 { s.duracion } else { pos }), s.duracion)
            });
            vacio = r.buf.is_empty();
        }
        if let Some(id) = cambio {
            emit(Evento::PistaCambiada { id });
        }
        if let Some((id, pos, dur)) = estado {
            emit(Evento::Estado {
                id: Some(id),
                posicion: pos,
                duracion: dur,
                reproduciendo: !sh.pausa.load(Ordering::Relaxed) && !vacio,
            });
        }
        if sh.activo.load(Ordering::Relaxed) && sh.inactivo.load(Ordering::Relaxed) && vacio {
            sh.activo.store(false, Ordering::Relaxed);
            let mut r = sh.anillo.lock();
            r.segmentos.clear();
            drop(r);
            emit(Evento::Terminada);
        }
    }
}

// ---------------------------------------------------------------- hilo decodificador

fn bucle_decodificador(rx: mpsc::Receiver<Orden>, sh: Arc<Compartido>, emit: Emisor) {
    let tope = sh.tasa as usize * sh.canales * SEGUNDOS_BUFER;
    let mut actual: Option<Decod> = None;
    let mut siguiente: Option<Decod> = None;
    let mut salida: Vec<f32> = Vec::new();

    loop {
        let lleno = sh.anillo.lock().buf.len() >= tope;
        let espera = if actual.is_none() {
            Some(Duration::from_millis(100))
        } else if lleno {
            Some(Duration::from_millis(15))
        } else {
            None
        };
        let orden = match espera {
            Some(d) => match rx.recv_timeout(d) {
                Ok(o) => Some(o),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            },
            None => match rx.try_recv() {
                Ok(o) => Some(o),
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => return,
            },
        };

        if let Some(o) = orden {
            sh.inactivo.store(false, Ordering::Relaxed);
            match o {
                Orden::Reproducir(p, inicio) => {
                    vaciar(&sh);
                    actual = None;
                    siguiente = None;
                    match Decod::abrir(&p, sh.tasa, sh.canales) {
                        Ok(mut d) => {
                            let mut off = 0.0;
                            if inicio > 0.5 && d.buscar(inicio).is_ok() {
                                off = inicio;
                            }
                            nuevo_segmento(&sh, &d, off);
                            sh.activo.store(true, Ordering::Relaxed);
                            actual = Some(d);
                        }
                        Err(e) => emit(Evento::Error { id: Some(p.id.clone()), mensaje: e }),
                    }
                }
                Orden::Siguiente(p) => {
                    siguiente = None;
                    if let Some(p) = p {
                        match Decod::abrir(&p, sh.tasa, sh.canales) {
                            Ok(d) => siguiente = Some(d),
                            Err(e) => emit(Evento::Error { id: Some(p.id.clone()), mensaje: e }),
                        }
                    }
                }
                Orden::Buscar(s) => {
                    if let Some(d) = actual.as_mut() {
                        match d.buscar(s) {
                            Ok(()) => {
                                vaciar(&sh);
                                nuevo_segmento(&sh, d, s);
                            }
                            Err(e) => emit(Evento::Error { id: Some(d.id.clone()), mensaje: e }),
                        }
                    }
                }
                Orden::Parar => {
                    vaciar(&sh);
                    actual = None;
                    siguiente = None;
                    sh.activo.store(false, Ordering::Relaxed);
                }
            }
            sh.inactivo.store(actual.is_none() && siguiente.is_none(), Ordering::Relaxed);
            continue;
        }

        // Si no hay pista actual pero sí siguiente (p. ej. tras un fallo), se promueve.
        if actual.is_none() {
            if let Some(n) = siguiente.take() {
                nuevo_segmento(&sh, &n, 0.0);
                sh.activo.store(true, Ordering::Relaxed);
                actual = Some(n);
            } else {
                sh.inactivo.store(true, Ordering::Relaxed);
            }
            continue;
        }
        if lleno {
            continue;
        }

        let d = actual.as_mut().unwrap();
        salida.clear();
        match d.paso(&mut salida) {
            Ok(fin) => {
                if !salida.is_empty() {
                    let mut r = sh.anillo.lock();
                    r.empujados += (salida.len() / sh.canales) as u64;
                    r.buf.extend(salida.iter().copied());
                }
                if fin {
                    // Gapless: la siguiente continúa justo detrás en la misma línea temporal.
                    actual = siguiente.take();
                    if let Some(n) = actual.as_ref() {
                        nuevo_segmento(&sh, n, 0.0);
                    } else {
                        sh.inactivo.store(true, Ordering::Relaxed);
                    }
                }
            }
            Err(e) => {
                let id = d.id.clone();
                emit(Evento::Error { id: Some(id), mensaje: e });
                actual = siguiente.take();
                if let Some(n) = actual.as_ref() {
                    nuevo_segmento(&sh, n, 0.0);
                }
            }
        }
    }
}

fn vaciar(sh: &Compartido) {
    let mut r = sh.anillo.lock();
    r.buf.clear();
    r.segmentos.clear();
    r.empujados = r.reproducidos;
}

fn nuevo_segmento(sh: &Compartido, d: &Decod, desplazamiento: f64) {
    let mut r = sh.anillo.lock();
    let inicio = r.empujados;
    r.segmentos.push_back(Segmento { inicio, id: d.id.clone(), desplazamiento, duracion: d.duracion });
}

// ---------------------------------------------------------------- decodificación

pub struct Decod {
    pub id: String,
    pub duracion: f64,
    format: Box<dyn FormatReader>,
    decoder: Box<dyn Decoder>,
    track_id: u32,
    sbuf: Option<SampleBuffer<f32>>,
    remuestreo: Option<Remuestreo>,
    ganancia: f32,
    tasa_salida: u32,
    canales_salida: usize,
    tmp: Vec<f32>,
}

/// Convierte «-6.50 dB» o «+3.2» a un número.
pub fn parsear_ganancia(s: &str) -> Option<f32> {
    let limpio = s.trim().trim_end_matches(|c: char| c.is_alphabetic() || c.is_whitespace());
    limpio.trim().parse::<f32>().ok().filter(|g| g.is_finite())
}

fn ganancia_de_revision(rev: &MetadataRevision) -> Option<f32> {
    let mut pista = None;
    for t in rev.tags() {
        let clave = t.key.to_ascii_uppercase();
        if t.std_key == Some(StandardTagKey::ReplayGainTrackGain) || clave == "REPLAYGAIN_TRACK_GAIN" {
            pista = parsear_ganancia(&t.value.to_string()).or(pista);
        }
    }
    pista
}

pub fn db_a_lineal(db: f32) -> f32 {
    10f32.powf(db / 20.0).clamp(0.05, 4.0)
}

impl Decod {
    pub fn abrir(p: &Pista, tasa_salida: u32, canales_salida: usize) -> Result<Decod, String> {
        let fuente: Box<dyn MediaSource> = match &p.origen {
            Origen::Archivo { ruta } => Box::new(File::open(ruta).map_err(|e| format!("No se pudo abrir el archivo: {e}"))?),
            Origen::Http { url } => {
                let http = reqwest::blocking::Client::builder()
                    .timeout(Duration::from_secs(30))
                    .connect_timeout(Duration::from_secs(10))
                    .build()
                    .map_err(|e| e.to_string())?;
                let f = HttpFetcher { url: url.clone(), http };
                Box::new(
                    RangeSource::nuevo(Box::new(f), TROZO_POR_DEFECTO)
                        .map_err(|e| format!("No se pudo leer la pista desde el servidor: {e}"))?,
                )
            }
        };
        let mss = MediaSourceStream::new(fuente, Default::default());
        let mut hint = Hint::new();
        if let Some(e) = &p.ext {
            hint.with_extension(e);
        }
        let fopts = FormatOptions { enable_gapless: true, ..Default::default() };
        let mut probed = symphonia::default::get_probe()
            .format(&hint, mss, &fopts, &MetadataOptions::default())
            .map_err(|e| format!("Formato de audio no reconocido: {e}"))?;
        let mut format = probed.format;

        let mut g_etiqueta = format.metadata().current().and_then(ganancia_de_revision);
        if g_etiqueta.is_none() {
            if let Some(m) = probed.metadata.get() {
                g_etiqueta = m.current().and_then(ganancia_de_revision);
            }
        }
        let ganancia = match g_etiqueta.or(p.ganancia_db) {
            Some(db) => db_a_lineal(db),
            None => 1.0,
        };

        let pista = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or("El archivo no contiene audio.")?;
        let track_id = pista.id;
        let duracion = match (pista.codec_params.n_frames, pista.codec_params.sample_rate) {
            (Some(n), Some(sr)) if sr > 0 => n as f64 / sr as f64,
            _ => 0.0,
        };
        let decoder = symphonia::default::get_codecs()
            .make(&pista.codec_params, &DecoderOptions::default())
            .map_err(|e| format!("Códec no compatible: {e}"))?;

        Ok(Decod {
            id: p.id.clone(),
            duracion,
            format,
            decoder,
            track_id,
            sbuf: None,
            remuestreo: None,
            ganancia,
            tasa_salida,
            canales_salida,
            tmp: Vec::new(),
        })
    }

    pub fn buscar(&mut self, segundos: f64) -> Result<(), String> {
        self.format
            .seek(
                SeekMode::Accurate,
                SeekTo::Time { time: Time::from(segundos.max(0.0)), track_id: Some(self.track_id) },
            )
            .map_err(|e| format!("No se pudo saltar a esa posición: {e}"))?;
        self.decoder.reset();
        self.remuestreo = None;
        Ok(())
    }

    /// Decodifica un paquete y añade las muestras (ya a la tasa y canales de
    /// salida) a `out`. Devuelve `true` cuando la pista ha terminado.
    pub fn paso(&mut self, out: &mut Vec<f32>) -> Result<bool, String> {
        loop {
            let paquete = match self.format.next_packet() {
                Ok(p) => p,
                Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(true),
                Err(SymError::ResetRequired) => return Ok(true),
                Err(e) => return Err(format!("Error al leer la pista: {e}")),
            };
            if paquete.track_id() != self.track_id {
                continue;
            }
            let decodificado = match self.decoder.decode(&paquete) {
                Ok(d) => d,
                Err(SymError::DecodeError(_)) => continue, // paquete dañado: se omite
                Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(true),
                Err(e) => return Err(format!("Error al decodificar: {e}")),
            };
            let spec = *decodificado.spec();
            let ch_in = spec.channels.count().max(1);
            let necesario = decodificado.capacity() * ch_in;
            if self.sbuf.as_ref().map_or(true, |b| b.capacity() < necesario) {
                self.sbuf = Some(SampleBuffer::new(decodificado.capacity() as u64, spec));
            }
            let sb = self.sbuf.as_mut().unwrap();
            sb.copy_interleaved_ref(decodificado);
            let muestras = sb.samples();
            if muestras.is_empty() {
                continue;
            }

            // Mapeo de canales a los de la salida.
            self.tmp.clear();
            mapear_canales(muestras, ch_in, self.canales_salida, &mut self.tmp);

            let g = self.ganancia;
            if spec.rate == self.tasa_salida {
                out.extend(self.tmp.iter().map(|v| v * g));
            } else {
                let rs = self
                    .remuestreo
                    .get_or_insert_with(|| Remuestreo::nuevo(spec.rate, self.tasa_salida, self.canales_salida));
                rs.procesar(&self.tmp, out, g);
            }
            return Ok(false);
        }
    }
}

pub fn mapear_canales(entrada: &[f32], ch_in: usize, ch_out: usize, out: &mut Vec<f32>) {
    let n = entrada.len() / ch_in;
    out.reserve(n * ch_out);
    if ch_in == ch_out {
        out.extend_from_slice(&entrada[..n * ch_in]);
        return;
    }
    for f in 0..n {
        let marco = &entrada[f * ch_in..(f + 1) * ch_in];
        if ch_in == 1 {
            for _ in 0..ch_out {
                out.push(marco[0]);
            }
        } else if ch_out == 1 {
            out.push(marco.iter().sum::<f32>() / ch_in as f32);
        } else {
            for c in 0..ch_out {
                out.push(marco.get(c).copied().unwrap_or(0.0));
            }
        }
    }
}

/// Remuestreo lineal entre dos tasas (suficiente para escuchar; sin filtro anti-alias).
pub struct Remuestreo {
    paso: f64,
    pos: f64,
    canales: usize,
    ultimo: Option<Vec<f32>>,
}

impl Remuestreo {
    pub fn nuevo(tasa_in: u32, tasa_out: u32, canales: usize) -> Self {
        Remuestreo { paso: tasa_in as f64 / tasa_out as f64, pos: 0.0, canales, ultimo: None }
    }

    pub fn procesar(&mut self, entrada: &[f32], out: &mut Vec<f32>, ganancia: f32) {
        let ch = self.canales;
        let n = entrada.len() / ch;
        if n == 0 {
            return;
        }
        // Secuencia virtual s = [ultimo] + entrada
        let primero = self.ultimo.is_none();
        let ultimo = self.ultimo.take().unwrap_or_else(|| entrada[..ch].to_vec());
        let total = n + 1;
        let muestra = |i: usize, c: usize| -> f32 {
            if i == 0 {
                ultimo[c]
            } else {
                entrada[(i - 1) * ch + c]
            }
        };
        let mut p = if primero { 1.0 } else { self.pos };
        if primero {
            // El primer fotograma real es el índice 1 de la secuencia.
            p = 1.0;
        }
        while p + 1.0 < total as f64 + 0.0 && (p.floor() as usize) + 1 < total {
            let i = p.floor() as usize;
            let frac = (p - i as f64) as f32;
            for c in 0..ch {
                let a = muestra(i, c);
                let b = muestra(i + 1, c);
                out.push((a + (b - a) * frac) * ganancia);
            }
            p += self.paso;
        }
        self.pos = p - n as f64;
        self.ultimo = Some(entrada[(n - 1) * ch..n * ch].to_vec());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// WAV PCM 16 bits con una onda senoidal.
    fn wav(tasa: u32, canales: u16, segundos: f32) -> Vec<u8> {
        let n = (tasa as f32 * segundos) as usize;
        let mut datos = Vec::with_capacity(n * canales as usize * 2);
        for i in 0..n {
            let v = ((i as f32 * 440.0 * std::f32::consts::TAU / tasa as f32).sin() * 12000.0) as i16;
            for _ in 0..canales {
                datos.extend_from_slice(&v.to_le_bytes());
            }
        }
        let mut w = Vec::new();
        w.extend_from_slice(b"RIFF");
        w.extend_from_slice(&(36 + datos.len() as u32).to_le_bytes());
        w.extend_from_slice(b"WAVEfmt ");
        w.extend_from_slice(&16u32.to_le_bytes());
        w.extend_from_slice(&1u16.to_le_bytes());
        w.extend_from_slice(&canales.to_le_bytes());
        w.extend_from_slice(&tasa.to_le_bytes());
        w.extend_from_slice(&(tasa * canales as u32 * 2).to_le_bytes());
        w.extend_from_slice(&(canales * 2).to_le_bytes());
        w.extend_from_slice(&16u16.to_le_bytes());
        w.extend_from_slice(b"data");
        w.extend_from_slice(&(datos.len() as u32).to_le_bytes());
        w.extend_from_slice(&datos);
        w
    }

    fn pista_wav(dir: &tempfile::TempDir, nombre: &str, bytes: &[u8], ganancia: Option<f32>) -> Pista {
        let ruta = dir.path().join(nombre);
        std::fs::write(&ruta, bytes).unwrap();
        Pista { id: nombre.into(), origen: Origen::Archivo { ruta }, ext: Some("wav".into()), ganancia_db: ganancia }
    }

    fn decodificar_todo(d: &mut Decod) -> Vec<f32> {
        let mut todo = vec![];
        loop {
            let fin = d.paso(&mut todo).unwrap();
            if fin {
                break;
            }
        }
        todo
    }

    #[test]
    fn decodifica_y_convierte_mono_44100_a_estereo_48000() {
        let dir = tempfile::tempdir().unwrap();
        let p = pista_wav(&dir, "a.wav", &wav(44100, 1, 1.0), None);
        let mut d = Decod::abrir(&p, 48000, 2).unwrap();
        assert!((d.duracion - 1.0).abs() < 0.01);
        let s = decodificar_todo(&mut d);
        let fotogramas = s.len() / 2;
        assert!((fotogramas as i64 - 48000).abs() < 200, "fotogramas: {fotogramas}");
        // Mono duplicado a los dos canales.
        assert!(s.chunks(2).all(|c| (c[0] - c[1]).abs() < 1e-6));
        assert!(s.iter().any(|v| v.abs() > 0.2), "debe haber señal");
    }

    #[test]
    fn sin_conversion_si_las_tasas_coinciden() {
        let dir = tempfile::tempdir().unwrap();
        let p = pista_wav(&dir, "b.wav", &wav(48000, 2, 0.5), None);
        let mut d = Decod::abrir(&p, 48000, 2).unwrap();
        let s = decodificar_todo(&mut d);
        assert_eq!(s.len(), 48000);
    }

    #[test]
    fn saltar_a_la_mitad_devuelve_la_mitad() {
        let dir = tempfile::tempdir().unwrap();
        let p = pista_wav(&dir, "c.wav", &wav(48000, 2, 2.0), None);
        let mut d = Decod::abrir(&p, 48000, 2).unwrap();
        d.buscar(1.0).unwrap();
        let s = decodificar_todo(&mut d);
        let fotogramas = s.len() / 2;
        assert!((fotogramas as i64 - 48000).abs() < 4096, "fotogramas: {fotogramas}");
    }

    #[test]
    fn ganancia_del_servidor_se_aplica_si_no_hay_etiqueta() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = wav(48000, 2, 0.2);
        let sin = pista_wav(&dir, "d1.wav", &bytes, None);
        let con = pista_wav(&dir, "d2.wav", &bytes, Some(-6.0));
        let a = decodificar_todo(&mut Decod::abrir(&sin, 48000, 2).unwrap());
        let b = decodificar_todo(&mut Decod::abrir(&con, 48000, 2).unwrap());
        let pico = |v: &[f32]| v.iter().fold(0f32, |m, x| m.max(x.abs()));
        let relacion = pico(&b) / pico(&a);
        assert!((relacion - db_a_lineal(-6.0)).abs() < 0.02, "relación {relacion}");
    }

    #[test]
    fn sin_ganancia_no_se_toca_el_volumen() {
        let dir = tempfile::tempdir().unwrap();
        let p = pista_wav(&dir, "e.wav", &wav(48000, 2, 0.1), None);
        let d = Decod::abrir(&p, 48000, 2).unwrap();
        assert_eq!(d.ganancia, 1.0);
    }

    #[test]
    fn archivo_inexistente_o_basura_da_error_claro() {
        let dir = tempfile::tempdir().unwrap();
        let p = Pista { id: "x".into(), origen: Origen::Archivo { ruta: dir.path().join("no.wav") }, ext: None, ganancia_db: None };
        assert!(Decod::abrir(&p, 48000, 2).is_err());
        let basura = pista_wav(&dir, "f.wav", b"esto no es audio, ni de lejos, ni un poco", None);
        assert!(Decod::abrir(&basura, 48000, 2).is_err());
    }

    #[test]
    fn parseo_de_ganancias() {
        assert_eq!(parsear_ganancia("-6.50 dB"), Some(-6.5));
        assert_eq!(parsear_ganancia("+3.2"), Some(3.2));
        assert_eq!(parsear_ganancia(" -0.1dB "), Some(-0.1));
        assert_eq!(parsear_ganancia("nada"), None);
    }

    #[test]
    fn mapeo_de_canales() {
        let mut o = vec![];
        mapear_canales(&[1.0, 3.0, 2.0, 4.0], 2, 1, &mut o);
        assert_eq!(o, vec![2.0, 3.0]);
        o.clear();
        mapear_canales(&[0.5, 0.25], 1, 2, &mut o);
        assert_eq!(o, vec![0.5, 0.5, 0.25, 0.25]);
        o.clear();
        mapear_canales(&[1.0, 2.0], 2, 4, &mut o);
        assert_eq!(o, vec![1.0, 2.0, 0.0, 0.0]);
    }

    #[test]
    fn el_remuestreo_mantiene_la_duracion_por_bloques() {
        // Procesar en trozos pequeños debe dar prácticamente lo mismo que de golpe.
        let entrada: Vec<f32> = (0..44100).map(|i| (i as f32 * 0.01).sin()).collect();
        let mut de_golpe = vec![];
        Remuestreo::nuevo(44100, 48000, 1).procesar(&entrada, &mut de_golpe, 1.0);
        let mut por_trozos = vec![];
        let mut r = Remuestreo::nuevo(44100, 48000, 1);
        for c in entrada.chunks(1000) {
            r.procesar(c, &mut por_trozos, 1.0);
        }
        assert!((de_golpe.len() as i64 - por_trozos.len() as i64).abs() <= 2);
        assert!((de_golpe.len() as i64 - 48000).abs() < 10);
    }
}
