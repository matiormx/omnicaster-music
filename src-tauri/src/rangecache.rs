//! Fuente de bytes por HTTP con peticiones Range y búfer en disco.
//!
//! Se descarga por trozos (`chunk`) a un archivo temporal disperso. Leer o
//! saltar a cualquier punto solo pide los trozos necesarios, y un hilo de
//! precarga va rellenando por delante de la posición de lectura.

use parking_lot::{Condvar, Mutex};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub const TROZO_POR_DEFECTO: u64 = 128 * 1024;
const PRECARGA_TROZOS: u64 = 64; // ~8 MB por delante

pub trait RangeFetcher: Send + Sync + 'static {
    /// Devuelve `(bytes, longitud_total)` para el rango `[start, start+len)`.
    /// Puede devolver menos bytes si llega al final del recurso.
    fn fetch(&self, start: u64, len: u64) -> io::Result<(Vec<u8>, u64)>;
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Trozo {
    Vacio,
    Cargando,
    Listo,
}

struct Compartido {
    fetcher: Box<dyn RangeFetcher>,
    archivo: Mutex<File>,
    trozos: Mutex<Vec<Trozo>>,
    cv: Condvar,
    tam_trozo: u64,
    longitud: u64,
    parar: AtomicBool,
    cursor: AtomicU64,
    peticiones: AtomicUsize,
}

impl Compartido {
    fn asegurar(&self, idx: usize) -> io::Result<()> {
        loop {
            let mut t = self.trozos.lock();
            match t[idx] {
                Trozo::Listo => return Ok(()),
                Trozo::Cargando => {
                    self.cv.wait_for(&mut t, Duration::from_millis(200));
                    if self.parar.load(Ordering::Relaxed) {
                        return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelado"));
                    }
                }
                Trozo::Vacio => {
                    t[idx] = Trozo::Cargando;
                    drop(t);
                    let inicio = idx as u64 * self.tam_trozo;
                    let largo = self.tam_trozo.min(self.longitud - inicio);
                    self.peticiones.fetch_add(1, Ordering::Relaxed);
                    let res = self.fetcher.fetch(inicio, largo).and_then(|(datos, _)| {
                        if (datos.len() as u64) < largo {
                            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "respuesta incompleta del servidor"));
                        }
                        let mut f = self.archivo.lock();
                        f.seek(SeekFrom::Start(inicio))?;
                        f.write_all(&datos[..largo as usize])
                    });
                    let mut t = self.trozos.lock();
                    t[idx] = if res.is_ok() { Trozo::Listo } else { Trozo::Vacio };
                    self.cv.notify_all();
                    return res;
                }
            }
        }
    }
}

pub struct RangeSource {
    c: Arc<Compartido>,
    pos: u64,
}

impl RangeSource {
    /// Abre el recurso: pide el primer trozo para conocer la longitud total.
    pub fn nuevo(fetcher: Box<dyn RangeFetcher>, tam_trozo: u64) -> io::Result<Self> {
        let tam_trozo = tam_trozo.max(1024);
        let (primero, total) = fetcher.fetch(0, tam_trozo)?;
        let n = total.div_ceil(tam_trozo).max(1) as usize;
        let mut archivo = tempfile::tempfile()?;
        archivo.set_len(total)?;
        let mut trozos = vec![Trozo::Vacio; n];
        if total > 0 {
            let largo = tam_trozo.min(total) as usize;
            if primero.len() < largo {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "respuesta incompleta del servidor"));
            }
            archivo.write_all(&primero[..largo])?;
            trozos[0] = Trozo::Listo;
        }
        let c = Arc::new(Compartido {
            fetcher,
            archivo: Mutex::new(archivo),
            trozos: Mutex::new(trozos),
            cv: Condvar::new(),
            tam_trozo,
            longitud: total,
            parar: AtomicBool::new(false),
            cursor: AtomicU64::new(0),
            peticiones: AtomicUsize::new(1),
        });
        let c2 = c.clone();
        std::thread::Builder::new()
            .name("precarga-range".into())
            .spawn(move || precarga(c2))
            .ok();
        Ok(RangeSource { c, pos: 0 })
    }

    pub fn longitud(&self) -> u64 {
        self.c.longitud
    }

    /// Número de peticiones HTTP realizadas (para tests y diagnóstico).
    pub fn peticiones(&self) -> usize {
        self.c.peticiones.load(Ordering::Relaxed)
    }
}

