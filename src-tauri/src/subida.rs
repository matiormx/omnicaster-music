//! Subida de canciones a la nube, igual que la web de OmniCaster: se calcula la huella
//! (sha256) del archivo, se pregunta qué falta, se sube solo lo que falta (en trozos si es
//! grande) y por último se crean las fichas. Si el archivo ya está en la nube, solo se crea
//! la ficha. Las canciones nuevas entran sin tipo de medio (es música).

use crate::subsonic::Client;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::Duration;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{MetadataOptions, StandardTagKey};
use symphonia::core::probe::Hint;

pub const EXTENSIONES: &[&str] = &["mp3", "wav", "flac", "ogg", "oga", "opus", "m4a", "aac", "aif", "aiff", "wma", "webm"];
/// Por encima de esto se sube por partes (Cloudflare limita cada petición a 100 MB).
const UMBRAL_PARTES: u64 = 90 * 1024 * 1024;
const TAM_PARTE: u64 = 50 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progreso {
    pub indice: usize,
    pub total: usize,
    pub nombre: String,
    /// huella | subiendo | ficha | hecho | existia | error
    pub fase: String,
    pub hecho: u64,
    pub bytes: u64,
    pub error: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Resultado {
    pub creadas: usize,
    pub existian: usize,
    pub fallos: Vec<String>,
}

struct Ficha {
    hash: String,
    ext: String,
    original: String,
    titulo: String,
    artista: String,
    album: String,
    duracion: f64,
}

pub fn extension(ruta: &Path) -> Option<String> {
    let e = ruta.extension()?.to_string_lossy().to_lowercase();
    EXTENSIONES.contains(&e.as_str()).then_some(e)
}

fn tipo_mime(ext: &str) -> &'static str {
    match ext {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "m4a" | "aac" => "audio/mp4",
        "wav" => "audio/wav",
        "aif" | "aiff" => "audio/aiff",
        "webm" => "audio/webm",
        _ => "application/octet-stream",
    }
}

pub fn huella(ruta: &Path) -> Result<(String, u64), String> {
    let mut f = File::open(ruta).map_err(|e| format!("No se pudo abrir el archivo: {e}"))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    let mut total = 0u64;
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        total += n as u64;
    }
    Ok((h.finalize().iter().map(|b| format!("{b:02x}")).collect(), total))
}

/// Título, artista, álbum y duración leídos de las etiquetas del archivo (lo que se pueda).
fn leer_etiquetas(ruta: &Path, ext: &str) -> (String, String, String, f64) {
    let (mut titulo, mut artista, mut album, mut dur) = (String::new(), String::new(), String::new(), 0.0);
    let Ok(f) = File::open(ruta) else { return (titulo, artista, album, dur) };
    let mss = MediaSourceStream::new(Box::new(f), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(ext);
    let Ok(mut sonda) = symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()) else {
        return (titulo, artista, album, dur);
    };
    if let Some(p) = sonda.format.default_track() {
        if let (Some(tb), Some(n)) = (p.codec_params.time_base, p.codec_params.n_frames) {
            let t = tb.calc_time(n);
            dur = t.seconds as f64 + t.frac;
        }
    }
    let mut revisiones = vec![];
    if let Some(m) = sonda.metadata.get() {
        if let Some(r) = m.current() {
            revisiones.push(r.clone());
        }
    }
    if let Some(r) = sonda.format.metadata().current() {
        revisiones.push(r.clone());
    }
    for r in revisiones {
        for t in r.tags() {
            let v = t.value.to_string().trim().to_string();
            if v.is_empty() {
                continue;
            }
            match t.std_key {
                Some(StandardTagKey::TrackTitle) if titulo.is_empty() => titulo = v,
                Some(StandardTagKey::Artist) if artista.is_empty() => artista = v,
                Some(StandardTagKey::Album) if album.is_empty() => album = v,
                _ => {}
            }
        }
    }
    (titulo, artista, album, dur)
}

fn http_largo() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(1800))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

fn ok_oc(v: &Value) -> Result<&Value, String> {
    if v.get("status").and_then(Value::as_str) == Some("failed") {
        return Err(v.pointer("/error/message").and_then(Value::as_str).unwrap_or("El servidor ha rechazado la petición.").to_string());
    }
    Ok(v)
}

