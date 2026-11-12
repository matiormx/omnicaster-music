//! Cliente de la API Subsonic 1.16.1 / OpenSubsonic.
//!
//! Todo el parseo es tolerante: cualquier campo puede faltar y los ids o
//! números pueden venir como texto o como número.

use rand::Rng;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::time::Duration;

pub const API_VERSION: &str = "1.16.1";
pub const CLIENT_NAME: &str = "OmniCasterMusic";

#[derive(Debug, thiserror::Error)]
pub enum SubsonicError {
    #[error("{0}")]
    Api(String, i64),
    #[error("{0}")]
    Network(String),
    #[error("{0}")]
    Parse(String),
}

impl SubsonicError {
    pub fn code(&self) -> Option<i64> {
        match self {
            SubsonicError::Api(_, c) => Some(*c),
            _ => None,
        }
    }
}

/// Mensajes de error de Subsonic en español.
pub fn mensaje_error(code: i64, original: &str) -> String {
    match code {
        10 => "Falta un parámetro obligatorio en la petición.".into(),
        20 => "La aplicación es demasiado antigua para este servidor.".into(),
        30 => "El servidor es demasiado antiguo para esta aplicación.".into(),
        40 => "Usuario o contraseña incorrectos.".into(),
        41 => "El servidor no admite autenticación por token con este usuario.".into(),
        50 => "Este usuario no tiene permiso para hacer eso.".into(),
        60 => "El periodo de prueba del servidor ha terminado.".into(),
        70 => "No se ha encontrado lo que se pedía en el servidor.".into(),
        _ if original.is_empty() => format!("Error {code} del servidor."),
        _ => format!("Error {code} del servidor: {original}"),
    }
}

// ---------------------------------------------------------------- autenticación

pub fn salt_aleatoria() -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..12)
        .map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char)
        .collect()
}

/// `t = md5(contraseña + sal)` en hexadecimal minúscula.
pub fn token(password: &str, salt: &str) -> String {
    format!("{:x}", md5::compute(format!("{password}{salt}")))
}

pub fn auth_params(user: &str, password: &str, salt: &str) -> Vec<(String, String)> {
    vec![
        ("u".into(), user.into()),
        ("t".into(), token(password, salt)),
        ("s".into(), salt.into()),
        ("v".into(), API_VERSION.into()),
        ("c".into(), CLIENT_NAME.into()),
        ("f".into(), "json".into()),
    ]
}

/// Normaliza la dirección del servidor: añade https:// si falta y quita la
/// barra final y un posible `/rest`.
pub fn normalizar_servidor(s: &str) -> String {
    let mut s = s.trim().to_string();
    if !s.contains("://") {
        s = format!("https://{s}");
    }
    while s.ends_with('/') {
        s.pop();
    }
    if let Some(stripped) = s.strip_suffix("/rest") {
        s = stripped.to_string();
    }
    s
}

// ---------------------------------------------------------------- modelos

fn flex_string<'de, D: Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let v = Option::<Value>::deserialize(d)?;
    Ok(match v {
        Some(Value::String(s)) if !s.is_empty() => Some(s),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    })
}

fn flex_u32<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u32>, D::Error> {
    let v = Option::<Value>::deserialize(d)?;
    Ok(match v {
        Some(Value::Number(n)) => n.as_u64().map(|x| x as u32).or_else(|| n.as_f64().map(|x| x.max(0.0) as u32)),
        Some(Value::String(s)) => s.trim().parse::<u32>().ok(),
        _ => None,
    })
}

fn flex_u64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<u64>, D::Error> {
    let v = Option::<Value>::deserialize(d)?;
    Ok(match v {
        Some(Value::Number(n)) => n.as_u64(),
        Some(Value::String(s)) => s.trim().parse::<u64>().ok(),
        _ => None,
    })
}

