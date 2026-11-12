import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { backend } from '../backend'
import {
  alternarFavorito, anadirACola, anadirALista, formatoTiempo, guardarSinConexion, liberarEspacio, mostrarMenu, navegar,
  obtener, poner, reproducirADespues, reproducirLista, quitarDeLista, useApp, type ItemMenu,
} from '../store'
import type { Album, Cancion } from '../types'

// ---------------------------------------------------------------- iconos

const RUTAS: Record<string, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  next: 'M6 18l8.5-6L6 6v12zM16 6h2v12h-2z',
  prev: 'M6 6h2v12H6zM9.5 12l8.5 6V6z',
  shuffle: 'M10.6 9.2L5.4 4 4 5.4l5.2 5.2 1.4-1.4zM14.5 4l2.05 2.05L4 18.6 5.4 20 17.95 7.45 20 9.5V4h-5.5zm.33 9.4l-1.4 1.4 3.12 3.1L14.5 20H20v-5.5l-2.05 2.05-3.12-3.15z',
  repeat: 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z',
  heart: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
  heartFill: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
  queue: 'M3 13h12v-2H3v2zm0-6v2h12V7H3zm0 10h8v-2H3v2zm13-4v6l5-3-5-3z',
  volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z',
  mute: 'M3 9v6h4l5 5V4L7 9H3zm13 3l2.5-2.5-1.4-1.4L14.6 10.6 12.1 8.1l-1.4 1.4L13.2 12l-2.5 2.5 1.4 1.4 2.5-2.5 2.5 2.5 1.4-1.4L16 12z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  radio: 'M3.24 6.15C2.51 6.43 2 7.17 2 8v12a2 2 0 002 2h16a2 2 0 002-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34L15.88 1 3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z',
  compass: 'M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z',
  album: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z',
  artist: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  note: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  genre: 'M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 5h-3v5.5a2.5 2.5 0 11-2.5-2.5c.36 0 .7.08 1 .21V5h4.5v2zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z',
  list: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  check: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  back: 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  expand: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.5.5 0 00.12-.64l-1.92-3.32a.5.5 0 00-.6-.22l-2.39.96a7 7 0 00-1.62-.94l-.36-2.54a.5.5 0 00-.5-.42h-3.84a.5.5 0 00-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 00-.6.22L2.74 8.84a.5.5 0 00.12.64l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58a.5.5 0 00-.12.64l1.92 3.32c.12.22.37.29.6.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 00-.12-.64l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z',
}

export function Icono({ n, tam = 20 }: { n: string; tam?: number }) {
  return (
    <svg className="icono" width={tam} height={tam} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={RUTAS[n] ?? RUTAS.note} />
    </svg>
  )
}

// ---------------------------------------------------------------- carátula

function matiz(texto: string) {
  let h = 0
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) >>> 0
  return h % 360
}

export function fondoGenerado(texto: string) {
  const h = matiz(texto)
  return `linear-gradient(135deg, hsl(${h} 65% 55%), hsl(${(h + 50) % 360} 70% 38%))`
}

