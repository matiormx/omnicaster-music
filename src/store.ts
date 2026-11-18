// Estado global de la aplicación y lógica del reproductor (cola, historial, favoritos, listas…).
import { useSyncExternalStore } from 'react'
import { backend } from './backend'
import { ErrorOc, LIMITE_MASIVO, oc, puede, rolDelUsuario } from './oc'
import type { Album, Biblioteca, Cancion, ControlMedios, EventoAudio, Lista, PistaPeticion, ProgresoSubida, ResultadoSubida, Rol } from './types'

export type Ruta =
  | { t: 'inicio' } | { t: 'explorar' } | { t: 'radio' } | { t: 'artistas' } | { t: 'albumes' } | { t: 'canciones' }
  | { t: 'generos' } | { t: 'listas' } | { t: 'favoritos' } | { t: 'sinconexion' } | { t: 'busqueda' }
  | { t: 'revision' } | { t: 'desactivadas' }
  | { t: 'album'; id: string } | { t: 'artista'; id: string } | { t: 'genero'; id: string } | { t: 'lista'; id: string }

export type Repetir = 'no' | 'cola' | 'una'
export type Tema = 'sistema' | 'claro' | 'oscuro'

export interface Indices {
  cancion: Map<string, Cancion>
  album: Map<string, Album>
  deAlbum: Map<string, Cancion[]>
  generos: { nombre: string; canciones: number }[]
}

export interface Aviso { id: number; texto: string; tipo: 'info' | 'error' }
export interface ItemMenu { texto?: string; accion?: () => void; separador?: boolean; peligro?: boolean; sub?: ItemMenu[] }

export interface Estado {
  fase: 'cargando' | 'conexion' | 'lista'
  servidor: string
  usuario: string
  necesitaClave: boolean
  bib: Biblioteca
  idx: Indices
  sincronizando: string | null
  ruta: Ruta
  pilaRutas: Ruta[]
  busqueda: string
  cola: string[]
  indice: number
  actual: string | null
  reproduciendo: boolean
  posicion: number
  duracion: number
  volumen: number
  aleatorio: boolean
  repetir: Repetir
  favoritos: string[]
  historial: { id: string; en: number }[]
  listas: Lista[]
  sinConexion: Record<string, number>
  descarga: { hecho: number; total: number } | null
  carpetaSinConexion: string
  panelCola: boolean
  pantallaCompleta: boolean
  tema: Tema
  avisos: Aviso[]
  menu: { x: number; y: number; items: ItemMenu[] } | null
  nuevaLista: string[] | null
  /** Permisos de este usuario en la nube (los comprueba el servidor en cada llamada) */
  rol: Rol
  /** Ficha de una canción abierta */
  ficha: string | null
  /** Canciones que se están editando */
  editar: string[] | null
  /** Cambio masivo (más de 10) pendiente de confirmar de forma explícita */
  confirmacion: { texto: string; n: number; ejecutar: (confirm: number) => Promise<void> } | null
  subida: { progreso: ProgresoSubida | null; resultado: ResultadoSubida | null; activa: boolean } | null
  actualizacion: { version: string; instalar: () => Promise<void> } | null
}

const vacia: Biblioteca = { artistas: [], albumes: [], canciones: [] }