fn precarga(c: Arc<Compartido>) {
    while !c.parar.load(Ordering::Relaxed) {
        let cursor = c.cursor.load(Ordering::Relaxed) / c.tam_trozo;
        let siguiente = {
            let t = c.trozos.lock();
            let hasta = (cursor + PRECARGA_TROZOS).min(t.len() as u64);
            (cursor..hasta).find(|&i| t[i as usize] == Trozo::Vacio)
        };
        match siguiente {
            Some(i) => {
                if c.asegurar(i as usize).is_err() {
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

impl Drop for RangeSource {
    fn drop(&mut self) {
        self.c.parar.store(true, Ordering::Relaxed);
        self.c.cv.notify_all();
    }
}

impl Read for RangeSource {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.c.longitud || buf.is_empty() {
            return Ok(0);
        }
        let idx = (self.pos / self.c.tam_trozo) as usize;
        self.c.cursor.store(self.pos, Ordering::Relaxed);
        self.c.asegurar(idx)?;
        let fin_trozo = ((idx as u64 + 1) * self.c.tam_trozo).min(self.c.longitud);
        let n = ((fin_trozo - self.pos) as usize).min(buf.len());
        let mut f = self.c.archivo.lock();
        f.seek(SeekFrom::Start(self.pos))?;
        let leidos = f.read(&mut buf[..n])?;
        self.pos += leidos as u64;
        Ok(leidos)
    }
}

impl Seek for RangeSource {
    fn seek(&mut self, desde: SeekFrom) -> io::Result<u64> {
        let nueva = match desde {
            SeekFrom::Start(p) => p as i128,
            SeekFrom::End(d) => self.c.longitud as i128 + d as i128,
            SeekFrom::Current(d) => self.pos as i128 + d as i128,
        };
        if nueva < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "posición negativa"));
        }
        self.pos = (nueva as u64).min(self.c.longitud);
        self.c.cursor.store(self.pos, Ordering::Relaxed);
        Ok(self.pos)
    }
}

impl symphonia::core::io::MediaSource for RangeSource {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        Some(self.c.longitud)
    }
}

// ---------------------------------------------------------------- HTTP

pub struct HttpFetcher {
    pub url: String,
    pub http: reqwest::blocking::Client,
}

fn io_err<E: std::fmt::Display>(e: E) -> io::Error {
    io::Error::other(e.to_string())
}

