import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Backend, EventoAudio } from '../types'

function escuchar<T>(evento: string, cb: (p: T) => void): () => void {
  let fin = false
  let off: (() => void) | null = null
  listen<T>(evento, (e) => cb(e.payload)).then((f) => (fin ? f() : (off = f)))
  return () => { fin = true; off?.() }
}

export const backendTauri: Backend = {
  kind: 'tauri',
  probar: (servidor, usuario, clave) => invoke('conexion_probar', { servidor, usuario, clave }),
  guardarConexion: (servidor, usuario, clave) => invoke('conexion_guardar', { servidor, usuario, clave }),
  conexionActual: () => invoke('conexion_actual'),
  olvidar: () => invoke('conexion_olvidar'),
  cargarBiblioteca: () => invoke('biblioteca_cargar'),
  sincronizar: async (onProgreso) => {
    const off = escuchar<{ fase: string; cantidad: number }>('biblioteca-progreso', (p) => onProgreso(p.fase, p.cantidad))
    try { return await invoke('biblioteca_sincronizar') } finally { off() }
  },
  leer: (clave) => invoke('valor_leer', { clave }),
  guardar: (clave, valor) => invoke('valor_guardar', { clave, valor }),
  listasServidor: () => invoke('servidor_listas'),
  favoritosServidor: () => invoke('servidor_favoritos'),
  marcar: (id, favorito) => invoke('servidor_marcar', { id, favorito }),
  registrar: (id) => invoke('servidor_registrar', { id }),
  aleatorias: (genero, tamano) => invoke('canciones_aleatorias', { genero: genero ?? null, tamano: tamano ?? 50 }),
  caratula: (id, tam) => `${convertFileSrc(id, 'cover')}?size=${tam}`,
  reproducir: (pista, inicio) => invoke('audio_reproducir', { pista, inicio: inicio ?? 0 }),
  siguiente: (pista) => invoke('audio_siguiente', { pista }),
  pausa: (pausa) => invoke('audio_pausa', { pausa }),
  buscar: (segundos) => invoke('audio_buscar', { segundos }),
  volumen: (volumen) => invoke('audio_volumen', { volumen }),
  parar: () => invoke('audio_parar'),
  onAudio: (cb) => escuchar<EventoAudio>('audio', cb),
  medios: (titulo, artista, album, caratula, duracion) => invoke('medios_metadatos', { titulo, artista, album, caratula, duracion }),
  mediosEstado: (reproduciendo, posicion) => invoke('medios_estado', { reproduciendo, posicion }),
  onMedios: (cb) => escuchar('medios-control', cb),
  sinConexionDescargar: (ids) => invoke('sin_conexion_descargar', { ids }),
  sinConexionListar: () => invoke('sin_conexion_listar'),
  sinConexionBorrar: (ids) => invoke('sin_conexion_borrar', { ids: ids ?? null }),
  sinConexionCarpeta: (nueva) => invoke('sin_conexion_carpeta', { nueva: nueva ?? null }),
  onDescarga: (cb) => escuchar('sin-conexion-progreso', cb),
  elegirCarpeta: async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const r = await open({ directory: true, multiple: false, title: 'Carpeta para la música sin conexión' })
    return typeof r === 'string' ? r : null
  },
  buscarActualizacion: async () => {
    const { check } = await import('@tauri-apps/plugin-updater')
    const u = await check()
    if (!u) return null
    return {
      version: u.version,
      instalar: async () => {
        await u.downloadAndInstall()
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
      },
    }
  },
}
