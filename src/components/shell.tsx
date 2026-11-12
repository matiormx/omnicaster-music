import { useEffect, useRef, useState } from 'react'
import { Caratula, ContextMenu, Icono } from './common'
import {
  alternarAleatorio, alternarFavorito, alternarPausa, anterior, atras, aviso, buscar, cerrarSesion, ciclarRepetir, crearLista, formatoTiempo,
  irA, irACola, navegar, poner, ponerTema, ponerVolumen, quitarDeCola, reordenarCola, siguiente, sincronizar, useApp, type Ruta, type Tema,
} from '../store'

// ---------------------------------------------------------------- barra lateral

function Enlace({ ruta, icono, texto, activo }: { ruta: Ruta; icono: string; texto: string; activo: boolean }) {
  return (
    <button className={`enlace-lateral${activo ? ' activo' : ''}`} onClick={() => navegar(ruta)} aria-current={activo ? 'page' : undefined}>
      <Icono n={icono} tam={18} /> <span>{texto}</span>
    </button>
  )
}

export function Lateral() {
  const ruta = useApp((s) => s.ruta)
  const q = useApp((s) => s.busqueda)
  const sincronizando = useApp((s) => s.sincronizando)
  const hayPila = useApp((s) => s.pilaRutas.length > 0)
  const act = (t: Ruta['t']) => ruta.t === t
  return (
    <aside className="lateral">
      <div className="nav-top">
        <button className="btn-icono" onClick={atras} disabled={!hayPila} aria-label="Atrás"><Icono n="back" /></button>
        <span className="marca-app">OmniCaster Music</span>
      </div>
      <div className="buscador">
        <Icono n="search" tam={16} />
        <input id="buscador" type="search" placeholder="Buscar" aria-label="Buscar" value={q} onChange={(e) => buscar(e.target.value)} autoComplete="off" spellCheck={false} />
      </div>
      <nav aria-label="Principal">
        <Enlace ruta={{ t: 'inicio' }} icono="play" texto="Escuchar ahora" activo={act('inicio')} />
        <Enlace ruta={{ t: 'explorar' }} icono="compass" texto="Explorar" activo={act('explorar')} />
        <Enlace ruta={{ t: 'radio' }} icono="radio" texto="Radio" activo={act('radio')} />
        <h3>Biblioteca</h3>
        <Enlace ruta={{ t: 'artistas' }} icono="artist" texto="Artistas" activo={act('artistas') || act('artista')} />
        <Enlace ruta={{ t: 'albumes' }} icono="album" texto="Álbumes" activo={act('albumes') || act('album')} />
        <Enlace ruta={{ t: 'canciones' }} icono="note" texto="Canciones" activo={act('canciones')} />
        <Enlace ruta={{ t: 'generos' }} icono="genre" texto="Géneros" activo={act('generos') || act('genero')} />
        <Enlace ruta={{ t: 'listas' }} icono="list" texto="Listas" activo={act('listas') || act('lista')} />
        <Enlace ruta={{ t: 'favoritos' }} icono="heart" texto="Favoritos" activo={act('favoritos')} />
        <Enlace ruta={{ t: 'sinconexion' }} icono="download" texto="Sin conexión" activo={act('sinconexion')} />
      </nav>
      <div className="lateral-pie">
        {sincronizando && <p className="sync" role="status">{sincronizando}</p>}
        <Ajustes />
      </div>
    </aside>
  )
}