impl RangeFetcher for HttpFetcher {
    fn fetch(&self, start: u64, len: u64) -> io::Result<(Vec<u8>, u64)> {
        let fin = start + len.max(1) - 1;
        let resp = self
            .http
            .get(&self.url)
            .header("Range", format!("bytes={start}-{fin}"))
            .send()
            .map_err(io_err)?;
        let status = resp.status();
        if status.as_u16() == 206 {
            let total = resp
                .headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.rsplit('/').next())
                .and_then(|s| s.trim().parse::<u64>().ok())
                .ok_or_else(|| io_err("Content-Range ausente o ilegible"))?;
            let datos = resp.bytes().map_err(io_err)?.to_vec();
            Ok((datos, total))
        } else if status.as_u16() == 200 {
            // El servidor ignora Range: se descarga todo y se recorta.
            let datos = resp.bytes().map_err(io_err)?;
            let total = datos.len() as u64;
            let a = (start as usize).min(datos.len());
            let b = ((start + len) as usize).min(datos.len());
            Ok((datos[a..b].to_vec(), total))
        } else if status.as_u16() == 416 {
            Ok((vec![], 0))
        } else {
            Err(io_err(format!("HTTP {}", status.as_u16())))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Memoria {
        datos: Vec<u8>,
        cuenta: Arc<AtomicUsize>,
        falla_una_vez: AtomicBool,
    }

    impl RangeFetcher for Memoria {
        fn fetch(&self, start: u64, len: u64) -> io::Result<(Vec<u8>, u64)> {
            self.cuenta.fetch_add(1, Ordering::SeqCst);
            if start > 0 && self.falla_una_vez.swap(false, Ordering::SeqCst) {
                return Err(io::Error::other("fallo simulado"));
            }
            let a = (start as usize).min(self.datos.len());
            let b = ((start + len) as usize).min(self.datos.len());
            Ok((self.datos[a..b].to_vec(), self.datos.len() as u64))
        }
    }

    fn datos(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i * 31 % 251) as u8).collect()
    }

    fn fuente(n: usize, falla: bool) -> (RangeSource, Vec<u8>, Arc<AtomicUsize>) {
        let d = datos(n);
        let cuenta = Arc::new(AtomicUsize::new(0));
        let f = Memoria { datos: d.clone(), cuenta: cuenta.clone(), falla_una_vez: AtomicBool::new(falla) };
        (RangeSource::nuevo(Box::new(f), 4096).unwrap(), d, cuenta)
    }

    #[test]
    fn lee_todo_en_orden() {
        let (mut s, d, _) = fuente(50_000, false);
        assert_eq!(s.longitud(), 50_000);
        let mut out = vec![];
        s.read_to_end(&mut out).unwrap();
        assert_eq!(out, d);
    }

    #[test]
    fn saltar_al_medio_solo_pide_lo_necesario() {
        let (mut s, d, cuenta) = fuente(4096 * 400, false);
        s.seek(SeekFrom::Start(4096 * 300 + 10)).unwrap();
        let mut b = [0u8; 100];
        s.read_exact(&mut b).unwrap();
        assert_eq!(&b[..], &d[4096 * 300 + 10..4096 * 300 + 110]);
        // 1 (primer trozo) + el trozo leído + como mucho la precarga posterior.
        assert!(cuenta.load(Ordering::SeqCst) < 100, "no debe descargar el archivo entero");
    }

    #[test]
    fn releer_no_repite_peticiones() {
        let (mut s, _, _) = fuente(20_000, false);
        let mut b = vec![0u8; 20_000];
        s.read_exact(&mut b).unwrap();
        let antes = s.peticiones();
        s.seek(SeekFrom::Start(0)).unwrap();
        s.read_exact(&mut b).unwrap();
        assert_eq!(s.peticiones(), antes);
    }

    #[test]
    fn seek_desde_el_final_y_limites() {
        let (mut s, d, _) = fuente(10_000, false);
        let p = s.seek(SeekFrom::End(-5)).unwrap();
        assert_eq!(p, 9_995);
        let mut b = vec![];
        s.read_to_end(&mut b).unwrap();
        assert_eq!(b, &d[9_995..]);
        assert_eq!(s.read(&mut [0u8; 8]).unwrap(), 0, "en el final devuelve 0");
        assert!(s.seek(SeekFrom::Current(-20_000)).is_err());
        assert_eq!(s.seek(SeekFrom::Start(99_999)).unwrap(), 10_000, "se limita a la longitud");
    }

    #[test]
    fn un_fallo_puntual_se_puede_reintentar() {
        let (mut s, d, _) = fuente(30_000, true);
        s.seek(SeekFrom::Start(12_000)).unwrap();
        let mut b = [0u8; 10];
        // La precarga o la lectura pueden absorber el fallo; tras reintentar debe leerse bien.
        let mut ok = false;
        for _ in 0..5 {
            s.seek(SeekFrom::Start(12_000)).unwrap();
            if s.read_exact(&mut b).is_ok() {
                ok = true;
                break;
            }
        }
        assert!(ok);
        assert_eq!(&b[..], &d[12_000..12_010]);
    }

    #[test]
    fn archivo_mas_pequeno_que_un_trozo() {
        let (mut s, d, _) = fuente(100, false);
        let mut out = vec![];
        s.read_to_end(&mut out).unwrap();
        assert_eq!(out, d);
    }
}
