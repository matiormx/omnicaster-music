// Backend web: solo para desarrollo y pruebas con Playwright (sin Tauri).
// Habla directamente con el servidor Subsonic desde el navegador y reproduce con <audio>.
import { md5 } from './md5'
import type { Album, Artista, Backend, Biblioteca, Cancion, ControlMedios, EventoAudio, ListaServidor, PistaPeticion } from '../types'

interface Cred { servidor: string; usuario: string; clave: string }
let cred: Cred | null = null
const CLAVE_SESION = 'omnicaster.web.cred'

const MENSAJES: Record<number, string> = {
  10: 'Falta un parámetro obligatorio en la petición.',
  20: 'La aplicación es demasiado antigua para este servidor.',
  30: 'El servidor es demasiado antiguo para esta aplicación.',
  40: 'Usuario o contraseña incorrectos.',
  50: 'Este usuario no tiene permiso para hacer eso.',
  70: 'No se ha encontrado lo que se pedía en el servidor.',
}

function normalizar(s: string) {
  s = s.trim()
  if (!s.includes('://')) s = 'https://' + s
  return s.replace(/\/+$/, '').replace(/\/rest$/, '')
}

function url(c: Cred, metodo: string, extra: Record<string, string> = {}) {
  const sal = Math.random().toString(36).slice(2, 14).padEnd(12, 'x')
  const p = new URLSearchParams({ u: c.usuario, t: md5(c.clave + sal), s: sal, v: '1.16.1', c: 'OmniCasterMusic', f: 'json', ...extra })
  return `${normalizar(c.servidor)}/rest/${metodo}?${p}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function llamar(c: Cred, metodo: string, extra: Record<string, string> = {}): Promise<any> {
  let r: Response
  try { r = await fetch(url(c, metodo, extra)) } catch {
    throw 'No se puede conectar con el servidor. Revisa la dirección y tu conexión a internet.'
  }
  if (!r.ok) throw `El servidor respondió con el código HTTP ${r.status}.`
  const j = await r.json().catch(() => null)
  const b = j?.['subsonic-response']
  if (!b) throw 'El servidor no ha devuelto una respuesta Subsonic válida.'
  if (b.status === 'failed') throw MENSAJES[b.error?.code] ?? `Error ${b.error?.code} del servidor: ${b.error?.message ?? ''}`
  return b
}

const num = (v: unknown) => { const n = Number(v); return v == null || v === '' || !Number.isFinite(n) ? null : n }
const aCancion = (s: any): Cancion => ({
  id: String(s.id), titulo: s.title || 'Sin título', artista: s.artist || 'Artista desconocido', artistaId: s.artistId ? String(s.artistId) : null,
  album: s.album || 'Álbum desconocido', albumId: s.albumId ? String(s.albumId) : null, pista: num(s.track), disco: num(s.discNumber),
  anio: num(s.year), genero: s.genre ?? null, duracion: num(s.duration) ?? 0, caratula: s.coverArt ? String(s.coverArt) : null,
  formato: s.suffix ?? null, gananciaDb: num(s.replayGain?.trackGain),
})
const aAlbum = (a: any): Album => ({
  id: String(a.id), nombre: a.name || 'Álbum sin título', artista: a.artist || 'Artista desconocido', artistaId: a.artistId ? String(a.artistId) : null,
  anio: num(a.year), genero: a.genre ?? null, caratula: a.coverArt ? String(a.coverArt) : null, canciones: num(a.songCount) ?? 0, duracion: num(a.duration) ?? 0, creado: a.created ?? null,
})

let biblioteca: Biblioteca = { artistas: [], albumes: [], canciones: [] }
const kv = (k: string) => `omnicaster.web.kv.${k}`

// ---- audio simulado con <audio>
const oyentes = new Set<(e: EventoAudio) => void>()
const emitir = (e: EventoAudio) => oyentes.forEach((f) => f(e))
let el: HTMLAudioElement | null = null
let idActual: string | null = null
let siguiente: { id: string; url: string } | null = null
let vol = 1
let intervalo: ReturnType<typeof setInterval> | null = null

function urlPista(p: PistaPeticion) { return url(cred!, 'download', { id: p.id }) }
function asegurarAudio() {
  if (el) return el
  el = new Audio()
  el.preload = 'auto'
  el.volume = vol
  el.addEventListener('ended', () => {
    if (siguiente) {
      const s = siguiente
      siguiente = null
      idActual = s.id
      el!.src = s.url
      void el!.play().catch(() => {})
      emitir({ tipo: 'pistaCambiada', id: s.id })
    } else {
      idActual = null
      emitir({ tipo: 'terminada' })
    }
  })
  el.addEventListener('error', () => emitir({ tipo: 'error', id: idActual, mensaje: 'No se pudo reproducir la pista.' }))
  intervalo = setInterval(() => {
    if (el && idActual) emitir({ tipo: 'estado', id: idActual, posicion: el.currentTime, duracion: Number.isFinite(el.duration) ? el.duration : 0, reproduciendo: !el.paused })
  }, 250)
  void intervalo
  return el
}

export const backendWeb: Backend = {
  kind: 'web',
  async probar(servidor, usuario, clave) {
    const b = await llamar({ servidor, usuario, clave }, 'ping')
    return { version: b.version ?? '', serverType: b.type ?? null, serverVersion: b.serverVersion ?? null, openSubsonic: !!b.openSubsonic }
  },
  async guardarConexion(servidor, usuario, clave) {
    await llamar({ servidor, usuario, clave }, 'ping')
    cred = { servidor: normalizar(servidor), usuario, clave }
    sessionStorage.setItem(CLAVE_SESION, JSON.stringify(cred))
    localStorage.setItem(kv('conexion'), JSON.stringify({ servidor: cred.servidor, usuario }))
    return null
  },
  async conexionActual() {
    const s = sessionStorage.getItem(CLAVE_SESION)
    if (s) cred = JSON.parse(s)
    const g = localStorage.getItem(kv('conexion'))
    if (!g) return null
    const c = JSON.parse(g)
    return { servidor: c.servidor, usuario: c.usuario, necesitaClave: !cred }
  },
  async olvidar() { cred = null; sessionStorage.clear(); localStorage.removeItem(kv('conexion')) },
  async cargarBiblioteca() {
    const g = localStorage.getItem(kv('biblioteca'))
    if (g) biblioteca = JSON.parse(g)
    return biblioteca
  },
  async sincronizar(onProgreso) {
    const c = cred!
    const albumes: Album[] = []
    for (let o = 0; ; o += 500) {
      const b = await llamar(c, 'getAlbumList2', { type: 'alphabeticalByName', size: '500', offset: String(o) })
      const l = (b.albumList2?.album ?? []).map(aAlbum)
      albumes.push(...l); onProgreso('albumes', albumes.length)
      if (l.length < 500) break
    }
    const b = await llamar(c, 'getArtists')
    const artistas: Artista[] = (b.artists?.index ?? []).flatMap((i: any) => i.artist ?? []).map((a: any) => ({ id: String(a.id), nombre: a.name || 'Artista desconocido', albumes: num(a.albumCount) ?? 0 }))
    const canciones: Cancion[] = []
    for (let o = 0; ; o += 500) {
      const r = await llamar(c, 'search3', { query: '', artistCount: '0', albumCount: '0', songCount: '500', songOffset: String(o) })
      const l = (r.searchResult3?.song ?? []).map(aCancion)
      canciones.push(...l); onProgreso('canciones', canciones.length)
      if (l.length < 500) break
    }
    const porAlbum = new Map(albumes.map((a) => [a.id, a]))
    for (const s of canciones) {
      const a = s.albumId ? porAlbum.get(s.albumId) : undefined
      if (a) { s.caratula ??= a.caratula; s.genero ??= a.genero; s.anio ??= a.anio }
    }
    biblioteca = { artistas, albumes, canciones, sincronizada: Math.floor(Date.now() / 1000) }
    localStorage.setItem(kv('biblioteca'), JSON.stringify(biblioteca))
    return biblioteca
  },
  async leer(k) { return localStorage.getItem(kv(k)) },
  async guardar(k, v) { localStorage.setItem(kv(k), v) },
  async listasServidor(): Promise<ListaServidor[]> {
    try {
      const b = await llamar(cred!, 'getPlaylists')
      const out: ListaServidor[] = []
      for (const p of b.playlists?.playlist ?? []) {
        const d = await llamar(cred!, 'getPlaylist', { id: String(p.id) })
        out.push({ id: String(p.id), nombre: p.name, canciones: (d.playlist?.entry ?? []).map((s: any) => String(s.id)) })
      }
      return out
    } catch { return [] }
  },
  async favoritosServidor() {
    try { return ((await llamar(cred!, 'getStarred2')).starred2?.song ?? []).map((s: any) => String(s.id)) } catch { return [] }
  },
  async marcar(id, f) { try { await llamar(cred!, f ? 'star' : 'unstar', { id }) } catch { /* el servidor puede no admitirlo */ } },
  async registrar(id) { try { await llamar(cred!, 'scrobble', { id, submission: 'true' }) } catch { /* idem */ } },
  async aleatorias(genero, n = 50) {
    const b = await llamar(cred!, 'getRandomSongs', { size: String(n), ...(genero ? { genre: genero } : {}) })
    return (b.randomSongs?.song ?? []).map(aCancion)
  },
  caratula: (id, tam) => (cred ? url(cred, 'getCoverArt', { id, size: String(tam) }) : ''),
  async reproducir(p, inicio = 0) {
    const a = asegurarAudio()
    idActual = p.id; siguiente = null
    a.src = urlPista(p)
    if (inicio > 0) a.currentTime = inicio
    await a.play().catch(() => {})
  },
  async siguiente(p) { siguiente = p ? { id: p.id, url: urlPista(p) } : null },
  async pausa(b) { const a = asegurarAudio(); if (b) a.pause(); else await a.play().catch(() => {}) },
  async buscar(s) { asegurarAudio().currentTime = s },
  async volumen(v) { vol = v; if (el) el.volume = v },
  async parar() { el?.pause(); idActual = null; siguiente = null },
  onAudio(cb) { oyentes.add(cb); return () => oyentes.delete(cb) },
  async medios() {},
  async mediosEstado() {},
  onMedios(_cb: (c: ControlMedios) => void) { return () => {} },
  async sinConexionDescargar() {},
  async sinConexionListar() { return [] },
  async sinConexionBorrar() { return 0 },
  async sinConexionCarpeta() { return '(solo disponible en la aplicación de escritorio)' },
  onDescarga() { return () => {} },
  async elegirCarpeta() { return null },
  async buscarActualizacion() { return null },
}