/** Carátula con respaldo: si falta o falla, muestra un degradado con la inicial. */
export function Caratula({ id, tam = 300, texto = '', clase = '' }: { id?: string | null; tam?: number; texto?: string; clase?: string }) {
  const [fallo, setFallo] = useState(false)
  useEffect(() => setFallo(false), [id])
  const src = useMemo(() => (id ? backend.caratula(id, tam) : ''), [id, tam])
  return (
    <div className={`caratula ${clase}`} style={{ background: fondoGenerado(texto || id || '?') }}>
      {id && !fallo ? <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFallo(true)} /> : <span className="inicial">{(texto || '♪').trim().charAt(0).toUpperCase()}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- menús

export function menuCancion(c: Cancion, opts: { listaId?: string; ids?: string[] } = {}): ItemMenu[] {
  const s = obtener()
  const ids = opts.ids ?? [c.id]
  const fav = s.favoritos.includes(c.id)
  const guardada = c.id in s.sinConexion
  const items: ItemMenu[] = [
    { texto: 'Reproducir a continuación', accion: () => reproducirADespues(ids) },
    { texto: 'Añadir a la cola', accion: () => anadirACola(ids) },
    { separador: true },
  ]
  if (c.albumId) items.push({ texto: 'Ir al álbum', accion: () => navegar({ t: 'album', id: c.albumId! }) })
  const alb = c.albumId ? s.idx.album.get(c.albumId) : undefined
  const artistaId = c.artistaId ?? alb?.artistaId
  if (artistaId) items.push({ texto: 'Ir al artista', accion: () => navegar({ t: 'artista', id: artistaId }) })
  items.push(
    { separador: true },
    { texto: fav ? 'Quitar de favoritos' : 'Favorito', accion: () => alternarFavorito(c.id) },
    {
      texto: 'Añadir a una lista',
      sub: [
        ...s.listas.map((l) => ({ texto: l.nombre, accion: () => anadirALista(l.id, ids) })),
        { texto: 'Lista nueva…', accion: () => poner({ nuevaLista: ids }) },
      ],
    },
    guardada
      ? { texto: 'Quitar de sin conexión', accion: () => void liberarEspacio(ids) }
      : { texto: 'Guardar sin conexión', accion: () => void guardarSinConexion(ids) },
  )
  if (opts.listaId) items.push({ separador: true }, { texto: 'Quitar de esta lista', peligro: true, accion: () => quitarDeLista(opts.listaId!, c.id) })
  return items
}

export function ContextMenu() {
  const m = useApp((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!m || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.min(m.x, window.innerWidth - r.width - 8), y: Math.min(m.y, window.innerHeight - r.height - 8) })
  }, [m])
  useEffect(() => {
    if (!m) return
    const cerrar = () => poner({ menu: null })
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && cerrar()
    window.addEventListener('click', cerrar)
    window.addEventListener('blur', cerrar)
    window.addEventListener('keydown', tecla)
    window.addEventListener('scroll', cerrar, true)
    return () => {
      window.removeEventListener('click', cerrar)
      window.removeEventListener('blur', cerrar)
      window.removeEventListener('keydown', tecla)
      window.removeEventListener('scroll', cerrar, true)
    }
  }, [m])
  if (!m) return null
  const pintar = (items: ItemMenu[]): ReactNode =>
    items.map((it, i) =>
      it.separador ? (
        <div key={i} className="menu-sep" />
      ) : (
        <div key={i} className={`menu-item${it.peligro ? ' peligro' : ''}${it.sub ? ' con-sub' : ''}`} role="menuitem" onClick={(e) => { if (it.sub) { e.stopPropagation(); return } it.accion?.(); poner({ menu: null }) }}>
          {it.texto}
          {it.sub && (
            <>
              <span className="flecha">›</span>
              <div className="menu submenu" role="menu">{pintar(it.sub)}</div>
            </>
          )}
        </div>
      ),
    )
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x || m.x, top: pos.y || m.y }} onContextMenu={(e) => e.preventDefault()}>
      {pintar(m.items)}
    </div>
  )
}

// ---------------------------------------------------------------- lista de canciones virtualizada

const ALTO_FILA = 52
const EXTRA = 8

