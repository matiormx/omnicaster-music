import { useEffect, useMemo, useState } from 'react'
import { backend } from '../backend'
import {
  BotonesReproducir, Cabecera, Caratula, fondoGenerado, Icono, ListaCanciones, RejillaAlbumes, Seccion, TarjetaAlbum,
} from '../components/common'
import {
  aviso, borrarLista, formatoBytes, formatoDuracionTotal, guardarSinConexion, liberarEspacio, navegar, normalizar,
  poner, refrescarSinConexion, reproducirLista, useApp, type Ruta,
} from '../store'
import type { Album, Cancion } from '../types'

const semilla = Math.random()
function aleatorioEstable<T>(a: T[], n: number): T[] {
  // Orden pseudoaleatorio fijo durante la sesión (para que «Para ti» no cambie al navegar).
  const x = (i: number) => Math.abs(Math.sin((i + 1) * 9301 + semilla * 49297)) % 1
  return a.map((v, i) => [x(i), v] as const).sort((p, q) => p[0] - q[0]).slice(0, n).map((p) => p[1])
}

const porAnio = (a: Album) => a.anio ?? 0

function TarjetaGenero({ nombre, canciones }: { nombre: string; canciones?: number }) {
  return (
    <button className="tarjeta-genero" style={{ background: fondoGenerado(nombre) }} onClick={() => navegar({ t: 'genero', id: nombre })} aria-label={`Género ${nombre}`}>
      <span>{nombre}</span>
      {canciones ? <small>{canciones} canciones</small> : null}
    </button>
  )
}

// ---------------------------------------------------------------- inicio

export function Inicio() {
  const bib = useApp((s) => s.bib)
  const idx = useApp((s) => s.idx)
  const historial = useApp((s) => s.historial)
  const recientes = useMemo(() => [...bib.albumes].sort((a, b) => (b.creado ?? '').localeCompare(a.creado ?? '')).slice(0, 12), [bib])
  const paraTi = useMemo(() => aleatorioEstable(bib.albumes, 12), [bib])
  const reproducidos = useMemo(() => {
    const vistos = new Set<string>()
    const out: Album[] = []
    for (const h of historial) {
      const albumId = idx.cancion.get(h.id)?.albumId
      const a = albumId ? idx.album.get(albumId) : undefined
      if (a && !vistos.has(a.id)) { vistos.add(a.id); out.push(a) }
      if (out.length >= 12) break
    }
    return out
  }, [historial, idx])
  if (!bib.canciones.length && !bib.albumes.length) {
    return (<><Cabecera titulo="Escuchar ahora" /><p className="vacio">La biblioteca está vacía o todavía se está cargando.</p></>)
  }
  return (
    <>
      <Cabecera titulo="Escuchar ahora" sub={`${bib.canciones.length} canciones · ${bib.albumes.length} álbumes · ${bib.artistas.length} artistas`} />
      <Seccion titulo="Añadido recientemente"><div className="fila-horizontal"><RejillaAlbumes albumes={recientes} /></div></Seccion>
      <Seccion titulo="Para ti"><RejillaAlbumes albumes={paraTi} /></Seccion>
      {reproducidos.length > 0 && <Seccion titulo="Reproducido recientemente"><RejillaAlbumes albumes={reproducidos} /></Seccion>}
      <Seccion titulo="Géneros">
        <div className="rejilla-generos">{idx.generos.map((g) => <TarjetaGenero key={g.nombre} {...g} />)}</div>
      </Seccion>
    </>
  )
}

// ---------------------------------------------------------------- explorar