fn subir_un_archivo(cli: &Client, ruta: &Path, hash: &str, ext: &str, tam: u64, avisar: &mut dyn FnMut(u64)) -> Result<(), String> {
    let http = http_largo()?;
    let mime = tipo_mime(ext);
    if tam <= UMBRAL_PARTES {
        let f = File::open(ruta).map_err(|e| e.to_string())?;
        let url = cli.url("ocUploadMedia", &[("hash", hash.to_string())]);
        let r = http.put(&url).header("content-type", mime).body(f).send().map_err(|e| format!("Error de red al subir: {e}"))?;
        let v: Value = serde_json::from_str(&r.text().map_err(|e| e.to_string())?).map_err(|_| "Respuesta no válida del servidor".to_string())?;
        ok_oc(v.get("subsonic-response").unwrap_or(&v))?;
        avisar(tam);
        return Ok(());
    }
    // Por partes
    let ini = cli.call_oc("ocUploadMultipart", &[("action".into(), "start".into()), ("hash".into(), hash.into()), ("contentType".into(), mime.into())], None).map_err(|e| e.to_string())?;
    let id = ok_oc(&ini)?.get("uploadId").and_then(Value::as_str).ok_or("El servidor no devolvió el identificador de subida")?.to_string();
    let mut f = File::open(ruta).map_err(|e| e.to_string())?;
    let mut partes = vec![];
    let (mut n, mut pos) = (1u32, 0u64);
    while pos < tam {
        let largo = TAM_PARTE.min(tam - pos);
        f.seek(SeekFrom::Start(pos)).map_err(|e| e.to_string())?;
        let mut datos = vec![0u8; largo as usize];
        f.read_exact(&mut datos).map_err(|e| e.to_string())?;
        let url = cli.url("ocUploadMultipart", &[("action", "part".into()), ("hash", hash.into()), ("uploadId", id.clone()), ("n", n.to_string())]);
        let mut etag = None;
        for intento in 0..3 {
            match http.put(&url).body(datos.clone()).send().and_then(|r| r.text()) {
                Ok(t) => {
                    let v: Value = serde_json::from_str(&t).map_err(|_| "Respuesta no válida del servidor".to_string())?;
                    let b = v.get("subsonic-response").unwrap_or(&v);
                    if let Ok(b) = ok_oc(b) {
                        etag = b.get("etag").and_then(Value::as_str).map(String::from);
                        break;
                    }
                }
                Err(_) if intento < 2 => std::thread::sleep(Duration::from_secs(2)),
                Err(e) => return Err(format!("Error de red al subir: {e}")),
            }
        }
        partes.push(json!({ "n": n, "etag": etag.ok_or("No se pudo subir una parte del archivo")? }));
        pos += largo;
        n += 1;
        avisar(pos);
    }
    let fin = cli
        .call_oc("ocUploadMultipart", &[("action".into(), "complete".into()), ("hash".into(), hash.into()), ("uploadId".into(), id)], Some(&json!({ "parts": partes, "contentType": mime })))
        .map_err(|e| e.to_string())?;
    ok_oc(&fin)?;
    Ok(())
}

/// Sube los archivos y crea las fichas. `emitir` recibe el progreso de cada archivo.
pub fn subir(cli: &Client, rutas: Vec<String>, bloque: Option<String>, emitir: &dyn Fn(Progreso)) -> Result<Resultado, String> {
    let total = rutas.len();
    let mut res = Resultado::default();
    let mut fichas: Vec<Ficha> = vec![];
    let evento = |i: usize, nombre: &str, fase: &str, hecho: u64, bytes: u64, error: Option<String>| {
        emitir(Progreso { indice: i, total, nombre: nombre.into(), fase: fase.into(), hecho, bytes, error });
    };
    for (i, r) in rutas.iter().enumerate() {
        let ruta = Path::new(r);
        let nombre = ruta.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| r.clone());
        let Some(ext) = extension(ruta) else {
            res.fallos.push(format!("{nombre}: formato no admitido"));
            evento(i, &nombre, "error", 0, 0, Some("Formato no admitido".into()));
            continue;
        };
        evento(i, &nombre, "huella", 0, 0, None);
        let paso = (|| -> Result<Ficha, String> {
            let (hash, tam) = huella(ruta)?;
            let falta = cli
                .call_oc("ocMediaMissing", &[], Some(&json!({ "hashes": [hash] })))
                .map_err(|e| e.to_string())?;
            let falta = ok_oc(&falta)?.get("missing").and_then(Value::as_array).map(|a| !a.is_empty()).unwrap_or(true);
            if falta {
                let mut avisar = |hecho: u64| evento(i, &nombre, "subiendo", hecho, tam, None);
                avisar(0);
                subir_un_archivo(cli, ruta, &hash, &ext, tam, &mut avisar)?;
            }
            let (titulo, artista, album, duracion) = leer_etiquetas(ruta, &ext);
            Ok(Ficha { hash, ext: ext.clone(), original: nombre.clone(), titulo, artista, album, duracion })
        })();
        match paso {
            Ok(f) => fichas.push(f),
            Err(msg) => {
                res.fallos.push(format!("{nombre}: {msg}"));
                evento(i, &nombre, "error", 0, 0, Some(msg));
            }
        }
    }
    for lote in fichas.chunks(50) {
        let songs: Vec<Value> = lote
            .iter()
            .map(|f| {
                let mut o = json!({ "hash": f.hash, "ext": f.ext, "originalName": f.original, "durationSecs": f.duracion.round() });
                if !f.titulo.is_empty() { o["title"] = json!(f.titulo); }
                if !f.artista.is_empty() { o["artist"] = json!(f.artista); }
                if !f.album.is_empty() { o["album"] = json!(f.album); }
                if let Some(b) = &bloque { o["blockId"] = json!(b); }
                o
            })
            .collect();
        let r = cli.call_oc("ocCreateSongs", &[], Some(&json!({ "songs": songs }))).map_err(|e| e.to_string())?;
        match ok_oc(&r) {
            Ok(b) => {
                for s in b.get("song").and_then(Value::as_array).cloned().unwrap_or_default() {
                    if s.get("existed").and_then(Value::as_bool).unwrap_or(false) { res.existian += 1 } else { res.creadas += 1 }
                }
            }
            Err(m) => res.fallos.push(format!("Fichas: {m}")),
        }
    }
    evento(total, "", "hecho", 0, 0, None);
    Ok(res)
}
