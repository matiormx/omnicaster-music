//! Almacén local en SQLite: biblioteca, claves/valores del usuario y sin conexión.

use crate::subsonic::{Album, Artist, Song};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Biblioteca {
    pub artistas: Vec<ArtistaFila>,
    pub albumes: Vec<AlbumFila>,
    pub canciones: Vec<CancionFila>,
    pub sincronizada: Option<i64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArtistaFila {
    pub id: String,
    pub nombre: String,
    pub albumes: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AlbumFila {
    pub id: String,
    pub nombre: String,
    pub artista: String,
    pub artista_id: Option<String>,
    pub anio: Option<u32>,
    pub genero: Option<String>,
    pub caratula: Option<String>,
    pub canciones: u32,
    pub duracion: u32,
    pub creado: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CancionFila {
    pub id: String,
    pub titulo: String,
    pub artista: String,
    pub artista_id: Option<String>,
    pub album: String,
    pub album_id: Option<String>,
    pub pista: Option<u32>,
    pub disco: Option<u32>,
    pub anio: Option<u32>,
    pub genero: Option<String>,
    pub duracion: u32,
    pub caratula: Option<String>,
    pub formato: Option<String>,
    pub ganancia_db: Option<f32>,
}

pub fn abrir(ruta: &Path) -> rusqlite::Result<Connection> {
    let c = Connection::open(ruta)?;
    iniciar(&c)?;
    Ok(c)
}

pub fn iniciar(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS artistas(id TEXT PRIMARY KEY, nombre TEXT NOT NULL, albumes INTEGER NOT NULL DEFAULT 0);
         CREATE TABLE IF NOT EXISTS albumes(id TEXT PRIMARY KEY, nombre TEXT NOT NULL, artista TEXT NOT NULL, artista_id TEXT,
            anio INTEGER, genero TEXT, caratula TEXT, canciones INTEGER NOT NULL DEFAULT 0, duracion INTEGER NOT NULL DEFAULT 0, creado TEXT);
         CREATE TABLE IF NOT EXISTS canciones(id TEXT PRIMARY KEY, titulo TEXT NOT NULL, artista TEXT NOT NULL, artista_id TEXT,
            album TEXT NOT NULL, album_id TEXT, pista INTEGER, disco INTEGER, anio INTEGER, genero TEXT, duracion INTEGER NOT NULL DEFAULT 0,
            caratula TEXT, formato TEXT, ganancia_db REAL);
         CREATE INDEX IF NOT EXISTS idx_canciones_album ON canciones(album_id);
         CREATE TABLE IF NOT EXISTS kv(clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS sin_conexion(cancion_id TEXT PRIMARY KEY, ruta TEXT NOT NULL, tam INTEGER NOT NULL DEFAULT 0);",
    )
}

fn texto(o: &Option<String>, defecto: &str) -> String {
    o.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| defecto.to_string())
}

pub fn reemplazar_biblioteca(c: &mut Connection, artistas: &[Artist], albumes: &[Album], canciones: &[Song]) -> rusqlite::Result<()> {
    let tx = c.transaction()?;
    tx.execute_batch("DELETE FROM artistas; DELETE FROM albumes; DELETE FROM canciones;")?;
    {
        let mut st = tx.prepare("INSERT OR REPLACE INTO artistas VALUES (?1,?2,?3)")?;
        for a in artistas {
            if let Some(id) = &a.id {
                st.execute(params![id, texto(&a.name, "Artista desconocido"), a.album_count.unwrap_or(0)])?;
            }
        }
        let mut st = tx.prepare("INSERT OR REPLACE INTO albumes VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;
        for a in albumes {
            if let Some(id) = &a.id {
                st.execute(params![
                    id,
                    texto(&a.name, "Álbum sin título"),
                    texto(&a.artist, "Artista desconocido"),
                    a.artist_id,
                    a.year,
                    a.genre,
                    a.cover_art,
                    a.song_count.unwrap_or(0),
                    a.duration.unwrap_or(0),
                    a.created
                ])?;
            }
        }
        let mut st = tx.prepare("INSERT OR REPLACE INTO canciones VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)")?;
        for s in canciones {
            if let Some(id) = &s.id {
                st.execute(params![
                    id,
                    texto(&s.title, "Sin título"),
                    texto(&s.artist, "Artista desconocido"),
                    s.artist_id,
                    texto(&s.album, "Álbum desconocido"),
                    s.album_id,
                    s.track,
                    s.disc_number,
                    s.year,
                    s.genre,
                    s.duration.unwrap_or(0),
                    s.cover_art,
                    s.suffix,
                    s.replay_gain.as_ref().and_then(|r| r.track_gain)
                ])?;
            }
        }
    }
    tx.execute("INSERT OR REPLACE INTO kv VALUES ('sincronizada', ?1)", params![ahora().to_string()])?;
    tx.commit()
}

pub fn ahora() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn cargar_biblioteca(c: &Connection) -> rusqlite::Result<Biblioteca> {
    let artistas = c
        .prepare("SELECT id,nombre,albumes FROM artistas ORDER BY nombre COLLATE NOCASE")?
        .query_map([], |r| Ok(ArtistaFila { id: r.get(0)?, nombre: r.get(1)?, albumes: r.get(2)? }))?
        .collect::<Result<Vec<_>, _>>()?;
    let albumes = c
        .prepare("SELECT id,nombre,artista,artista_id,anio,genero,caratula,canciones,duracion,creado FROM albumes")?
        .query_map([], |r| {
            Ok(AlbumFila {
                id: r.get(0)?,
                nombre: r.get(1)?,
                artista: r.get(2)?,
                artista_id: r.get(3)?,
                anio: r.get(4)?,
                genero: r.get(5)?,
                caratula: r.get(6)?,
                canciones: r.get(7)?,
                duracion: r.get(8)?,
                creado: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let canciones = c
        .prepare("SELECT id,titulo,artista,artista_id,album,album_id,pista,disco,anio,genero,duracion,caratula,formato,ganancia_db FROM canciones")?
        .query_map([], |r| {
            Ok(CancionFila {
                id: r.get(0)?,
                titulo: r.get(1)?,
                artista: r.get(2)?,
                artista_id: r.get(3)?,
                album: r.get(4)?,
                album_id: r.get(5)?,
                pista: r.get(6)?,
                disco: r.get(7)?,
                anio: r.get(8)?,
                genero: r.get(9)?,
                duracion: r.get(10)?,
                caratula: r.get(11)?,
                formato: r.get(12)?,
                ganancia_db: r.get::<_, Option<f64>>(13)?.map(|g| g as f32),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let sincronizada = kv_get(c, "sincronizada")?.and_then(|s| s.parse().ok());
    Ok(Biblioteca { artistas, albumes, canciones, sincronizada })
}

pub fn kv_get(c: &Connection, clave: &str) -> rusqlite::Result<Option<String>> {
    c.query_row("SELECT valor FROM kv WHERE clave=?1", params![clave], |r| r.get(0)).optional()
}

pub fn kv_set(c: &Connection, clave: &str, valor: &str) -> rusqlite::Result<()> {
    c.execute("INSERT OR REPLACE INTO kv VALUES (?1,?2)", params![clave, valor])?;
    Ok(())
}

pub fn kv_borrar(c: &Connection, clave: &str) -> rusqlite::Result<()> {
    c.execute("DELETE FROM kv WHERE clave=?1", params![clave])?;
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SinConexion {
    pub id: String,
    pub ruta: String,
    pub tam: u64,
}

pub fn sc_listar(c: &Connection) -> rusqlite::Result<Vec<SinConexion>> {
    c.prepare("SELECT cancion_id,ruta,tam FROM sin_conexion")?
        .query_map([], |r| Ok(SinConexion { id: r.get(0)?, ruta: r.get(1)?, tam: r.get::<_, i64>(2)? as u64 }))?
        .collect()
}

pub fn sc_guardar(c: &Connection, id: &str, ruta: &str, tam: u64) -> rusqlite::Result<()> {
    c.execute("INSERT OR REPLACE INTO sin_conexion VALUES (?1,?2,?3)", params![id, ruta, tam as i64])?;
    Ok(())
}

pub fn sc_ruta(c: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    c.query_row("SELECT ruta FROM sin_conexion WHERE cancion_id=?1", params![id], |r| r.get(0)).optional()
}

pub fn sc_borrar(c: &Connection, id: &str) -> rusqlite::Result<Option<String>> {
    let r = sc_ruta(c, id)?;
    c.execute("DELETE FROM sin_conexion WHERE cancion_id=?1", params![id])?;
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guarda_y_carga_con_campos_ausentes() {
        let mut c = Connection::open_in_memory().unwrap();
        iniciar(&c).unwrap();
        let s = Song { id: Some("1".into()), ..Default::default() };
        let a = Album { id: Some("a".into()), ..Default::default() };
        reemplazar_biblioteca(&mut c, &[], &[a], &[s]).unwrap();
        let b = cargar_biblioteca(&c).unwrap();
        assert_eq!(b.canciones[0].titulo, "Sin título");
        assert_eq!(b.canciones[0].pista, None);
        assert_eq!(b.albumes[0].nombre, "Álbum sin título");
        assert!(b.sincronizada.is_some());
    }

    #[test]
    fn kv_y_sin_conexion() {
        let c = Connection::open_in_memory().unwrap();
        iniciar(&c).unwrap();
        assert_eq!(kv_get(&c, "x").unwrap(), None);
        kv_set(&c, "x", "1").unwrap();
        kv_set(&c, "x", "2").unwrap();
        assert_eq!(kv_get(&c, "x").unwrap().as_deref(), Some("2"));
        sc_guardar(&c, "s1", "/tmp/s1.flac", 10).unwrap();
        assert_eq!(sc_listar(&c).unwrap().len(), 1);
        assert_eq!(sc_borrar(&c, "s1").unwrap().as_deref(), Some("/tmp/s1.flac"));
        assert!(sc_listar(&c).unwrap().is_empty());
    }
}
