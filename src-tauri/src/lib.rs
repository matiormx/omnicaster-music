pub mod audio;
pub mod db;
pub mod rangecache;
pub mod subsonic;

use audio::{Evento, Motor, Origen, Pista};
use db::{CancionFila, SinConexion};
use parking_lot::Mutex;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use subsonic::{Client, ServerInfo, Song};
use tauri::{AppHandle, Emitter, Manager};

const SERVICIO_CLAVES: &str = "omnicaster-music";

#[derive(Clone)]
struct Cred {
    servidor: String,
    usuario: String,
    clave: String,
}

struct Medios(MediaControls);
// El objeto de controles multimedia solo se toca bajo un Mutex.
unsafe impl Send for Medios {}

pub struct Estado {
    db: Mutex<Connection>,
    cred: Mutex<Option<Cred>>,
    motor: Option<Motor>,
    medios: Mutex<Option<Medios>>,
    datos: PathBuf,
}

impl Estado {
    fn cliente(&self) -> Result<Client, String> {
        let c = self.cred.lock().clone().ok_or("No hay conexión con ningún servidor.")?;
        Ok(Client::new(&c.servidor, &c.usuario, &c.clave))
    }
    fn motor(&self) -> Result<&Motor, String> {
        self.motor.as_ref().ok_or_else(|| "No hay salida de audio disponible en este equipo.".to_string())
    }
    fn dir_sin_conexion(&self) -> PathBuf {
        let d = db::kv_get(&self.db.lock(), "dir_sin_conexion").ok().flatten();
        d.map(PathBuf::from).unwrap_or_else(|| self.datos.join("sin_conexion"))
    }
}

async fn bloquear<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

// ---------------------------------------------------------------- conexión

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConexionActual {
    servidor: String,
    usuario: String,
    necesita_clave: bool,
}

fn entrada_claves(servidor: &str, usuario: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICIO_CLAVES, &format!("{usuario}@{servidor}")).map_err(e)
}

#[tauri::command]
async fn conexion_probar(servidor: String, usuario: String, clave: String) -> Result<ServerInfo, String> {
    bloquear(move || Client::new(&servidor, &usuario, &clave).ping().map_err(e)).await
}

#[tauri::command]
async fn conexion_guardar(app: AppHandle, servidor: String, usuario: String, clave: String) -> Result<Option<String>, String> {
    bloquear(move || {
        let st = app.state::<Estado>();
        let servidor = subsonic::normalizar_servidor(&servidor);
        Client::new(&servidor, &usuario, &clave).ping().map_err(e)?;
        let aviso = match entrada_claves(&servidor, &usuario).and_then(|en| en.set_password(&clave).map_err(e)) {
            Ok(()) => None,
            Err(err) => Some(format!(
                "No se pudo guardar la contraseña en el almacén seguro del sistema ({err}). Tendrás que escribirla cada vez que abras la aplicación."
            )),
        };
        {
            let db = st.db.lock();
            db::kv_set(&db, "servidor", &servidor).map_err(e)?;
            db::kv_set(&db, "usuario", &usuario).map_err(e)?;
        }
        *st.cred.lock() = Some(Cred { servidor, usuario, clave });
        Ok(aviso)
    })
    .await
}

#[tauri::command]
async fn conexion_actual(app: AppHandle) -> Result<Option<ConexionActual>, String> {
    bloquear(move || {
        let st = app.state::<Estado>();
        let (servidor, usuario) = {
            let db = st.db.lock();
            (db::kv_get(&db, "servidor").map_err(e)?, db::kv_get(&db, "usuario").map_err(e)?)
        };
        let (Some(servidor), Some(usuario)) = (servidor, usuario) else { return Ok(None) };
        let clave = entrada_claves(&servidor, &usuario).and_then(|en| en.get_password().map_err(e)).ok();
        let necesita_clave = clave.is_none();
        if let Some(clave) = clave {
            *st.cred.lock() = Some(Cred { servidor: servidor.clone(), usuario: usuario.clone(), clave });
        }
        Ok(Some(ConexionActual { servidor, usuario, necesita_clave }))
    })
    .await
}