export function ListaCanciones({
  canciones, onReproducir, numerar = false, listaId, mostrarAlbum = true,
}: { canciones: Cancion[]; onReproducir: (i: number) => void; numerar?: boolean; listaId?: string; mostrarAlbum?: boolean }) {
  const cont = useRef<HTMLDivElement>(null)
  const [rango, setRango] = useState({ desde: 0, hasta: 30 })
  const [sel, setSel] = useState<string | null>(null)
  const actual = useApp((s) => s.actual)
  const favoritos = useApp((s) => s.favoritos)
  const sinConexion = useApp((s) => s.sinConexion)

  useLayoutEffect(() => {
    const el = cont.current
    if (!el) return
    const scroller = (el.closest('.contenido') as HTMLElement | null) ?? document.documentElement
    const calcular = () => {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      const visibles = Math.ceil(scroller.clientHeight / ALTO_FILA)
      const primero = Math.max(0, Math.floor(-top / ALTO_FILA) - EXTRA)
      setRango((r) => {
        const hasta = Math.min(canciones.length, primero + visibles + EXTRA * 2)
        return r.desde === primero && r.hasta === hasta ? r : { desde: primero, hasta }
      })
    }
    calcular()
    scroller.addEventListener('scroll', calcular, { passive: true })
    window.addEventListener('resize', calcular)
    return () => {
      scroller.removeEventListener('scroll', calcular)
      window.removeEventListener('resize', calcular)
    }
  }, [canciones.length])

  const filas = []
  for (let i = rango.desde; i < Math.min(rango.hasta, canciones.length); i++) {
    const c = canciones[i]
    const suena = c.id === actual
    filas.push(
      <div
        key={`${c.id}-${i}`}
        className={`fila${suena ? ' suena' : ''}${sel === c.id ? ' sel' : ''}${mostrarAlbum ? '' : ' sin-album'}`}
        style={{ top: i * ALTO_FILA, height: ALTO_FILA }}
        role="row"
        onClick={() => setSel(c.id)}
        onDoubleClick={() => onReproducir(i)}
        onContextMenu={(e) => { e.preventDefault(); setSel(c.id); mostrarMenu(e.clientX, e.clientY, menuCancion(c, { listaId })) }}
      >
        <div className="col-num">
          {suena ? <Icono n="volume" tam={16} /> : <span className="num">{numerar ? (c.pista ?? i + 1) : i + 1}</span>}
          <button className="jugar-fila" aria-label={`Reproducir ${c.titulo}`} onClick={(e) => { e.stopPropagation(); onReproducir(i) }}><Icono n="play" tam={16} /></button>
        </div>
        <div className="col-titulo">
          {!numerar && <Caratula id={c.caratula} tam={80} texto={c.album} clase="mini" />}
          <div className="textos">
            <span className="titulo">{c.titulo}</span>
            {!mostrarAlbum || numerar ? null : <span className="sub-movil">{c.artista}</span>}
          </div>
          {favoritos.includes(c.id) && <span className="marca fav" title="Favorito"><Icono n="heartFill" tam={13} /></span>}
          {c.id in sinConexion && <span className="marca" title="Guardada sin conexión"><Icono n="download" tam={13} /></span>}
        </div>
        <div className="col-artista">{c.artista}</div>
        {mostrarAlbum && <div className="col-album">{c.album}</div>}
        <div className="col-duracion">{formatoTiempo(c.duracion)}</div>
      </div>,
    )
  }
  return (
    <div className="lista-canciones" role="table" aria-label="Canciones">
      <div className={`fila cabecera${mostrarAlbum ? '' : ' sin-album'}`}>
        <div className="col-num">#</div>
        <div className="col-titulo">Título</div>
        <div className="col-artista">Artista</div>
        {mostrarAlbum && <div className="col-album">Álbum</div>}
        <div className="col-duracion">Duración</div>
      </div>
      <div ref={cont} className="cuerpo" style={{ height: canciones.length * ALTO_FILA }}>{filas}</div>
      {!canciones.length && <p className="vacio">No hay canciones.</p>}
    </div>
  )
}

// ---------------------------------------------------------------- álbumes

export function TarjetaAlbum({ a }: { a: Album }) {
  return (
    <button className="tarjeta" onClick={() => navegar({ t: 'album', id: a.id })} aria-label={`Álbum ${a.nombre}, ${a.artista}`}>
      <Caratula id={a.caratula} tam={400} texto={a.nombre} />
      <span className="t-nombre">{a.nombre}</span>
      <span className="t-sub">{a.artista}</span>
    </button>
  )
}

export function RejillaAlbumes({ albumes }: { albumes: Album[] }) {
  return (
    <div className="rejilla">
      {albumes.map((a) => <TarjetaAlbum key={a.id} a={a} />)}
      {!albumes.length && <p className="vacio">No hay álbumes.</p>}
    </div>
  )
}

export function Seccion({ titulo, children, accion }: { titulo: string; children: ReactNode; accion?: ReactNode }) {
  return (
    <section className="seccion">
      <div className="seccion-cab"><h2>{titulo}</h2>{accion}</div>
      {children}
    </section>
  )
}

export function Cabecera({ titulo, sub, children }: { titulo: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="cabecera-pagina">
      <div><h1>{titulo}</h1>{sub && <p className="sub">{sub}</p>}</div>
      <div className="acciones">{children}</div>
    </header>
  )
}

export function BotonesReproducir({ ids, onGuardar }: { ids: string[]; onGuardar?: () => void }) {
  return (
    <div className="botones">
      <button className="boton principal" onClick={() => reproducirLista(ids, 0)} disabled={!ids.length}><Icono n="play" tam={18} /> Reproducir</button>
      <button className="boton" onClick={() => reproducirLista(ids, 0, true)} disabled={!ids.length}><Icono n="shuffle" tam={18} /> Aleatorio</button>
      {onGuardar && <button className="boton" onClick={onGuardar} disabled={!ids.length}><Icono n="download" tam={18} /> Sin conexión</button>}
    </div>
  )
}