export function Explorar() {
  const bib = useApp((s) => s.bib)
  const idx = useApp((s) => s.idx)
  const decadas = useMemo(() => {
    const m = new Map<number, Album[]>()
    for (const a of bib.albumes) if (a.anio) { const d = Math.floor(a.anio / 10) * 10; m.set(d, [...(m.get(d) ?? []), a]) }
    return [...m].sort((a, b) => b[0] - a[0])
  }, [bib])
  const [decada, setDecada] = useState<number | null>(null)
  const sel = decada ?? decadas[0]?.[0] ?? null
  const lista = decadas.find((d) => d[0] === sel)?.[1] ?? []
  const sinAnio = bib.albumes.filter((a) => !a.anio).length
  return (
    <>
      <Cabecera titulo="Explorar" />
      <Seccion titulo="Géneros"><div className="rejilla-generos">{idx.generos.map((g) => <TarjetaGenero key={g.nombre} {...g} />)}</div></Seccion>
      <Seccion titulo="Por década">
        <div className="chips">
          {decadas.map(([d]) => <button key={d} className={`chip${d === sel ? ' activo' : ''}`} onClick={() => setDecada(d)}>{d}s</button>)}
        </div>
        <RejillaAlbumes albumes={[...lista].sort((a, b) => porAnio(a) - porAnio(b))} />
        {sinAnio > 0 && <p className="nota">{sinAnio} álbumes no indican el año y no aparecen aquí.</p>}
      </Seccion>
    </>
  )
}

// ---------------------------------------------------------------- radio