#[tauri::command]
async fn conexion_olvidar(app: AppHandle) -> Result<(), String> {
    bloquear(move || {
        let st = app.state::<Estado>();
        if let Some(c) = st.cred.lock().take() {
            if let Ok(en) = entrada_claves(&c.servidor, &c.usuario) {
                let _ = en.delete_credential();
            }
        }
        let db = st.db.lock();
        for k in ["servidor", "usuario"] {
            let _ = db::kv_borrar(&db, k);
        }
        Ok(())
    })
    .await
}

// ---------------------------------------------------------------- biblioteca

fn a_fila(s: &Song) -> Option<CancionFila> {
    Some(CancionFila {
        id: s.id.clone()?,
        titulo: s.title.clone().unwrap_or_else(|| "Sin título".into()),
        artista: s.artist.clone().unwrap_or_else(|| "Artista desconocido".into()),
        artista_id: s.artist_id.clone(),
        album: s.album.clone().unwrap_or_else(|| "Álbum desconocido".into()),
        album_id: s.album_id.clone(),
        pista: s.track,
        disco: s.disc_number,
        anio: s.year,
        genero: s.genre.clone(),
        duracion: s.duration.unwrap_or(0),
        caratula: s.cover_art.clone(),
        formato: s.suffix.clone(),
        ganancia_db: s.replay_gain.as_ref().and_then(|r| r.track_gain),
    })
}

#[tauri::command]
async fn biblioteca_cargar(app: AppHandle) -> Result<db::Biblioteca, String> {
    bloquear(move || {
        let st = app.state::<Estado>();
        let b = db::cargar_biblioteca(&st.db.lock()).map_err(e)?;
        Ok(b)
    })
    .await
}

#[derive(Serialize, Clone)]
struct Progreso {
    fase: &'static str,
    cantidad: usize,
}

const PAGINA: usize = 500;