fn flex_f32<'de, D: Deserializer<'de>>(d: D) -> Result<Option<f32>, D::Error> {
    let v = Option::<Value>::deserialize(d)?;
    Ok(match v {
        Some(Value::Number(n)) => n.as_f64().map(|x| x as f32),
        Some(Value::String(s)) => s.trim().parse::<f32>().ok(),
        _ => None,
    })
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ReplayGain {
    #[serde(deserialize_with = "flex_f32")]
    pub track_gain: Option<f32>,
    #[serde(deserialize_with = "flex_f32")]
    pub album_gain: Option<f32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Song {
    #[serde(deserialize_with = "flex_string")]
    pub id: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    #[serde(deserialize_with = "flex_string")]
    pub artist_id: Option<String>,
    pub album: Option<String>,
    #[serde(deserialize_with = "flex_string")]
    pub album_id: Option<String>,
    #[serde(deserialize_with = "flex_u32")]
    pub track: Option<u32>,
    #[serde(deserialize_with = "flex_u32")]
    pub disc_number: Option<u32>,
    #[serde(deserialize_with = "flex_u32")]
    pub year: Option<u32>,
    pub genre: Option<String>,
    #[serde(deserialize_with = "flex_u32")]
    pub duration: Option<u32>,
    #[serde(deserialize_with = "flex_string")]
    pub cover_art: Option<String>,
    pub suffix: Option<String>,
    #[serde(deserialize_with = "flex_u32")]
    pub bit_rate: Option<u32>,
    #[serde(deserialize_with = "flex_u64")]
    pub size: Option<u64>,
    pub replay_gain: Option<ReplayGain>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Album {
    #[serde(deserialize_with = "flex_string")]
    pub id: Option<String>,
    pub name: Option<String>,
    pub artist: Option<String>,
    #[serde(deserialize_with = "flex_string")]
    pub artist_id: Option<String>,
    #[serde(deserialize_with = "flex_u32")]
    pub year: Option<u32>,
    pub genre: Option<String>,
    #[serde(deserialize_with = "flex_string")]
    pub cover_art: Option<String>,
    #[serde(deserialize_with = "flex_u32")]
    pub song_count: Option<u32>,
    #[serde(deserialize_with = "flex_u32")]
    pub duration: Option<u32>,
    pub created: Option<String>,
    #[serde(rename = "song")]
    pub songs: Vec<Song>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Artist {
    #[serde(deserialize_with = "flex_string")]
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(deserialize_with = "flex_u32")]
    pub album_count: Option<u32>,
    #[serde(deserialize_with = "flex_string")]
    pub cover_art: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaylistInfo {
    #[serde(deserialize_with = "flex_string")]
    pub id: Option<String>,
    pub name: Option<String>,
    #[serde(deserialize_with = "flex_u32")]
    pub song_count: Option<u32>,
    #[serde(rename = "entry")]
    pub entries: Vec<Song>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub version: String,
    pub server_type: Option<String>,
    pub server_version: Option<String>,
    pub open_subsonic: bool,
}

// ---------------------------------------------------------------- parseo

/// Extrae el cuerpo de `subsonic-response`, convirtiendo errores de la API.
pub fn parse_response(texto: &str) -> Result<Value, SubsonicError> {
    let v: Value = serde_json::from_str(texto)
        .map_err(|_| SubsonicError::Parse("El servidor no ha devuelto una respuesta Subsonic válida.".into()))?;
    let body = v
        .get("subsonic-response")
        .cloned()
        .ok_or_else(|| SubsonicError::Parse("La respuesta no contiene «subsonic-response». ¿Es un servidor Subsonic?".into()))?;
    if body.get("status").and_then(Value::as_str) == Some("failed") {
        let code = body.pointer("/error/code").and_then(Value::as_i64).unwrap_or(0);
        let msg = body.pointer("/error/message").and_then(Value::as_str).unwrap_or("");
        return Err(SubsonicError::Api(mensaje_error(code, msg), code));
    }
    Ok(body)
}

fn lista<T: for<'de> Deserialize<'de>>(v: Option<&Value>) -> Vec<T> {
    match v {
        Some(Value::Array(a)) => a.iter().filter_map(|x| serde_json::from_value(x.clone()).ok()).collect(),
        // Algunos servidores devuelven un objeto suelto cuando hay un único elemento.
        Some(o @ Value::Object(_)) => serde_json::from_value(o.clone()).ok().into_iter().collect(),
        _ => vec![],
    }
}

pub fn parse_album_list(body: &Value) -> Vec<Album> {
    lista::<Album>(body.pointer("/albumList2/album"))
        .into_iter()
        .filter(|a| a.id.is_some())
        .collect()
}

pub fn parse_artists(body: &Value) -> Vec<Artist> {
    let mut out = vec![];
    if let Some(Value::Array(indices)) = body.pointer("/artists/index") {
        for idx in indices {
            out.extend(lista::<Artist>(idx.get("artist")));
        }
    }
    out.into_iter().filter(|a| a.id.is_some()).collect()
}

pub fn parse_album(body: &Value) -> Option<Album> {
    let v = body.get("album")?;
    let mut a: Album = serde_json::from_value(v.clone()).ok()?;
    let id = a.id.clone()?;
    for s in a.songs.iter_mut() {
        if s.album_id.is_none() {
            s.album_id = Some(id.clone());
        }
        if s.cover_art.is_none() {
            s.cover_art = a.cover_art.clone();
        }
    }
    Some(a)
}

pub fn parse_songs(v: Option<&Value>) -> Vec<Song> {
    lista::<Song>(v).into_iter().filter(|s| s.id.is_some()).collect()
}

pub struct Search3 {
    pub artists: Vec<Artist>,
    pub albums: Vec<Album>,
    pub songs: Vec<Song>,
}

pub fn parse_search3(body: &Value) -> Search3 {
    Search3 {
        artists: lista::<Artist>(body.pointer("/searchResult3/artist")),
        albums: lista::<Album>(body.pointer("/searchResult3/album")),
        songs: parse_songs(body.pointer("/searchResult3/song")),
    }
}

pub fn parse_playlists(body: &Value) -> Vec<PlaylistInfo> {
    lista::<PlaylistInfo>(body.pointer("/playlists/playlist"))
}

pub fn parse_playlist(body: &Value) -> Option<PlaylistInfo> {
    serde_json::from_value(body.get("playlist")?.clone()).ok()
}

pub fn parse_server_info(body: &Value) -> ServerInfo {
    ServerInfo {
        version: body.get("version").and_then(Value::as_str).unwrap_or("").to_string(),
        server_type: body.get("type").and_then(Value::as_str).map(String::from),
        server_version: body.get("serverVersion").and_then(Value::as_str).map(String::from),
        open_subsonic: body.get("openSubsonic").and_then(Value::as_bool).unwrap_or(false),
    }
}

// ---------------------------------------------------------------- cliente

#[derive(Clone)]
pub struct Client {
    pub server: String,
    pub user: String,
    pub password: String,
    http: reqwest::blocking::Client,
}

impl Client {
    pub fn new(server: &str, user: &str, password: &str) -> Self {
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent(format!("{CLIENT_NAME}/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("cliente HTTP");
        Client { server: normalizar_servidor(server), user: user.into(), password: password.into(), http }
    }

    /// URL completa (con autenticación) de un método REST.
    pub fn url(&self, method: &str, extra: &[(&str, String)]) -> String {
        let salt = salt_aleatoria();
        let mut q: Vec<(String, String)> = auth_params(&self.user, &self.password, &salt);
        for (k, v) in extra {
            q.push(((*k).into(), v.clone()));
        }
        let qs: Vec<String> = q
            .iter()
            .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
            .collect();
        format!("{}/rest/{}?{}", self.server, method, qs.join("&"))
    }

    pub fn call(&self, method: &str, extra: &[(&str, String)]) -> Result<Value, SubsonicError> {
        let url = self.url(method, extra);
        let resp = self.http.get(&url).send().map_err(|e| error_red(&e))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(SubsonicError::Network(format!(
                "El servidor respondió con el código HTTP {}.",
                status.as_u16()
            )));
        }
        let texto = resp.text().map_err(|e| error_red(&e))?;
        parse_response(&texto)
    }

    pub fn ping(&self) -> Result<ServerInfo, SubsonicError> {
        let body = self.call("ping", &[])?;
        Ok(parse_server_info(&body))
    }

    pub fn stream_url(&self, id: &str) -> String {
        // `download` entrega el archivo original (sin transcodificar) y admite Range.
        self.url("download", &[("id", id.to_string())])
    }

    pub fn cover_url(&self, id: &str, size: u32) -> String {
        self.url("getCoverArt", &[("id", id.to_string()), ("size", size.to_string())])
    }

    pub fn http(&self) -> &reqwest::blocking::Client {
        &self.http
    }
}

pub fn error_red(e: &reqwest::Error) -> SubsonicError {
    let msg = if e.is_timeout() {
        "Tiempo de espera agotado al conectar con el servidor.".to_string()
    } else if e.is_connect() {
        "No se puede conectar con el servidor. Revisa la dirección y tu conexión a internet.".to_string()
    } else if e.is_builder() {
        "La dirección del servidor no es válida.".to_string()
    } else {
        format!("Error de red: {e}")
    };
    SubsonicError::Network(msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_coincide_con_el_ejemplo_de_la_especificacion() {
        // Ejemplo oficial de la documentación de Subsonic.
        assert_eq!(token("sesame", "c19b2d"), "26719a1196d2a940705a59634eb18eab");
    }

    #[test]
    fn la_sal_tiene_12_caracteres_y_cambia() {
        let a = salt_aleatoria();
        let b = salt_aleatoria();
        assert_eq!(a.len(), 12);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric()));
        assert_ne!(a, b);
    }

    #[test]
    fn los_parametros_de_autenticacion_son_correctos() {
        let p = auth_params("ana", "clave", "abc123abc123");
        let get = |k: &str| p.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone()).unwrap();
        assert_eq!(get("u"), "ana");
        assert_eq!(get("s"), "abc123abc123");
        assert_eq!(get("t"), token("clave", "abc123abc123"));
        assert_eq!(get("v"), "1.16.1");
        assert_eq!(get("c"), "OmniCasterMusic");
        assert_eq!(get("f"), "json");
        assert!(!p.iter().any(|(_, v)| v == "clave"), "la contraseña nunca viaja en claro");
    }

    #[test]
    fn la_url_no_contiene_la_contrasena() {
        let c = Client::new("ejemplo.org/", "ana", "secreta");
        let u = c.url("ping", &[]);
        assert!(u.starts_with("https://ejemplo.org/rest/ping?"));
        assert!(!u.contains("secreta"));
    }

    #[test]
    fn normaliza_la_direccion_del_servidor() {
        assert_eq!(normalizar_servidor("cloud.ngradio.es"), "https://cloud.ngradio.es");
        assert_eq!(normalizar_servidor(" http://x.org:4533/rest/ "), "http://x.org:4533");
    }

    #[test]
    fn error_40_se_traduce() {
        let r = parse_response(
            r#"{"subsonic-response":{"status":"failed","version":"1.16.1","error":{"code":40,"message":"Wrong username or password"}}}"#,
        );
        let e = r.unwrap_err();
        assert_eq!(e.code(), Some(40));
        assert_eq!(e.to_string(), "Usuario o contraseña incorrectos.");
    }

    #[test]
    fn respuesta_que_no_es_subsonic() {
        assert!(matches!(parse_response("<html>"), Err(SubsonicError::Parse(_))));
        assert!(matches!(parse_response(r#"{"otro":1}"#), Err(SubsonicError::Parse(_))));
    }

    #[test]
    fn cancion_con_campos_ausentes_no_rompe() {
        let body: Value = serde_json::from_str(
            r#"{"searchResult3":{"song":[
                {"id":"1","title":"Solo título"},
                {"id":2,"title":"Id numérico","track":"7","year":"1999","duration":183.0,"size":"1234"},
                {"title":"Sin id"}
            ]}}"#,
        )
        .unwrap();
        let r = parse_search3(&body);
        assert_eq!(r.songs.len(), 2, "la canción sin id se descarta");
        assert_eq!(r.songs[0].track, None);
        assert_eq!(r.songs[0].year, None);
        assert_eq!(r.songs[0].cover_art, None);
        assert_eq!(r.songs[1].id.as_deref(), Some("2"));
        assert_eq!(r.songs[1].track, Some(7));
        assert_eq!(r.songs[1].year, Some(1999));
        assert_eq!(r.songs[1].duration, Some(183));
        assert_eq!(r.songs[1].size, Some(1234));
        assert!(r.albums.is_empty() && r.artists.is_empty());
    }

    #[test]
    fn lista_de_albumes_y_artistas() {
        let body: Value = serde_json::from_str(
            r#"{"albumList2":{"album":[{"id":"a1","name":"Uno","artist":"X","year":2020,"songCount":3},{"id":"a2"}]},
                "artists":{"index":[{"name":"A","artist":[{"id":"r1","name":"Alfa","albumCount":2}]},{"name":"B","artist":[{"id":"r2","name":"Beta"}]}]}}"#,
        )
        .unwrap();
        let albums = parse_album_list(&body);
        assert_eq!(albums.len(), 2);
        assert_eq!(albums[1].name, None);
        assert_eq!(albums[0].song_count, Some(3));
        let artists = parse_artists(&body);
        assert_eq!(artists.len(), 2);
        assert_eq!(artists[1].album_count, None);
    }

    #[test]
    fn album_hereda_caratula_y_id_en_sus_canciones() {
        let body: Value = serde_json::from_str(
            r#"{"album":{"id":"a1","name":"Uno","coverArt":"al-1","song":[{"id":"s1","title":"T"}]}}"#,
        )
        .unwrap();
        let a = parse_album(&body).unwrap();
        assert_eq!(a.songs[0].album_id.as_deref(), Some("a1"));
        assert_eq!(a.songs[0].cover_art.as_deref(), Some("al-1"));
    }

    #[test]
    fn replaygain_opensubsonic() {
        let body: Value = serde_json::from_str(
            r#"{"searchResult3":{"song":[{"id":"1","replayGain":{"trackGain":-6.5,"albumGain":"-5.1"}}]}}"#,
        )
        .unwrap();
        let s = &parse_search3(&body).songs[0];
        let rg = s.replay_gain.as_ref().unwrap();
        assert_eq!(rg.track_gain, Some(-6.5));
        assert_eq!(rg.album_gain, Some(-5.1));
    }

    #[test]
    fn un_unico_elemento_como_objeto_tambien_se_acepta() {
        let body: Value = serde_json::from_str(r#"{"searchResult3":{"song":{"id":"9","title":"Suelta"}}}"#).unwrap();
        assert_eq!(parse_search3(&body).songs.len(), 1);
    }

    #[test]
    fn info_del_servidor() {
        let body: Value = serde_json::from_str(
            r#"{"status":"ok","version":"1.16.1","type":"navidrome","serverVersion":"0.53","openSubsonic":true}"#,
        )
        .unwrap();
        let i = parse_server_info(&body);
        assert!(i.open_subsonic);
        assert_eq!(i.server_type.as_deref(), Some("navidrome"));
    }
}