export function Radio() {
  const idx = useApp((s) => s.idx)
  const bib = useApp((s) => s.bib)
  const [cargando, setCargando] = useState<string | null>(null)
  async function iniciar(genero?: string) {
    setCargando(genero ?? '*')
    try {
      let canciones: Cancion[] = []
      try { canciones = await backend.aleatorias(genero, 60) } catch { /* se usa la biblioteca local */ }
      if (!canciones.length) {
        const pool = bib.canciones.filter((c) => !genero || c.genero === genero)
        canciones = aleatorioEstable(pool, 60)
      }
      const ids = canciones.map((c) => c.id).filter((id) => idx.cancion.has(id))
      if (!ids.length) aviso('No hay canciones para esta emisora.', 'error')
      else reproducirLista(ids, 0)
    } finally { setCargando(null) }
  }
  return (
    <>
      <Cabecera titulo="Radio" sub="Mezclas aleatorias del servidor, por género.">
        <button className="boton principal" onClick={() => void iniciar()} disabled={cargando !== null}><Icono n="radio" tam={18} /> Toda la biblioteca</button>
      </Cabecera>
      <div className="rejilla-generos">
        {idx.generos.map((g) => (
          <button key={g.nombre} className="tarjeta-genero" style={{ background: fondoGenerado(g.nombre) }} onClick={() => void iniciar(g.nombre)} disabled={cargando !== null} aria-label={`Radio de ${g.nombre}`}>
            <span>Radio {g.nombre}</span>
            <small>{cargando === g.nombre ? 'Cargando…' : 'Iniciar'}</small>
          </button>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- biblioteca

export function Artistas() {
  const artistas = useApp((s) => s.bib.artistas)
  const albumes = useApp((s) => s.bib.albumes)
  return (
    <>
      <Cabecera titulo="Artistas" sub={`${artistas.length} artistas`} />
      <div className="rejilla redonda">
        {artistas.map((a) => {
          const alb = albumes.find((x) => x.artistaId === a.id || x.artista === a.nombre)
          return (
            <button key={a.id} className="tarjeta" onClick={() => navegar({ t: 'artista', id: a.id })} aria-label={`Artista ${a.nombre}`}>
              <Caratula id={alb?.caratula} tam={300} texto={a.nombre} clase="redonda" />
              <span className="t-nombre">{a.nombre}</span>
              <span className="t-sub">{a.albumes || albumes.filter((x) => x.artistaId === a.id).length} álbumes</span>
            </button>
          )
        })}
        {!artistas.length && <p className="vacio">No hay artistas.</p>}
      </div>
    </>
  )
}

export function Albumes() {
  const albumes = useApp((s) => s.bib.albumes)
  const [orden, setOrden] = useState<'nombre' | 'artista' | 'anio'>('nombre')
  const l = useMemo(() => {
    const c = (a: string, b: string) => a.localeCompare(b, 'es')
    return [...albumes].sort((a, b) => (orden === 'nombre' ? c(a.nombre, b.nombre) : orden === 'artista' ? c(a.artista, b.artista) || c(a.nombre, b.nombre) : porAnio(b) - porAnio(a)))
  }, [albumes, orden])
  return (
    <>
      <Cabecera titulo="Álbumes" sub={`${albumes.length} álbumes`}>
        <label className="orden">Ordenar por
          <select value={orden} onChange={(e) => setOrden(e.target.value as typeof orden)}>
            <option value="nombre">Título</option><option value="artista">Artista</option><option value="anio">Año</option>
          </select>
        </label>
      </Cabecera>
      <RejillaAlbumes albumes={l} />
    </>
  )
}

export function Canciones() {
  const canciones = useApp((s) => s.bib.canciones)
  const l = useMemo(() => [...canciones].sort((a, b) => a.titulo.localeCompare(b.titulo, 'es')), [canciones])
  return (
    <>
      <Cabecera titulo="Canciones" sub={`${canciones.length} canciones`}><BotonesReproducir ids={l.map((c) => c.id)} /></Cabecera>
      <ListaCanciones canciones={l} onReproducir={(i) => reproducirLista(l.map((c) => c.id), i)} />
    </>
  )
}

export function Generos() {
  const g = useApp((s) => s.idx.generos)
  return (<><Cabecera titulo="Géneros" /><div className="rejilla-generos">{g.map((x) => <TarjetaGenero key={x.nombre} {...x} />)}</div>{!g.length && <p className="vacio">Ninguna canción indica género.</p>}</>)
}

export function PaginaGenero({ nombre }: { nombre: string }) {
  const bib = useApp((s) => s.bib)
  const canciones = useMemo(() => bib.canciones.filter((c) => c.genero === nombre), [bib, nombre])
  const albumes = useMemo(() => bib.albumes.filter((a) => a.genero === nombre), [bib, nombre])
  return (
    <>
      <Cabecera titulo={nombre} sub={`${albumes.length} álbumes · ${canciones.length} canciones`}><BotonesReproducir ids={canciones.map((c) => c.id)} /></Cabecera>
      <Seccion titulo="Álbumes"><RejillaAlbumes albumes={albumes} /></Seccion>
      <Seccion titulo="Canciones"><ListaCanciones canciones={canciones} onReproducir={(i) => reproducirLista(canciones.map((c) => c.id), i)} /></Seccion>
    </>
  )
}

export function Listas() {
  const listas = useApp((s) => s.listas)
  const idx = useApp((s) => s.idx)
  return (
    <>
      <Cabecera titulo="Listas" sub={`${listas.length} listas`}>
        <button className="boton principal" onClick={() => poner({ nuevaLista: [] })}><Icono n="plus" tam={18} /> Lista nueva</button>
      </Cabecera>
      <div className="rejilla">
        {listas.map((l) => {
          const primera = l.canciones.map((i) => idx.cancion.get(i)).find((c) => c?.caratula)
          return (
            <button key={l.id} className="tarjeta" onClick={() => navegar({ t: 'lista', id: l.id })} aria-label={`Lista ${l.nombre}`}>
              <Caratula id={primera?.caratula} tam={400} texto={l.nombre} />
              <span className="t-nombre">{l.nombre}</span>
              <span className="t-sub">{l.canciones.length} canciones</span>
            </button>
          )
        })}
        {!listas.length && <p className="vacio">Aún no hay listas. Crea una o añade canciones desde el menú contextual.</p>}
      </div>
    </>
  )
}

export function PaginaLista({ id }: { id: string }) {
  const lista = useApp((s) => s.listas.find((l) => l.id === id))
  const idx = useApp((s) => s.idx)
  const canciones = useMemo(() => (lista?.canciones ?? []).map((i) => idx.cancion.get(i)).filter((c): c is Cancion => !!c), [lista, idx])
  if (!lista) return <p className="vacio">La lista ya no existe.</p>
  const ids = canciones.map((c) => c.id)
  return (
    <>
      <Cabecera titulo={lista.nombre} sub={`${canciones.length} canciones · ${formatoDuracionTotal(canciones.reduce((t, c) => t + c.duracion, 0))}`}>
        <BotonesReproducir ids={ids} onGuardar={() => void guardarSinConexion(ids)} />
        <button className="boton peligro" onClick={() => { borrarLista(lista.id); navegar({ t: 'listas' }) }}><Icono n="trash" tam={18} /> Eliminar</button>
      </Cabecera>
      <ListaCanciones canciones={canciones} listaId={lista.id} onReproducir={(i) => reproducirLista(ids, i)} />
    </>
  )
}

export function Favoritos() {
  const favoritos = useApp((s) => s.favoritos)
  const idx = useApp((s) => s.idx)
  const canciones = useMemo(() => favoritos.map((i) => idx.cancion.get(i)).filter((c): c is Cancion => !!c), [favoritos, idx])
  const ids = canciones.map((c) => c.id)
  return (
    <>
      <Cabecera titulo="Favoritos" sub={`${canciones.length} canciones`}><BotonesReproducir ids={ids} /></Cabecera>
      <ListaCanciones canciones={canciones} onReproducir={(i) => reproducirLista(ids, i)} />
      {!canciones.length && <p className="vacio">Marca canciones como favoritas con el corazón del reproductor o el menú contextual.</p>}
    </>
  )
}

export function SinConexion() {
  const sin = useApp((s) => s.sinConexion)
  const idx = useApp((s) => s.idx)
  const carpeta = useApp((s) => s.carpetaSinConexion)
  const descarga = useApp((s) => s.descarga)
  useEffect(() => { void refrescarSinConexion() }, [])
  const canciones = useMemo(() => Object.keys(sin).map((i) => idx.cancion.get(i)).filter((c): c is Cancion => !!c), [sin, idx])
  const total = Object.values(sin).reduce((a, b) => a + b, 0)
  const ids = canciones.map((c) => c.id)
  async function cambiarCarpeta() {
    const n = await backend.elegirCarpeta()
    if (!n) return
    try { poner({ carpetaSinConexion: await backend.sinConexionCarpeta(n) }); aviso('Carpeta cambiada. Las descargas nuevas irán allí.') } catch (e) { aviso(String(e), 'error') }
  }
  return (
    <>
      <Cabecera titulo="Sin conexión" sub={`${canciones.length} canciones · ${formatoBytes(total)}`}>
        <BotonesReproducir ids={ids} />
        <button className="boton peligro" onClick={() => void liberarEspacio()} disabled={!canciones.length}><Icono n="trash" tam={18} /> Liberar espacio</button>
      </Cabecera>
      <div className="panel-info">
        <div><strong>Carpeta de descargas</strong><p className="mono">{carpeta || '—'}</p></div>
        <button className="boton" onClick={() => void cambiarCarpeta()} disabled={backend.kind === 'web'}>Cambiar carpeta…</button>
      </div>
      {descarga && <div className="progreso-descarga" role="status">Descargando {descarga.hecho} de {descarga.total}…<div className="barra-mini"><div style={{ width: `${(descarga.hecho / descarga.total) * 100}%` }} /></div></div>}
      <ListaCanciones canciones={canciones} onReproducir={(i) => reproducirLista(ids, i)} />
      {!canciones.length && <p className="vacio">No hay música guardada. Usa «Guardar sin conexión» en un álbum, una lista o el menú de una canción.</p>}
    </>
  )
}

// ---------------------------------------------------------------- páginas de álbum y artista

export function PaginaAlbum({ id }: { id: string }) {
  const album = useApp((s) => s.idx.album.get(id))
  const canciones = useApp((s) => s.idx.deAlbum.get(id)) ?? []
  const sin = useApp((s) => s.sinConexion)
  if (!album) return <p className="vacio">No se encuentra el álbum.</p>
  const ids = canciones.map((c) => c.id)
  const duracion = canciones.reduce((t, c) => t + c.duracion, 0) || album.duracion
  const guardadas = ids.filter((i) => i in sin).length
  const partes = [album.anio ? String(album.anio) : null, album.genero, `${canciones.length || album.canciones} canciones`, duracion ? formatoDuracionTotal(duracion) : null].filter(Boolean)
  return (
    <>
      <div className="cabecera-album">
        <Caratula id={album.caratula} tam={600} texto={album.nombre} clase="grande" />
        <div className="info">
          <h1>{album.nombre}</h1>
          <button className="enlace artista" onClick={() => album.artistaId && navegar({ t: 'artista', id: album.artistaId })}>{album.artista}</button>
          <p className="sub">{partes.join(' · ')}</p>
          {guardadas > 0 && <p className="sub"><Icono n="check" tam={14} /> {guardadas === ids.length ? 'Guardado sin conexión' : `${guardadas} de ${ids.length} guardadas sin conexión`}</p>}
          <BotonesReproducir ids={ids} onGuardar={() => void guardarSinConexion(ids)} />
        </div>
      </div>
      <ListaCanciones canciones={canciones} numerar mostrarAlbum={false} onReproducir={(i) => reproducirLista(ids, i)} />
    </>
  )
}

export function PaginaArtista({ id }: { id: string }) {
  const artista = useApp((s) => s.bib.artistas.find((a) => a.id === id))
  const bib = useApp((s) => s.bib)
  const albumes = useMemo(() => bib.albumes.filter((a) => a.artistaId === id || (!a.artistaId && a.artista === artista?.nombre)), [bib, id, artista])
  const canciones = useMemo(() => bib.canciones.filter((c) => c.artistaId === id || albumes.some((a) => a.id === c.albumId)), [bib, id, albumes])
  const ids = canciones.map((c) => c.id)
  const nombre = artista?.nombre ?? albumes[0]?.artista ?? 'Artista'
  return (
    <>
      <Cabecera titulo={nombre} sub={`${albumes.length} álbumes · ${canciones.length} canciones`}><BotonesReproducir ids={ids} /></Cabecera>
      <Seccion titulo="Álbumes"><div className="rejilla">{albumes.map((a) => <TarjetaAlbum key={a.id} a={a} />)}</div></Seccion>
      <Seccion titulo="Canciones"><ListaCanciones canciones={canciones} onReproducir={(i) => reproducirLista(ids, i)} /></Seccion>
    </>
  )
}

// ---------------------------------------------------------------- búsqueda

export function Busqueda() {
  const q = useApp((s) => s.busqueda)
  const bib = useApp((s) => s.bib)
  const r = useMemo(() => {
    const t = normalizar(q.trim())
    if (!t) return null
    const tiene = (...c: (string | null | undefined)[]) => c.some((x) => x && normalizar(x).includes(t))
    return {
      artistas: bib.artistas.filter((a) => tiene(a.nombre)).slice(0, 12),
      albumes: bib.albumes.filter((a) => tiene(a.nombre, a.artista)).slice(0, 24),
      canciones: bib.canciones.filter((c) => tiene(c.titulo, c.artista, c.album)).slice(0, 300),
    }
  }, [q, bib])
  if (!r) return <p className="vacio">Escribe para buscar en tu biblioteca.</p>
  const nada = !r.artistas.length && !r.albumes.length && !r.canciones.length
  const ids = r.canciones.map((c) => c.id)
  return (
    <>
      <Cabecera titulo={`Resultados de «${q}»`} />
      {nada && <p className="vacio">No hay resultados.</p>}
      {r.artistas.length > 0 && (
        <Seccion titulo="Artistas">
          <div className="chips">{r.artistas.map((a) => <button key={a.id} className="chip" onClick={() => navegar({ t: 'artista', id: a.id })}><Icono n="artist" tam={14} /> {a.nombre}</button>)}</div>
        </Seccion>
      )}
      {r.albumes.length > 0 && <Seccion titulo="Álbumes"><RejillaAlbumes albumes={r.albumes} /></Seccion>}
      {r.canciones.length > 0 && <Seccion titulo="Canciones"><ListaCanciones canciones={r.canciones} onReproducir={(i) => reproducirLista(ids, i)} /></Seccion>}
    </>
  )
}

export function Vista({ ruta }: { ruta: Ruta }) {
  switch (ruta.t) {
    case 'inicio': return <Inicio />
    case 'explorar': return <Explorar />
    case 'radio': return <Radio />
    case 'artistas': return <Artistas />
    case 'albumes': return <Albumes />
    case 'canciones': return <Canciones />
    case 'generos': return <Generos />
    case 'listas': return <Listas />
    case 'favoritos': return <Favoritos />
    case 'sinconexion': return <SinConexion />
    case 'busqueda': return <Busqueda />
    case 'album': return <PaginaAlbum id={ruta.id} />
    case 'artista': return <PaginaArtista id={ruta.id} />
    case 'genero': return <PaginaGenero nombre={ruta.id} />
    case 'lista': return <PaginaLista id={ruta.id} />
  }
}