#[tauri::command]
async fn biblioteca_sincronizar(app: AppHandle) -> Result<db::Biblioteca, String> {
    bloquear(move || {
        let st = app.state::<Estado>();
        let cli = st.cliente()?;
        let avisar = |fase: &'static str, cantidad: usize| {
            let _ = app.emit("biblioteca-progreso", Progreso { fase, cantidad });
        };

        let mut albumes = vec![];
        for pagina in 0..400 {
            let cuerpo = cli
                .call(
                    "getAlbumList2",
                    &[("type", "alphabeticalByName".into()), ("size", PAGINA.to_string()), ("offset", (pagina * PAGINA).to_string())],
                )
                .map_err(e)?;
            let lote = subsonic::parse_album_list(&cuerpo);
            let n = lote.len();
            albumes.extend(lote);
            avisar("albumes", albumes.len());
            if n < PAGINA {
                break;
            }
        }
        let artistas = subsonic::parse_artists(&cli.call("getArtists", &[]).map_err(e)?);
        avisar("artistas", artistas.len());

        let mut canciones: Vec<Song> = vec![];
        for pagina in 0..400 {
            let cuerpo = cli
                .call(
                    "search3",
                    &[
                        ("query", String::new()),
                        ("artistCount", "0".into()),
                        ("albumCount", "0".into()),
                        ("songCount", PAGINA.to_string()),
                        ("songOffset", (pagina * PAGINA).to_string()),
                    ],
                )
                .map_err(e)?;
            let lote = subsonic::parse_search3(&cuerpo).songs;
            let n = lote.len();
            canciones.extend(lote);
            avisar("canciones", canciones.len());
            if n < PAGINA {
                break;
            }
        }
        // Plan B: algunos servidores no devuelven canciones con search3 vacío.
        if canciones.is_empty() && !albumes.is_empty() {
            for (i, a) in albumes.iter().enumerate() {
                if let Some(id) = &a.id {
                    if let Ok(cuerpo) = cli.call("getAlbum", &[("id", id.clone())]) {
                        if let Some(al) = subsonic::parse_album(&cuerpo) {
                            canciones.extend(al.songs);
                        }
                    }
                }
                if i % 25 == 0 {
                    avisar("canciones", canciones.len());
                }
            }
        }
        // Los géneros y las carátulas de las canciones pueden faltar: se heredan del álbum.
        let por_album: std::collections::HashMap<_, _> = albumes.iter().filter_map(|a| a.id.clone().map(|i| (i, a))).collect();
        for s in canciones.iter_mut() {
            if let Some(al) = s.album_id.as_ref().and_then(|i| por_album.get(i)) {
                if s.cover_art.is_none() {
                    s.cover_art = al.cover_art.clone();
                }
                if s.genre.is_none() {
                    s.genre = al.genre.clone();
                }
                if s.year.is_none() {
                    s.year = al.year;
                }
            }
        }
        let mut db = st.db.lock();
        db::reemplazar_biblioteca(&mut db, &artistas, &albumes, &canciones).map_err(e)?;
        db::cargar_biblioteca(&db).map_err(e)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListaServidor {
    id: String,
    nombre: String,
    canciones: Vec<String>,
}

/// Listas del servidor (si las admite). Los errores se ignoran: se devuelve vacío.
#[tauri::command]
async fn servidor_listas(app: AppHandle) -> Result<Vec<ListaServidor>, String> {
    bloquear(move || {
        let cli = app.state::<Estado>().cliente()?;
        let Ok(cuerpo) = cli.call("getPlaylists", &[]) else { return Ok(vec![]) };
        let mut out = vec![];
        for p in subsonic::parse_playlists(&cuerpo) {
            let Some(id) = p.id.clone() else { continue };
            let canciones = cli
                .call("getPlaylist", &[("id", id.clone())])
                .ok()
                .and_then(|c| subsonic::parse_playlist(&c))
                .map(|pl| pl.entries.into_iter().filter_map(|s| s.id).collect())
                .unwrap_or_default();
            out.push(ListaServidor { id, nombre: p.name.unwrap_or_else(|| "Lista".into()), canciones });
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
async fn servidor_favoritos(app: AppHandle) -> Result<Vec<String>, String> {
    bloquear(move || {
        let cli = app.state::<Estado>().cliente()?;
        let Ok(cuerpo) = cli.call("getStarred2", &[]) else { return Ok(vec![]) };
        Ok(subsonic::parse_songs(cuerpo.pointer("/starred2/song")).into_iter().filter_map(|s| s.id).collect())
    })
    .await
}

/// Marca o desmarca favorito en el servidor; si no lo admite, no pasa nada.
#[tauri::command]
async fn servidor_marcar(app: AppHandle, id: String, favorito: bool) -> Result<(), String> {
    bloquear(move || {
        if let Ok(cli) = app.state::<Estado>().cliente() {
            let _ = cli.call(if favorito { "star" } else { "unstar" }, &[("id", id)]);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
async fn servidor_registrar(app: AppHandle, id: String) -> Result<(), String> {
    bloquear(move || {
        if let Ok(cli) = app.state::<Estado>().cliente() {
            let _ = cli.call("scrobble", &[("id", id), ("submission", "true".into())]);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
async fn canciones_aleatorias(app: AppHandle, genero: Option<String>, tamano: Option<u32>) -> Result<Vec<CancionFila>, String> {
    bloquear(move || {
        let cli = app.state::<Estado>().cliente()?;
        let mut p = vec![("size", tamano.unwrap_or(50).min(500).to_string())];
        if let Some(g) = genero {
            p.push(("genre", g));
        }
        let cuerpo = cli.call("getRandomSongs", &p).map_err(e)?;
        Ok(subsonic::parse_songs(cuerpo.pointer("/randomSongs/song")).iter().filter_map(a_fila).collect())
    })
    .await
}

// ---------------------------------------------------------------- valores del usuario

#[tauri::command]
fn valor_leer(app: AppHandle, clave: String) -> Result<Option<String>, String> {
    db::kv_get(&app.state::<Estado>().db.lock(), &clave).map_err(e)
}

#[tauri::command]
fn valor_guardar(app: AppHandle, clave: String, valor: String) -> Result<(), String> {
    db::kv_set(&app.state::<Estado>().db.lock(), &clave, &valor).map_err(e)
}

// ---------------------------------------------------------------- reproducción

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PistaPeticion {
    id: String,
    formato: Option<String>,
    ganancia_db: Option<f32>,
}

fn construir_pista(st: &Estado, p: &PistaPeticion) -> Result<Pista, String> {
    let local = db::sc_ruta(&st.db.lock(), &p.id).map_err(e)?.map(PathBuf::from).filter(|r| r.exists());
    let origen = match local {
        Some(ruta) => Origen::Archivo { ruta },
        None => Origen::Http { url: st.cliente()?.stream_url(&p.id) },
    };
    Ok(Pista { id: p.id.clone(), origen, ext: p.formato.clone(), ganancia_db: p.ganancia_db })
}

#[tauri::command]
async fn audio_reproducir(app: AppHandle, pista: PistaPeticion, inicio: Option<f64>) -> Result<(), String> {
    bloquear(move || {
        let st = app.state::<Estado>();
        let p = construir_pista(&st, &pista)?;
        st.motor()?.reproducir(p, inicio.unwrap_or(0.0));
        Ok(())
    })
    .await
}

#[tauri::command]
async fn audio_siguiente(app: AppHandle, pista: Option<PistaPeticion>) -> Result<(), String> {
    bloquear(move || {
        let st = app.state::<Estado>();
        let p = match pista {
            Some(p) => Some(construir_pista(&st, &p)?),
            None => None,
        };
        st.motor()?.siguiente(p);
        Ok(())
    })
    .await
}

#[tauri::command]
fn audio_pausa(app: AppHandle, pausa: bool) -> Result<(), String> {
    app.state::<Estado>().motor()?.pausa(pausa);
    Ok(())
}

#[tauri::command]
fn audio_buscar(app: AppHandle, segundos: f64) -> Result<(), String> {
    app.state::<Estado>().motor()?.buscar(segundos);
    Ok(())
}

#[tauri::command]
fn audio_volumen(app: AppHandle, volumen: f32) -> Result<(), String> {
    app.state::<Estado>().motor()?.volumen(volumen);
    Ok(())
}

#[tauri::command]
fn audio_parar(app: AppHandle) -> Result<(), String> {
    app.state::<Estado>().motor()?.parar();
    Ok(())
}

// ---------------------------------------------------------------- carátulas

fn nombre_seguro(id: &str) -> String {
    id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect()
}

fn tipo_imagen(b: &[u8]) -> &'static str {
    if b.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if b.starts_with(b"\x89PNG") {
        "image/png"
    } else if b.len() > 12 && &b[8..12] == b"WEBP" {
        "image/webp"
    } else if b.starts_with(b"GIF8") {
        "image/gif"
    } else {
        "application/octet-stream"
    }
}

fn caratula_ruta(st: &Estado, id: &str, tam: u32) -> Result<PathBuf, String> {
    let dir = st.datos.join("caratulas");
    std::fs::create_dir_all(&dir).map_err(e)?;
    let ruta = dir.join(format!("{}_{}", nombre_seguro(id), tam));
    if ruta.exists() {
        return Ok(ruta);
    }
    let cli = st.cliente()?;
    let resp = cli.http().get(cli.cover_url(id, tam)).send().map_err(e)?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let tipo = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let bytes = resp.bytes().map_err(e)?;
    // Algunos servidores responden con JSON de error y código 200.
    if tipo.contains("json") || tipo.contains("xml") || tipo_imagen(&bytes) == "application/octet-stream" {
        return Err("el servidor no devolvió una imagen".into());
    }
    let tmp = ruta.with_extension("tmp");
    std::fs::write(&tmp, &bytes).map_err(e)?;
    std::fs::rename(&tmp, &ruta).map_err(e)?;
    Ok(ruta)
}

fn servir_caratula(app: &AppHandle, uri: &tauri::http::Uri) -> tauri::http::Response<Vec<u8>> {
    let id = urlencoding::decode(uri.path().trim_start_matches('/')).map(|c| c.into_owned()).unwrap_or_default();
    let tam = uri
        .query()
        .and_then(|q| q.split('&').find_map(|kv| kv.strip_prefix("size=")))
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(300)
        .clamp(32, 1500);
    let st = app.state::<Estado>();
    match caratula_ruta(&st, &id, tam).and_then(|r| std::fs::read(r).map_err(e)) {
        Ok(bytes) => tauri::http::Response::builder()
            .header("Content-Type", tipo_imagen(&bytes))
            .header("Cache-Control", "max-age=31536000")
            .header("Access-Control-Allow-Origin", "*")
            .body(bytes)
            .unwrap(),
        Err(_) => tauri::http::Response::builder()
            .status(404)
            .header("Access-Control-Allow-Origin", "*")
            .body(vec![])
            .unwrap(),
    }
}

// ---------------------------------------------------------------- sin conexión

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgresoDescarga {
    hecho: usize,
    total: usize,
    id: String,
    error: Option<String>,
}

#[tauri::command]
fn sin_conexion_descargar(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let st = app.state::<Estado>();
    let cli = st.cliente()?;
    let dir = st.dir_sin_conexion();
    std::fs::create_dir_all(&dir).map_err(|er| format!("No se pudo crear la carpeta de descargas: {er}"))?;
    let app2 = app.clone();
    std::thread::spawn(move || {
        let st = app2.state::<Estado>();
        let total = ids.len();
        for (i, id) in ids.iter().enumerate() {
            let ya = db::sc_ruta(&st.db.lock(), id).ok().flatten().map(|r| PathBuf::from(r).exists()).unwrap_or(false);
            let mut error = None;
            if !ya {
                let ext = {
                    let db = st.db.lock();
                    db.query_row("SELECT formato FROM canciones WHERE id=?1", [id], |r| r.get::<_, Option<String>>(0))
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| "audio".into())
                };
                let ruta = dir.join(format!("{}.{}", nombre_seguro(id), ext));
                let res = (|| -> Result<u64, String> {
                    let mut resp = cli.http().get(cli.stream_url(id)).timeout(Duration::from_secs(600)).send().map_err(e)?;
                    if !resp.status().is_success() {
                        return Err(format!("HTTP {}", resp.status().as_u16()));
                    }
                    let tmp = ruta.with_extension("parte");
                    let mut f = std::fs::File::create(&tmp).map_err(e)?;
                    let n = resp.copy_to(&mut f).map_err(e)?;
                    std::fs::rename(&tmp, &ruta).map_err(e)?;
                    Ok(n)
                })();
                match res {
                    Ok(n) => {
                        let _ = db::sc_guardar(&st.db.lock(), id, &ruta.to_string_lossy(), n);
                    }
                    Err(er) => error = Some(er),
                }
            }
            let _ = app2.emit("sin-conexion-progreso", ProgresoDescarga { hecho: i + 1, total, id: id.clone(), error });
        }
    });
    Ok(())
}

#[tauri::command]
fn sin_conexion_listar(app: AppHandle) -> Result<Vec<SinConexion>, String> {
    db::sc_listar(&app.state::<Estado>().db.lock()).map_err(e)
}

#[tauri::command]
fn sin_conexion_borrar(app: AppHandle, ids: Option<Vec<String>>) -> Result<u64, String> {
    let st = app.state::<Estado>();
    let db = st.db.lock();
    let todos = db::sc_listar(&db).map_err(e)?;
    let mut liberado = 0;
    for s in todos.into_iter().filter(|s| ids.as_ref().map_or(true, |v| v.contains(&s.id))) {
        if let Some(r) = db::sc_borrar(&db, &s.id).map_err(e)? {
            let _ = std::fs::remove_file(r);
            liberado += s.tam;
        }
    }
    Ok(liberado)
}

#[tauri::command]
fn sin_conexion_carpeta(app: AppHandle, nueva: Option<String>) -> Result<String, String> {
    let st = app.state::<Estado>();
    if let Some(n) = nueva {
        std::fs::create_dir_all(&n).map_err(|er| format!("No se pudo usar esa carpeta: {er}"))?;
        db::kv_set(&st.db.lock(), "dir_sin_conexion", &n).map_err(e)?;
    }
    Ok(st.dir_sin_conexion().to_string_lossy().into_owned())
}

// ---------------------------------------------------------------- controles multimedia

fn crear_medios(app: &AppHandle) -> Option<MediaControls> {
    #[cfg(target_os = "windows")]
    let hwnd = app
        .get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map(|h| h.0 as _);
    #[cfg(not(target_os = "windows"))]
    let hwnd = None;
    let mut c = MediaControls::new(PlatformConfig { dbus_name: "omnicaster_music", display_name: "OmniCaster Music", hwnd }).ok()?;
    let app2 = app.clone();
    c.attach(move |ev: MediaControlEvent| {
        let s = match ev {
            MediaControlEvent::Play => "play",
            MediaControlEvent::Pause => "pause",
            MediaControlEvent::Toggle => "toggle",
            MediaControlEvent::Next => "next",
            MediaControlEvent::Previous => "previous",
            MediaControlEvent::Stop => "stop",
            _ => return,
        };
        let _ = app2.emit("medios-control", s);
    })
    .ok()?;
    Some(c)
}

#[tauri::command]
async fn medios_metadatos(
    app: AppHandle,
    titulo: String,
    artista: String,
    album: String,
    caratula: Option<String>,
    duracion: f64,
) -> Result<(), String> {
    bloquear(move || {
        let st = app.state::<Estado>();
        let url = caratula
            .and_then(|id| caratula_ruta(&st, &id, 500).ok())
            .map(|r| format!("file://{}", r.to_string_lossy().replace('\\', "/")));
        if let Some(Medios(m)) = st.medios.lock().as_mut() {
            let _ = m.set_metadata(MediaMetadata {
                title: Some(&titulo),
                artist: Some(&artista),
                album: Some(&album),
                cover_url: url.as_deref(),
                duration: if duracion > 0.0 { Some(Duration::from_secs_f64(duracion)) } else { None },
            });
        }
        Ok(())
    })
    .await
}

#[tauri::command]
fn medios_estado(app: AppHandle, reproduciendo: bool, posicion: f64) -> Result<(), String> {
    if let Some(Medios(m)) = app.state::<Estado>().medios.lock().as_mut() {
        let progreso = Some(MediaPosition(Duration::from_secs_f64(posicion.max(0.0))));
        let _ = m.set_playback(if reproduciendo { MediaPlayback::Playing { progress: progreso } } else { MediaPlayback::Paused { progress: progreso } });
    }
    Ok(())
}

// ---------------------------------------------------------------- arranque

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("cover", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let uri = request.uri().clone();
            std::thread::spawn(move || responder.respond(servir_caratula(&app, &uri)));
        })
        .setup(|app| {
            let datos = app.path().app_data_dir()?;
            std::fs::create_dir_all(&datos)?;
            let conexion = db::abrir(&datos.join("biblioteca.db"))?;
            let handle = app.handle().clone();
            let motor = match Motor::nuevo(Arc::new(move |ev: Evento| {
                let _ = handle.emit("audio", ev);
            })) {
                Ok(m) => Some(m),
                Err(err) => {
                    eprintln!("audio: {err}");
                    None
                }
            };
            let medios = crear_medios(app.handle()).map(Medios);
            app.manage(Estado { db: Mutex::new(conexion), cred: Mutex::new(None), motor, medios: Mutex::new(medios), datos });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            conexion_probar,
            conexion_guardar,
            conexion_actual,
            conexion_olvidar,
            biblioteca_cargar,
            biblioteca_sincronizar,
            servidor_listas,
            servidor_favoritos,
            servidor_marcar,
            servidor_registrar,
            canciones_aleatorias,
            valor_leer,
            valor_guardar,
            audio_reproducir,
            audio_siguiente,
            audio_pausa,
            audio_buscar,
            audio_volumen,
            audio_parar,
            sin_conexion_descargar,
            sin_conexion_listar,
            sin_conexion_borrar,
            sin_conexion_carpeta,
            medios_metadatos,
            medios_estado,
        ])
        .run(tauri::generate_context!())
        .expect("error al ejecutar OmniCaster Music");
}