function Ajustes() {
  const [abierto, setAbierto] = useState(false)
  const usuario = useApp((s) => s.usuario)
  const servidor = useApp((s) => s.servidor)
  const tema = useApp((s) => s.tema)
  const act = useApp((s) => s.actualizacion)
  return (
    <div className="ajustes">
      {abierto && (
        <div className="menu ajustes-menu" role="dialog" aria-label="Ajustes">
          <p className="cuenta">{usuario}<small>{servidor.replace(/^https?:\/\//, '')}</small></p>
          <label className="orden">Tema
            <select value={tema} onChange={(e) => ponerTema(e.target.value as Tema)}>
              <option value="sistema">Según el sistema</option><option value="claro">Claro</option><option value="oscuro">Oscuro</option>
            </select>
          </label>
          <button className="menu-item" onClick={() => { setAbierto(false); void sincronizar(false) }}>Actualizar biblioteca</button>
          {act && <button className="menu-item" onClick={() => void act.instalar()}>Instalar versión {act.version}</button>}
          <button className="menu-item peligro" onClick={() => { setAbierto(false); void cerrarSesion() }}>Cerrar sesión</button>
        </div>
      )}
      <button className="enlace-lateral" onClick={() => setAbierto(!abierto)} aria-expanded={abierto}>
        <Icono n="gear" tam={18} /> <span>{usuario || 'Ajustes'}</span>{act && <span className="punto" title="Actualización disponible" />}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- reproductor

export function Progreso({ clase = '' }: { clase?: string }) {
  const posicion = useApp((s) => s.posicion)
  const duracion = useApp((s) => s.duracion)
  const [arrastre, setArrastre] = useState<number | null>(null)
  const v = arrastre ?? posicion
  const max = duracion > 0 ? duracion : 1
  const fin = (el: HTMLInputElement) => {
    if (arrastre != null) void irA(arrastre)
    setArrastre(null)
    el.blur()
  }
  return (
    <div className={`progreso ${clase}`}>
      <span className="tiempo">{formatoTiempo(v)}</span>
      <input
        type="range" aria-label="Posición" min={0} max={max} step={0.1} value={Math.min(v, max)}
        style={{ ['--p' as string]: `${(Math.min(v, max) / max) * 100}%` }}
        onChange={(e) => setArrastre(Number(e.target.value))}
        onPointerUp={(e) => fin(e.currentTarget)} onKeyUp={(e) => e.key.startsWith('Arrow') && fin(e.currentTarget)}
        disabled={duracion <= 0}
      />
      <span className="tiempo">-{formatoTiempo(Math.max(0, duracion - v))}</span>
    </div>
  )
}

export function Controles({ grande = false }: { grande?: boolean }) {
  const reproduciendo = useApp((s) => s.reproduciendo)
  const aleatorio = useApp((s) => s.aleatorio)
  const repetir = useApp((s) => s.repetir)
  const actual = useApp((s) => s.actual)
  const t = grande ? 30 : 20
  return (
    <div className={`controles${grande ? ' grande' : ''}`}>
      <button className={`btn-icono${aleatorio ? ' on' : ''}`} onClick={alternarAleatorio} aria-label="Aleatorio" aria-pressed={aleatorio}><Icono n="shuffle" tam={t - 4} /></button>
      <button className="btn-icono" onClick={anterior} disabled={!actual} aria-label="Anterior"><Icono n="prev" tam={t} /></button>
      <button className="btn-icono play" onClick={() => void alternarPausa()} disabled={!actual} aria-label={reproduciendo ? 'Pausa' : 'Reproducir'}><Icono n={reproduciendo ? 'pause' : 'play'} tam={t + 8} /></button>
      <button className="btn-icono" onClick={siguiente} disabled={!actual} aria-label="Siguiente"><Icono n="next" tam={t} /></button>
      <button className={`btn-icono${repetir !== 'no' ? ' on' : ''}`} onClick={ciclarRepetir} aria-label={`Repetir: ${repetir === 'no' ? 'desactivado' : repetir === 'cola' ? 'toda la cola' : 'una canción'}`} aria-pressed={repetir !== 'no'}>
        <Icono n="repeat" tam={t - 4} />{repetir === 'una' && <b className="uno">1</b>}
      </button>
    </div>
  )
}

export function BarraReproductor() {
  const actual = useApp((s) => s.actual)
  const cancion = useApp((s) => (s.actual ? s.idx.cancion.get(s.actual) : undefined))
  const volumen = useApp((s) => s.volumen)
  const panel = useApp((s) => s.panelCola)
  const fav = useApp((s) => (s.actual ? s.favoritos.includes(s.actual) : false))
  const previo = useRef(0.8)
  return (
    <footer className="reproductor" aria-label="Reproductor">
      <div className="rep-pista">
        {cancion ? (
          <>
            <button className="caratula-btn" onClick={() => poner({ pantallaCompleta: true })} aria-label="Abrir reproducción a pantalla completa">
              <Caratula id={cancion.caratula} tam={120} texto={cancion.album} clase="mini grande-mini" />
            </button>
            <div className="textos">
              <span className="titulo" data-testid="titulo-actual">{cancion.titulo}</span>
              <span className="artista">{cancion.artista} — {cancion.album}</span>
            </div>
            <button className={`btn-icono${fav ? ' on' : ''}`} onClick={() => actual && alternarFavorito(actual)} aria-label={fav ? 'Quitar de favoritos' : 'Marcar como favorito'} aria-pressed={fav}><Icono n={fav ? 'heartFill' : 'heart'} tam={18} /></button>
          </>
        ) : <span className="nada">Nada en reproducción</span>}
      </div>
      <div className="rep-centro"><Controles /><Progreso /></div>
      <div className="rep-derecha">
        <button className="btn-icono" onClick={() => { if (volumen > 0) { previo.current = volumen; ponerVolumen(0) } else ponerVolumen(previo.current) }} aria-label={volumen > 0 ? 'Silenciar' : 'Activar sonido'}><Icono n={volumen > 0 ? 'volume' : 'mute'} tam={18} /></button>
        <input type="range" className="vol" aria-label="Volumen" min={0} max={1} step={0.01} value={volumen} style={{ ['--p' as string]: `${volumen * 100}%` }} onChange={(e) => ponerVolumen(Number(e.target.value))} />
        <button className={`btn-icono${panel ? ' on' : ''}`} onClick={() => poner({ panelCola: !panel })} aria-label="Cola «A continuación»" aria-pressed={panel}><Icono n="queue" tam={20} /></button>
      </div>
    </footer>
  )
}

// ---------------------------------------------------------------- cola

export function PanelCola({ incrustado = false }: { incrustado?: boolean }) {
  const cola = useApp((s) => s.cola)
  const indice = useApp((s) => s.indice)
  const idx = useApp((s) => s.idx)
  const [arrastrando, setArrastrando] = useState<number | null>(null)
  const [sobre, setSobre] = useState<number | null>(null)
  const refActual = useRef<HTMLLIElement>(null)
  useEffect(() => { refActual.current?.scrollIntoView({ block: 'nearest' }) }, [indice])
  return (
    <aside className={`panel-cola${incrustado ? ' incrustado' : ''}`} aria-label="A continuación">
      <div className="panel-cab"><h2>A continuación</h2>{!incrustado && <button className="btn-icono" onClick={() => poner({ panelCola: false })} aria-label="Cerrar la cola"><Icono n="close" tam={18} /></button>}</div>
      {!cola.length && <p className="vacio">La cola está vacía.</p>}
      <ul>
        {cola.map((id, i) => {
          const c = idx.cancion.get(id)
          if (!c) return null
          return (
            <li
              key={`${id}-${i}`} ref={i === indice ? refActual : undefined}
              className={`item-cola${i === indice ? ' suena' : ''}${sobre === i && arrastrando !== null && arrastrando !== i ? (arrastrando < i ? ' sobre-abajo' : ' sobre-arriba') : ''}`}
              draggable
              onDragStart={(e) => { setArrastrando(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)) }}
              onDragOver={(e) => { e.preventDefault(); setSobre(i) }}
              onDrop={(e) => { e.preventDefault(); if (arrastrando !== null) reordenarCola(arrastrando, i); setArrastrando(null); setSobre(null) }}
              onDragEnd={() => { setArrastrando(null); setSobre(null) }}
              onDoubleClick={() => irACola(i)}
            >
              <Caratula id={c.caratula} tam={80} texto={c.album} clase="mini" />
              <div className="textos"><span className="titulo">{c.titulo}</span><span className="artista">{c.artista}</span></div>
              <span className="tiempo">{formatoTiempo(c.duracion)}</span>
              {i !== indice && <button className="btn-icono quitar" onClick={() => quitarDeCola(i)} aria-label={`Quitar ${c.titulo} de la cola`}><Icono n="close" tam={14} /></button>}
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

// ---------------------------------------------------------------- pantalla completa

export function Reproduciendo() {
  const abierta = useApp((s) => s.pantallaCompleta)
  const c = useApp((s) => (s.actual ? s.idx.cancion.get(s.actual) : undefined))
  const fav = useApp((s) => (s.actual ? s.favoritos.includes(s.actual) : false))
  const [verCola, setVerCola] = useState(false)
  useEffect(() => {
    if (!abierta) return
    const t = (e: KeyboardEvent) => e.key === 'Escape' && poner({ pantallaCompleta: false })
    window.addEventListener('keydown', t)
    return () => window.removeEventListener('keydown', t)
  }, [abierta])
  if (!abierta || !c) return null
  return (
    <div className="reproduciendo" role="dialog" aria-label="Reproduciendo">
      <CaratulaFondo id={c.caratula} texto={c.album} />
      <button className="btn-icono cerrar" onClick={() => poner({ pantallaCompleta: false })} aria-label="Cerrar pantalla completa"><Icono n="close" tam={24} /></button>
      <div className={`rp-contenido${verCola ? ' con-cola' : ''}`}>
        <div className="rp-principal">
          <Caratula id={c.caratula} tam={800} texto={c.album} clase="enorme" />
          <div className="rp-titulo">
            <div><h1>{c.titulo}</h1><p>{c.artista} — {c.album}</p></div>
            <button className={`btn-icono${fav ? ' on' : ''}`} onClick={() => alternarFavorito(c.id)} aria-label={fav ? 'Quitar de favoritos' : 'Marcar como favorito'}><Icono n={fav ? 'heartFill' : 'heart'} tam={24} /></button>
          </div>
          <Progreso clase="grande" />
          <Controles grande />
          <button className={`btn-icono${verCola ? ' on' : ''}`} onClick={() => setVerCola(!verCola)} aria-label="Mostrar cola" aria-pressed={verCola}><Icono n="queue" tam={22} /></button>
        </div>
        {verCola && <PanelCola incrustado />}
      </div>
    </div>
  )
}

function CaratulaFondo({ id, texto }: { id?: string | null; texto: string }) {
  // La carátula ampliada y muy desenfocada da el fondo con sus propios colores.
  return (
    <div className="rp-fondo" aria-hidden="true">
      <Caratula id={id} tam={200} texto={texto} clase="fondo-difuminado" />
    </div>
  )
}

// ---------------------------------------------------------------- varios

export function Avisos() {
  const avisos = useApp((s) => s.avisos)
  return (
    <div className="avisos" aria-live="polite">
      {avisos.map((a) => <div key={a.id} className={`aviso ${a.tipo}`} role={a.tipo === 'error' ? 'alert' : 'status'}>{a.texto}</div>)}
    </div>
  )
}

export function NuevaLista() {
  const ids = useApp((s) => s.nuevaLista)
  const [nombre, setNombre] = useState('')
  useEffect(() => { if (ids) setNombre('') }, [ids])
  if (!ids) return null
  const crear = (ev: React.FormEvent) => {
    ev.preventDefault()
    const l = crearLista(nombre, ids)
    poner({ nuevaLista: null })
    aviso(`Lista «${l.nombre}» creada`)
    navegar({ t: 'lista', id: l.id })
  }
  return (
    <div className="modal-fondo" onClick={() => poner({ nuevaLista: null })}>
      <form className="modal" role="dialog" aria-label="Lista nueva" onClick={(e) => e.stopPropagation()} onSubmit={crear}>
        <h2>Lista nueva</h2>
        <input autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la lista" aria-label="Nombre de la lista" />
        <div className="botones">
          <button type="button" className="boton" onClick={() => poner({ nuevaLista: null })}>Cancelar</button>
          <button type="submit" className="boton principal">Crear</button>
        </div>
      </form>
    </div>
  )
}

export function Actualizacion() {
  const a = useApp((s) => s.actualizacion)
  const [instalando, setInstalando] = useState(false)
  if (!a) return null
  return (
    <div className="banner-actualizacion" role="status">
      Hay una versión nueva ({a.version}).
      <button className="boton principal" disabled={instalando} onClick={() => { setInstalando(true); a.instalar().catch(() => { setInstalando(false); aviso('No se pudo instalar la actualización.', 'error') }) }}>
        {instalando ? 'Instalando…' : 'Instalar y reiniciar'}
      </button>
      <button className="btn-icono" onClick={() => poner({ actualizacion: null })} aria-label="Descartar"><Icono n="close" tam={16} /></button>
    </div>
  )
}

export { ContextMenu }