export function indexar(b: Biblioteca): Indices {
  const cancion = new Map(b.canciones.map((c) => [c.id, c]))
  const album = new Map(b.albumes.map((a) => [a.id, a]))
  const deAlbum = new Map<string, Cancion[]>()
  for (const c of b.canciones) {
    if (!c.albumId) continue
    const l = deAlbum.get(c.albumId)
    if (l) l.push(c)
    else deAlbum.set(c.albumId, [c])
  }
  for (const l of deAlbum.values()) l.sort((x, y) => (x.disco ?? 1) - (y.disco ?? 1) || (x.pista ?? 9999) - (y.pista ?? 9999) || x.titulo.localeCompare(y.titulo, 'es'))
  const g = new Map<string, number>()
  for (const c of b.canciones) if (c.genero) g.set(c.genero, (g.get(c.genero) ?? 0) + 1)
  for (const a of b.albumes) if (a.genero && !g.has(a.genero)) g.set(a.genero, 0)
  const generos = [...g].map(([nombre, canciones]) => ({ nombre, canciones })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  return { cancion, album, deAlbum, generos }
}

let estado: Estado = {
  fase: 'cargando', servidor: '', usuario: '', necesitaClave: false,
  bib: vacia, idx: indexar(vacia), sincronizando: null,
  ruta: { t: 'inicio' }, pilaRutas: [], busqueda: '',
  cola: [], indice: -1, actual: null, reproduciendo: false, posicion: 0, duracion: 0, volumen: 0.8, aleatorio: false, repetir: 'no',
  favoritos: [], historial: [], listas: [], sinConexion: {}, descarga: null, carpetaSinConexion: '',
  panelCola: true, pantallaCompleta: false, tema: 'sistema', avisos: [], menu: null, nuevaLista: null, rol: 'listener', ficha: null, editar: null, confirmacion: null, subida: null, actualizacion: null,
}
const oyentes = new Set<() => void>()

export const obtener = () => estado
export function poner(p: Partial<Estado> | ((s: Estado) => Partial<Estado>)) {
  estado = { ...estado, ...(typeof p === 'function' ? p(estado) : p) }
  oyentes.forEach((f) => f())
}
export function useApp<T>(sel: (s: Estado) => T): T {
  return useSyncExternalStore(
    (f) => { oyentes.add(f); return () => oyentes.delete(f) },
    () => sel(estado),
  )
}

// ---------------------------------------------------------------- utilidades

export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function formatoTiempo(seg: number): string {
  if (!Number.isFinite(seg) || seg < 0) seg = 0
  const s = Math.floor(seg)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export function formatoDuracionTotal(seg: number): string {
  const m = Math.round(seg / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

export function formatoBytes(b: number): string {
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}

let contadorAvisos = 1
declare const __VERSION__: string
export const VERSION_APP = typeof __VERSION__ === 'string' ? __VERSION__ : ''

export async function buscarActualizaciones() {
  aviso('Buscando actualizaciones…')
  try {
    const a = await backend.buscarActualizacion()
    if (a) {
      poner({ actualizacion: a })
      aviso(`Hay una versión nueva: ${a.version}`)
    } else {
      aviso(`Ya tienes la última versión (${VERSION_APP}).`)
    }
  } catch (e) {
    aviso(`No se pudo comprobar las actualizaciones: ${mensajeError(e)}`, 'error')
  }
}

export function aviso(texto: string, tipo: Aviso['tipo'] = 'info') {
  const id = contadorAvisos++
  poner((s) => ({ avisos: [...s.avisos, { id, texto, tipo }] }))
  setTimeout(() => poner((s) => ({ avisos: s.avisos.filter((a) => a.id !== id) })), 5000)
}

function mensajeError(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : 'Ha ocurrido un error inesperado.'
}

async function guardarJson(clave: string, valor: unknown) {
  try { await backend.guardar(clave, JSON.stringify(valor)) } catch { /* no es crítico */ }
}
async function leerJson<T>(clave: string, defecto: T): Promise<T> {
  try {
    const v = await backend.leer(clave)
    return v ? (JSON.parse(v) as T) : defecto
  } catch { return defecto }
}

// ---------------------------------------------------------------- navegación

export function navegar(r: Ruta) {
  poner((s) => ({ pilaRutas: [...s.pilaRutas.slice(-30), s.ruta], ruta: r, menu: null, pantallaCompleta: false }))
}
export function atras() {
  poner((s) => {
    const pila = [...s.pilaRutas]
    const r = pila.pop()
    return r ? { ruta: r, pilaRutas: pila } : {}
  })
}
export function buscar(q: string) {
  poner((s) => {
    if (q && s.ruta.t !== 'busqueda') return { busqueda: q, pilaRutas: [...s.pilaRutas.slice(-30), s.ruta], ruta: { t: 'busqueda' } }
    if (!q && s.ruta.t === 'busqueda') {
      const pila = [...s.pilaRutas]
      return { busqueda: q, ruta: pila.pop() ?? { t: 'inicio' }, pilaRutas: pila }
    }
    return { busqueda: q }
  })
}

// ---------------------------------------------------------------- reproductor

let preparado: number | null = null
let erroresSeguidos = 0

export function pistaDe(id: string): PistaPeticion {
  const c = estado.idx.cancion.get(id)
  return { id, formato: c?.formato ?? null, gananciaDb: c?.gananciaDb ?? null }
}

function indiceSiguiente(s: Estado): number | null {
  if (!s.cola.length) return null
  if (s.repetir === 'una') return s.indice
  if (s.indice + 1 < s.cola.length) return s.indice + 1
  if (s.repetir === 'cola') return 0
  return null
}

async function prepararSiguiente() {
  const i = indiceSiguiente(estado)
  preparado = i
  try { await backend.siguiente(i == null ? null : pistaDe(estado.cola[i])) } catch { /* se reintenta al avanzar */ }
}

function mezclar<T>(a: T[], desde: number): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > desde; i--) {
    const j = desde + Math.floor(Math.random() * (i - desde + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

function alCambiarPista(id: string) {
  const c = estado.idx.cancion.get(id)
  poner((s) => ({
    actual: id,
    posicion: 0,
    duracion: c?.duracion ?? 0,
    historial: [{ id, en: Date.now() }, ...s.historial.filter((h) => h.id !== id)].slice(0, 200),
  }))
  void guardarJson('historial', estado.historial)
  void backend.registrar(id)
  if (c) void backend.medios(c.titulo, c.artista, c.album, c.caratula ?? null, c.duracion).catch(() => {})
}

async function iniciar(i: number, inicio = 0) {
  const id = estado.cola[i]
  if (!id) return
  poner({ indice: i, reproduciendo: true })
  alCambiarPista(id)
  try {
    await backend.reproducir(pistaDe(id), inicio)
    void prepararSiguiente()
  } catch (e) {
    poner({ reproduciendo: false })
    aviso(mensajeError(e), 'error')
  }
}

export function reproducirLista(ids: string[], i = 0, mezclarTodo = false) {
  const validos = ids.filter((id) => estado.idx.cancion.has(id))
  if (!validos.length) return
  const pos = Math.min(Math.max(i, 0), validos.length - 1)
  const aleatorio = mezclarTodo || estado.aleatorio
  let cola = validos
  if (mezclarTodo) {
    cola = mezclar(validos, 0)
    poner({ aleatorio: true })
  } else if (aleatorio) cola = mezclar(validos, pos)
  erroresSeguidos = 0
  poner({ cola, panelCola: estado.panelCola })
  void iniciar(mezclarTodo ? 0 : pos)
}

export function reproducirADespues(ids: string[]) {
  if (!estado.cola.length) return reproducirLista(ids)
  const cola = [...estado.cola]
  cola.splice(estado.indice + 1, 0, ...ids)
  poner({ cola })
  void prepararSiguiente()
  aviso(ids.length === 1 ? 'Se reproducirá a continuación' : `${ids.length} canciones se reproducirán a continuación`)
}

export function anadirACola(ids: string[]) {
  if (!estado.cola.length) return reproducirLista(ids)
  poner({ cola: [...estado.cola, ...ids] })
  void prepararSiguiente()
  aviso(ids.length === 1 ? 'Añadida a la cola' : `${ids.length} canciones añadidas a la cola`)
}

export function irACola(i: number) { erroresSeguidos = 0; void iniciar(i) }

export function reordenarCola(desde: number, hasta: number) {
  if (desde === hasta) return
  const cola = [...estado.cola]
  const [x] = cola.splice(desde, 1)
  cola.splice(hasta, 0, x)
  let indice = estado.indice
  if (desde === indice) indice = hasta
  else if (desde < indice && hasta >= indice) indice--
  else if (desde > indice && hasta <= indice) indice++
  poner({ cola, indice })
  void prepararSiguiente()
}

export function quitarDeCola(i: number) {
  if (i === estado.indice) return
  const cola = estado.cola.filter((_, k) => k !== i)
  poner({ cola, indice: i < estado.indice ? estado.indice - 1 : estado.indice })
  void prepararSiguiente()
}

export async function alternarPausa() {
  const s = estado
  if (!s.actual) return
  const reproduciendo = !s.reproduciendo
  poner({ reproduciendo })
  try { await backend.pausa(!reproduciendo) } catch (e) { aviso(mensajeError(e), 'error') }
  void backend.mediosEstado(reproduciendo, s.posicion).catch(() => {})
}

export function siguiente() {
  const s = estado
  if (!s.cola.length) return
  const i = s.indice + 1 < s.cola.length ? s.indice + 1 : s.repetir === 'cola' || s.repetir === 'una' ? 0 : null
  if (i != null) { erroresSeguidos = 0; void iniciar(i) } else { void backend.parar(); poner({ reproduciendo: false, posicion: 0 }) }
}

export function anterior() {
  const s = estado
  if (s.posicion > 3 || s.indice <= 0) { void irA(0); return }
  erroresSeguidos = 0
  void iniciar(s.indice - 1)
}

export async function irA(seg: number) {
  poner({ posicion: seg })
  try { await backend.buscar(seg) } catch (e) { aviso(mensajeError(e), 'error') }
}

export function ponerVolumen(v: number) {
  poner({ volumen: v })
  void backend.volumen(v)
  void backend.guardar('volumen', String(v))
}

export function alternarAleatorio() {
  const aleatorio = !estado.aleatorio
  poner((s) => ({ aleatorio, cola: aleatorio && s.indice >= 0 ? mezclar(s.cola, s.indice) : s.cola }))
  void prepararSiguiente()
  void backend.guardar('aleatorio', String(aleatorio))
}

export function ciclarRepetir() {
  const r: Repetir = estado.repetir === 'no' ? 'cola' : estado.repetir === 'cola' ? 'una' : 'no'
  poner({ repetir: r })
  void prepararSiguiente()
  void backend.guardar('repetir', r)
}

function alEventoAudio(e: EventoAudio) {
  const s = estado
  switch (e.tipo) {
    case 'estado':
      if (e.id !== s.actual) return
      poner({ posicion: e.posicion, duracion: e.duracion > 0 ? e.duracion : (s.idx.cancion.get(e.id!)?.duracion ?? 0), reproduciendo: e.reproduciendo })
      erroresSeguidos = 0
      break
    case 'pistaCambiada': {
      let i = preparado != null && s.cola[preparado] === e.id ? preparado : -1
      if (i < 0) i = s.cola.indexOf(e.id, Math.max(s.indice, 0))
      if (i < 0) i = s.cola.indexOf(e.id)
      if (i < 0) return
      poner({ indice: i })
      alCambiarPista(e.id)
      void prepararSiguiente()
      break
    }
    case 'terminada': {
      const i = indiceSiguiente(s)
      if (i != null && s.reproduciendo) void iniciar(i)
      else poner({ reproduciendo: false, posicion: 0 })
      break
    }
    case 'error':
      if (e.id === s.actual) {
        aviso(e.mensaje, 'error')
        if (++erroresSeguidos <= 5) siguiente()
        else poner({ reproduciendo: false })
      } else if (e.id) {
        aviso(`No se podrá reproducir «${s.idx.cancion.get(e.id)?.titulo ?? 'una pista'}»: ${e.mensaje}`, 'error')
      }
      break
  }
}

function alControlMedios(c: ControlMedios) {
  if (c === 'toggle') void alternarPausa()
  else if (c === 'play' && !estado.reproduciendo) void alternarPausa()
  else if (c === 'pause' && estado.reproduciendo) void alternarPausa()
  else if (c === 'next') siguiente()
  else if (c === 'previous') anterior()
  else if (c === 'stop') { void backend.parar(); poner({ reproduciendo: false }) }
}

// ---------------------------------------------------------------- favoritos y listas

export const esFavorito = (s: Estado, id: string) => s.favoritos.includes(id)

export function alternarFavorito(id: string) {
  const fav = !estado.favoritos.includes(id)
  poner((s) => ({ favoritos: fav ? [id, ...s.favoritos] : s.favoritos.filter((x) => x !== id) }))
  void guardarJson('favoritos', estado.favoritos)
  void backend.marcar(id, fav)
}

export function crearLista(nombre: string, canciones: string[] = []): Lista {
  const l: Lista = { id: `l-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, nombre: nombre.trim() || 'Lista nueva', canciones, grupo: 'lista' }
  poner((s) => ({ listas: [...s.listas, l] }))
  void guardarJson('listas', estado.listas)
  return l
}

/** Las listas de OmniCaster («bl-») las pueden cambiar operarios y administradores. Las de emisión («pl-») son de solo lectura. */
export const esListaServidor = (l: Lista) => !!l.servidorId
export const listaEditable = (l: Lista, rol: Rol = estado.rol) => !l.servidorId || (l.servidorId.startsWith('bl-') && puede(rol, 'operator'))
export const listaBorrable = (l: Lista, rol: Rol = estado.rol) => !l.servidorId || (l.servidorId.startsWith('bl-') && puede(rol, 'admin'))

export async function crearListaServidor(nombre: string, ids: string[]): Promise<Lista | null> {
  try {
    const b = await oc('createPlaylist', { name: nombre.trim(), songId: ids })
    await refrescarListasServidor()
    const id = b.playlist?.id ? `s-${b.playlist.id}` : null
    return estado.listas.find((l) => l.id === id) ?? null
  } catch (e) { aviso(mensajeError(e), 'error'); return null }
}

export function anadirALista(listaId: string, ids: string[]) {
  const l = estado.listas.find((x) => x.id === listaId)
  if (!l) return
  if (l.servidorId) {
    const nuevas = ids.filter((i) => !l.canciones.includes(i))
    if (!nuevas.length) return aviso('Ya estaban en la lista')
    oc('updatePlaylist', { playlistId: l.servidorId, songIdToAdd: nuevas })
      .then(() => { aviso('Añadida a la lista'); return refrescarListasServidor() })
      .catch((e) => aviso(mensajeError(e), 'error'))
    return
  }
  poner((s) => ({ listas: s.listas.map((x) => (x.id === listaId ? { ...x, canciones: [...x.canciones, ...ids.filter((i) => !x.canciones.includes(i))] } : x)) }))
  void guardarJson('listas', estado.listas)
  aviso('Añadida a la lista')
}
export function quitarDeLista(listaId: string, id: string) {
  const l = estado.listas.find((x) => x.id === listaId)
  if (!l) return
  if (l.servidorId) {
    // La posición es la de la lista tal como la devuelve el servidor
    const pos = l.canciones.map((c, i) => (c === id ? i : -1)).filter((i) => i >= 0)
    if (!pos.length) return
    oc('updatePlaylist', { playlistId: l.servidorId, songIndexToRemove: pos })
      .then(() => refrescarListasServidor())
      .catch((e) => aviso(mensajeError(e), 'error'))
    return
  }
  poner((s) => ({ listas: s.listas.map((x) => (x.id === listaId ? { ...x, canciones: x.canciones.filter((i) => i !== id) } : x)) }))
  void guardarJson('listas', estado.listas)
}
/** Quita la lista (no las canciones). En el servidor solo un administrador, y va a la papelera de la nube. */
export function borrarLista(listaId: string) {
  const l = estado.listas.find((x) => x.id === listaId)
  if (!l) return
  if (l.servidorId) {
    oc('deletePlaylist', { id: l.servidorId })
      .then(() => { aviso('Lista enviada a la papelera de la nube (30 días)'); return refrescarListasServidor() })
      .catch((e) => aviso(mensajeError(e), 'error'))
    return
  }
  poner((s) => ({ listas: s.listas.filter((x) => x.id !== listaId) }))
  void guardarJson('listas', estado.listas)
}

// ---------------------------------------------------------------- sin conexión

export async function refrescarSinConexion() {
  try {
    const l = await backend.sinConexionListar()
    poner({ sinConexion: Object.fromEntries(l.map((x) => [x.id, x.tam])) })
  } catch { /* ignorar */ }
}

export async function guardarSinConexion(ids: string[]) {
  if (backend.kind === 'web') return aviso('Guardar sin conexión solo está disponible en la aplicación de escritorio.', 'error')
  const pendientes = ids.filter((i) => !(i in estado.sinConexion))
  if (!pendientes.length) return aviso('Ya está guardado en este equipo')
  try {
    poner({ descarga: { hecho: 0, total: pendientes.length } })
    await backend.sinConexionDescargar(pendientes)
    aviso(`Descargando ${pendientes.length} canciones…`)
  } catch (e) {
    poner({ descarga: null })
    aviso(mensajeError(e), 'error')
  }
}

export async function liberarEspacio(ids?: string[]) {
  try {
    const n = await backend.sinConexionBorrar(ids)
    await refrescarSinConexion()
    aviso(`Espacio liberado: ${formatoBytes(n)}`)
  } catch (e) { aviso(mensajeError(e), 'error') }
}

// ---------------------------------------------------------------- arranque y conexión

function aplicarBiblioteca(b: Biblioteca) {
  poner({ bib: b, idx: indexar(b) })
}

/** Las listas del servidor se vuelven a leer siempre (no son una copia): «Listas» (OmniCaster) y «Emisión». */
export async function refrescarListasServidor() {
  try {
    const remotas = await backend.listasServidor()
    const nuevas: Lista[] = remotas.map((l) => {
      const emision = l.id.startsWith('pl-')
      return { id: `s-${l.id}`, servidorId: l.id, nombre: emision ? l.nombre.replace(/^Emisión\s*[·:-]\s*/i, '') : l.nombre, canciones: l.canciones, grupo: emision ? 'emision' : 'lista' } as Lista
    })
    poner((s) => ({ listas: [...s.listas.filter((l) => !l.servidorId && l.id.startsWith('l-')), ...nuevas].map((l) => (l.grupo ? l : { ...l, grupo: 'lista' })) }))
    void guardarJson('listas', estado.listas.filter((l) => !l.servidorId))
  } catch { /* el servidor puede no admitirlo */ }
}

async function importarServidor() {
  try {
    const favs = await backend.favoritosServidor()
    if (favs.length) {
      poner((s) => ({ favoritos: [...s.favoritos, ...favs.filter((f) => !s.favoritos.includes(f) && s.idx.cancion.has(f))] }))
      void guardarJson('favoritos', estado.favoritos)
    }
  } catch { /* el servidor puede no admitirlo */ }
  await refrescarListasServidor()
}

export async function sincronizar(silencioso = true) {
  if (estado.sincronizando) return
  poner({ sincronizando: 'Actualizando biblioteca…' })
  try {
    const b = await backend.sincronizar((fase, n) => poner({ sincronizando: `Actualizando ${fase}: ${n}` }))
    aplicarBiblioteca(b)
    void importarServidor()
    if (!silencioso) aviso(`Biblioteca actualizada: ${b.canciones.length} canciones`)
  } catch (e) {
    aviso(`No se pudo actualizar la biblioteca: ${mensajeError(e)}`, 'error')
  } finally {
    poner({ sincronizando: null })
  }
}

async function cargarPreferencias() {
  const [favoritos, historial, listas, tema, vol, alea, rep, cola] = await Promise.all([
    leerJson<string[]>('favoritos', []), leerJson<{ id: string; en: number }[]>('historial', []), leerJson<Lista[]>('listas', []),
    backend.leer('tema'), backend.leer('volumen'), backend.leer('aleatorio'), backend.leer('repetir'), backend.leer('panelCola'),
  ])
  const volumen = vol ? Math.min(1, Math.max(0, Number(vol))) : 0.8
  poner({
    favoritos, historial, listas: listas.filter((l) => !l.servidorId && !l.id.startsWith('s-')), volumen, panelCola: cola !== 'false',
    tema: (tema === 'claro' || tema === 'oscuro' ? tema : 'sistema') as Tema,
    aleatorio: alea === 'true',
    repetir: (rep === 'cola' || rep === 'una' ? rep : 'no') as Repetir,
  })
  void backend.volumen(volumen)
}

let arrancado = false
export async function arrancar() {
  if (arrancado) return
  arrancado = true
  backend.onAudio(alEventoAudio)
  backend.onMedios(alControlMedios)
  backend.onDescarga((p) => {
    poner({ descarga: p.hecho >= p.total ? null : { hecho: p.hecho, total: p.total } })
    if (p.error) aviso(`No se pudo descargar una canción: ${p.error}`, 'error')
    if (p.hecho >= p.total) void refrescarSinConexion()
  })
  try {
    await cargarPreferencias()
    const c = await backend.conexionActual()
    if (!c) return poner({ fase: 'conexion' })
    poner({ servidor: c.servidor, usuario: c.usuario, necesitaClave: c.necesitaClave })
    if (c.necesitaClave) return poner({ fase: 'conexion' })
    const b = await backend.cargarBiblioteca()
    aplicarBiblioteca(b)
    poner({ fase: 'lista' })
    void refrescarSinConexion()
    void cargarRol()
    void backend.sinConexionCarpeta().then((carpetaSinConexion) => poner({ carpetaSinConexion })).catch(() => {})
    void sincronizar()
    void backend.buscarActualizacion().then((a) => a && poner({ actualizacion: a })).catch(() => {})
  } catch (e) {
    aviso(mensajeError(e), 'error')
    poner({ fase: 'conexion' })
  }
}

export async function conectar(servidor: string, usuario: string, clave: string): Promise<string | null> {
  const aviso_ = await backend.guardarConexion(servidor, usuario, clave)
  const b = await backend.cargarBiblioteca()
  aplicarBiblioteca(b)
  poner({ servidor, usuario, necesitaClave: false, fase: 'lista', ruta: { t: 'inicio' }, pilaRutas: [] })
  void refrescarSinConexion()
  void cargarRol()
  void backend.sinConexionCarpeta().then((carpetaSinConexion) => poner({ carpetaSinConexion })).catch(() => {})
  void sincronizar()
  return aviso_
}

export async function cerrarSesion() {
  void backend.parar()
  await backend.olvidar()
  poner({ fase: 'conexion', cola: [], indice: -1, actual: null, reproduciendo: false, bib: vacia, idx: indexar(vacia), necesitaClave: false, rol: 'listener' })
}

export function alternarPanelCola() {
  const v = !estado.panelCola
  poner({ panelCola: v })
  void backend.guardar('panelCola', String(v))
}

export function ponerTema(t: Tema) {
  poner({ tema: t })
  void backend.guardar('tema', t)
}

export function mostrarMenu(x: number, y: number, items: ItemMenu[]) {
  poner({ menu: { x, y, items } })
}

/** Texto de apoyo de una canción en listas: «Artista — Álbum». */
export const resumenCancion = (c: Cancion) => `${c.artista} — ${c.album}`


// ---------------------------------------------------------------- gestión de la biblioteca
// Nunca se borran canciones desde aquí: solo se editan sus datos, se mandan a revisión o
// (administradores) se desactivan. El borrado real se hace desde OmniCaster en el escritorio.

async function cargarRol() {
  poner({ rol: await rolDelUsuario(estado.usuario) })
}

export interface Cambios {
  set?: Record<string, unknown>
  addTags?: string[]
  removeTags?: string[]
  review?: boolean
}

/** Ejecuta un cambio sobre varias canciones. Si son más de 10 pide confirmación explícita antes. */
export function conConfirmacion(texto: string, n: number, ejecutar: (confirm: number) => Promise<void>): Promise<void> | void {
  if (n > LIMITE_MASIVO) poner({ confirmacion: { texto, n, ejecutar } })
  else return ejecutar(0)
}

async function tras(ids: string[], songs: any[] | undefined) {
  // Actualiza lo que se ve ya; el resto llega con la siguiente sincronización.
  if (songs?.length) {
    const nuevas = new Map(songs.map((x) => [String(x.id), x]))
    const bib = estado.bib
    const canciones = bib.canciones.map((c) => {
      const x = nuevas.get(c.id)
      return x ? { ...c, titulo: x.title ?? c.titulo, artista: x.artist ?? c.artista, album: x.album ?? c.album, anio: x.year ? Number(x.year) : null, genero: x.genre ?? null } : c
    })
    aplicarBiblioteca({ ...bib, canciones })
  }
  void sincronizar()
  void ids
}

export function editarCanciones(ids: string[], cambios: Cambios, confirmar = true) {
  const ejecutar = async (confirm: number) => {
    const r = await oc('ocEditSongs', {}, { ids, ...cambios, confirm: confirm || undefined })
    aviso(r.changed ? `${r.changed} ${r.changed === 1 ? 'canción cambiada' : 'canciones cambiadas'}` : 'No había nada que cambiar')
    await tras(ids, r.song)
  }
  if (!confirmar) return ejecutar(0)
  return conConfirmacion(`Vas a cambiar los datos de ${ids.length} canciones a la vez.`, ids.length, ejecutar)
}

export function mandarARevision(ids: string[], marcar = true) {
  void conConfirmacion(`Vas a ${marcar ? 'mandar a revisión' : 'quitar de revisión'} ${ids.length} canciones.`, ids.length, async (confirm) => {
    const r = await oc('ocEditSongs', {}, { ids, review: marcar, confirm: confirm || undefined })
    aviso(marcar ? `${r.changed} a revisión` : `${r.changed} fuera de revisión`)
    await tras(ids, r.song)
  })
}

/** Solo administradores. Una canción desactivada deja de salir en la biblioteca, pero sigue en la nube. */
export function desactivarCanciones(ids: string[], desactivar = true) {
  void conConfirmacion(`Vas a ${desactivar ? 'desactivar' : 'activar'} ${ids.length} canciones.`, ids.length, async (confirm) => {
    const r = await oc('ocSetDisabled', {}, { ids, disabled: desactivar, confirm: confirm || undefined })
    aviso(desactivar ? `${r.changed} desactivadas` : `${r.changed} activadas`)
    await tras(ids, undefined)
  })
}

export async function deshacerCambio(n: number) {
  try {
    await oc('ocUndo', { n })
    aviso('Cambio deshecho')
    void sincronizar()
  } catch (e) { aviso(mensajeError(e), 'error') }
}

// ---- subida (igual que la web de OmniCaster: por huella; si ya está en la nube solo crea la ficha)

let ofSubida: (() => void) | null = null

export async function subirCanciones(rutas?: string[], bloque?: string) {
  try {
    const elegidas = rutas ?? (await backend.elegirArchivos())
    if (!elegidas.length) return
    ofSubida?.()
    ofSubida = backend.onSubida((p) => poner((s) => ({ subida: { progreso: p, resultado: s.subida?.resultado ?? null, activa: p.fase !== 'hecho' } })))
    poner({ subida: { progreso: null, resultado: null, activa: true } })
    const r = await backend.subir(elegidas, bloque)
    poner({ subida: { progreso: null, resultado: r, activa: false } })
    void sincronizar()
  } catch (e) {
    poner({ subida: null })
    aviso(mensajeError(e), 'error')
  } finally {
    ofSubida?.(); ofSubida = null
  }
}

export { ErrorOc }
