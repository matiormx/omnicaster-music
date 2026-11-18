export interface Artista { id: string; nombre: string; albumes: number }
export interface Album {
  id: string; nombre: string; artista: string; artistaId?: string | null; anio?: number | null
  genero?: string | null; caratula?: string | null; canciones: number; duracion: number; creado?: string | null
}
export interface Cancion {
  id: string; titulo: string; artista: string; artistaId?: string | null; album: string; albumId?: string | null
  pista?: number | null; disco?: number | null; anio?: number | null; genero?: string | null; duracion: number
  caratula?: string | null; formato?: string | null; gananciaDb?: number | null
}
export interface Biblioteca { artistas: Artista[]; albumes: Album[]; canciones: Cancion[]; sincronizada?: number | null }
export interface InfoServidor { version: string; serverType?: string | null; serverVersion?: string | null; openSubsonic: boolean }
export interface ConexionActual { servidor: string; usuario: string; necesitaClave: boolean }
export interface ListaServidor { id: string; nombre: string; canciones: string[] }
export type Rol = 'listener' | 'operator' | 'admin'
export interface Lista {
  id: string; nombre: string; canciones: string[]
  /** Id de la lista en el servidor (bl-… de OmniCaster, pl-… de emisión) */
  servidorId?: string
  /** «lista» (las de OmniCaster y las mías) o «emisión» (solo lectura) */
  grupo?: 'lista' | 'emision'
}
export interface ProgresoSubida { indice: number; total: number; nombre: string; fase: string; hecho: number; bytes: number; error?: string | null }
export interface ResultadoSubida { creadas: number; existian: number; fallos: string[] }
export interface PistaPeticion { id: string; formato?: string | null; gananciaDb?: number | null }
export type EventoAudio =
  | { tipo: 'estado'; id: string | null; posicion: number; duracion: number; reproduciendo: boolean }
  | { tipo: 'pistaCambiada'; id: string }
  | { tipo: 'terminada' }
  | { tipo: 'error'; id: string | null; mensaje: string }
export interface SinConexionItem { id: string; ruta: string; tam: number }
export interface ProgresoDescarga { hecho: number; total: number; id: string; error?: string | null }
export type ControlMedios = 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'stop'

export interface Backend {
  kind: 'tauri' | 'web'
  probar(servidor: string, usuario: string, clave: string): Promise<InfoServidor>
  guardarConexion(servidor: string, usuario: string, clave: string): Promise<string | null>
  conexionActual(): Promise<ConexionActual | null>
  olvidar(): Promise<void>
  cargarBiblioteca(): Promise<Biblioteca>
  sincronizar(onProgreso: (fase: string, n: number) => void): Promise<Biblioteca>
  leer(clave: string): Promise<string | null>
  guardar(clave: string, valor: string): Promise<void>
  listasServidor(): Promise<ListaServidor[]>
  favoritosServidor(): Promise<string[]>
  marcar(id: string, favorito: boolean): Promise<void>
  registrar(id: string): Promise<void>
  aleatorias(genero?: string, n?: number): Promise<Cancion[]>
  caratula(id: string, tam: number): string
  reproducir(p: PistaPeticion, inicio?: number): Promise<void>
  siguiente(p: PistaPeticion | null): Promise<void>
  pausa(b: boolean): Promise<void>
  buscar(s: number): Promise<void>
  volumen(v: number): Promise<void>
  parar(): Promise<void>
  onAudio(cb: (e: EventoAudio) => void): () => void
  medios(titulo: string, artista: string, album: string, caratula: string | null, duracion: number): Promise<void>
  mediosEstado(reproduciendo: boolean, posicion: number): Promise<void>
  onMedios(cb: (c: ControlMedios) => void): () => void
  sinConexionDescargar(ids: string[]): Promise<void>
  sinConexionListar(): Promise<SinConexionItem[]>
  sinConexionBorrar(ids?: string[]): Promise<number>
  sinConexionCarpeta(nueva?: string): Promise<string>
  onDescarga(cb: (p: ProgresoDescarga) => void): () => void
  elegirCarpeta(): Promise<string | null>
  /** Método propio de OmniCaster (oc*, listas…). Devuelve el cuerpo de la respuesta aunque falle. */
  llamarOc(metodo: string, params: [string, string][], cuerpo?: unknown): Promise<any>
  elegirArchivos(): Promise<string[]>
  subir(rutas: string[], bloque?: string): Promise<ResultadoSubida>
  onSubida(cb: (p: ProgresoSubida) => void): () => void
  buscarActualizacion(): Promise<{ version: string; instalar: () => Promise<void> } | null>
}
