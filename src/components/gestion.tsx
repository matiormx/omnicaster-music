// Diálogos de gestión de la biblioteca: ficha, edición de datos, confirmación de cambios masivos y subida.
import { useEffect, useState } from 'react'
import { ETIQUETA_ROL, cargarFicha, energiaPuntos, oc, puede, type Ficha } from '../oc'
import { aviso, deshacerCambio, editarCanciones, obtener, poner, useApp } from '../store'

const FICHA_VACIA: Ficha | null = null

function Modal({ titulo, children, onCerrar, ancho }: { titulo: string; children: React.ReactNode; onCerrar: () => void; ancho?: number }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onCerrar])
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal modal-ancho" style={ancho ? { width: ancho } : undefined} role="dialog" aria-label={titulo} onClick={(e) => e.stopPropagation()}>
        <h2>{titulo}</h2>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- ficha

interface Entrada { n: number; at: string; by: string; op: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; undone: boolean }
const NOMBRE_OP: Record<string, string> = { edit: 'Editada', create: 'Creada', delete: 'Borrada', restore: 'Restaurada', undo: 'Deshecho', disable: 'Desactivada', enable: 'Activada' }

export function FichaCancion() {
  const id = useApp((s) => s.ficha)
  const rol = useApp((s) => s.rol)
  const [f, setF] = useState<Ficha | null>(FICHA_VACIA)
  const [error, setError] = useState('')
  const [hist, setHist] = useState<Entrada[]>([])
  const cargar = () => {
    if (!id) return
    cargarFicha(id).then(setF).catch((e) => setError(String(e?.message ?? e)))
    if (puede(obtener().rol, 'operator')) oc('ocHistory', { id, limit: 15 }).then((b) => setHist(b.entry ?? [])).catch(() => setHist([]))
  }
  useEffect(() => { setF(null); setError(''); setHist([]); cargar() /* eslint-disable-next-line */ }, [id])
  if (!id) return null
  const cerrar = () => poner({ ficha: null })
  return (
    <Modal titulo="Ficha de la canción" onCerrar={cerrar} ancho={520}>
      {error && <p className="error">{error}</p>}
      {!f && !error && <p>Cargando…</p>}
      {f && (
        <>
          <dl className="ficha">
            <dt>Título</dt><dd>{f.titulo}</dd>
            <dt>Artista</dt><dd>{f.artista}</dd>
            <dt>Álbum</dt><dd>{f.album || '—'}{f.artistaAlbum && f.artistaAlbum !== f.artista ? ` · ${f.artistaAlbum}` : ''}</dd>
            <dt>Año · estilo</dt><dd>{[f.anio, f.genero].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Idioma</dt><dd>{f.idioma || '—'}</dd>
            <dt>Energía</dt><dd aria-label={`Energía ${f.energia} de 5`}><span className="energia">{energiaPuntos(f.energia)}</span></dd>
            <dt>Mood</dt><dd>{f.mood || '—'}</dd>
            <dt>Temas</dt><dd>{f.temas.join(', ') || '—'}</dd>
            <dt>Etiquetas</dt><dd>{f.etiquetas.join(', ') || '—'}</dd>
            {f.tipoMedio && <><dt>Tipo de medio</dt><dd>{f.tipoMedio}</dd></>}
            {f.desactivada && <><dt>Estado</dt><dd>Desactivada</dd></>}
          </dl>
          {hist.length > 0 && (
            <div className="historial">
              <h3>Cambios</h3>
              {hist.map((h) => (
                <div key={h.n} className="fila-hist">
                  <span>{NOMBRE_OP[h.op] ?? h.op} por {h.by} · {new Date(h.at).toLocaleString('es-ES')}{h.after ? ` (${Object.keys(h.after).join(', ')})` : ''}{h.undone ? ' · deshecho' : ''}</span>
                  {!h.undone && h.before && h.after && (h.op === 'edit' || h.op === 'disable' || h.op === 'enable') && <button className="boton" onClick={() => void deshacerCambio(h.n).then(cargar)}>Deshacer</button>}
                </div>
              ))}
            </div>
          )}
          <p className="nota">Tu usuario: {ETIQUETA_ROL[rol]}. Desde esta aplicación las canciones no se pueden borrar.</p>
          <div className="botones">
            <button className="boton" onClick={cerrar}>Cerrar</button>
            {puede(rol, 'operator') && <button className="boton principal" onClick={() => { cerrar(); poner({ editar: [id] }) }}>Editar datos</button>}
          </div>
        </>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- edición

const CAMPOS_TEXTO: [string, string][] = [
  ['title', 'Título'], ['artist', 'Artista'], ['album', 'Álbum'], ['albumArtist', 'Artista del álbum'], ['year', 'Año'], ['genre', 'Estilo'],
  ['language', 'Idioma (es, en…)'], ['mood', 'Mood'],
]

export function EditarDatos() {
  const ids = useApp((s) => s.editar)
  const [f, setF] = useState<Ficha | null>(null)
  const [t, setT] = useState<Record<string, string>>({})
  const [sucios, setSucios] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const varias = (ids?.length ?? 0) > 1
  useEffect(() => {
    setF(null); setT({}); setSucios(new Set()); setError('')
    if (ids?.length === 1) {
      cargarFicha(ids[0]).then((x) => {
        setF(x)
        setT({ title: x.titulo, artist: x.artista, album: x.album, albumArtist: x.artistaAlbum, year: x.anio, genre: x.genero, language: x.idioma, mood: x.mood, tags: x.etiquetas.join(', '), themes: x.temas.join(', '), mediaType: x.tipoMedio, energy: String(x.energia) })
      }).catch((e) => setError(String(e?.message ?? e)))
    }
  }, [ids])
  if (!ids) return null
  const cerrar = () => poner({ editar: null })
  const cambiar = (k: string, v: string) => { setT((p) => ({ ...p, [k]: v })); setSucios((p) => new Set(p).add(k)) }
  const lista = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean)
  const guardar = async (ev: React.FormEvent) => {
    ev.preventDefault()
    const set: Record<string, unknown> = {}
    for (const k of sucios) {
      if (k === 'tags' || k === 'themes') set[k] = lista(t[k] ?? '')
      else if (k === 'energy') set[k] = Number(t[k] || 0)
      else set[k] = t[k] ?? ''
    }
    if (!Object.keys(set).length) return cerrar()
    if ('mediaType' in set && set.mediaType && set.mediaType !== 'music' && !window.confirm('Los tipos de medio distintos de música (jingle, programa, podcast, cuña…) dejan de salir en OmniCaster Music. ¿Continuar?')) return
    setOcupado(true)
    try {
      await editarCanciones(ids, { set }) // si son más de 10 abre antes la confirmación explícita
      cerrar()
    } catch (e) { setError(String((e as Error)?.message ?? e)) } finally { setOcupado(false) }
  }
  const campo = (k: string, etiqueta: string) => (
    <label key={k} className="campo">{etiqueta}
      <input value={t[k] ?? ''} placeholder={varias ? 'Sin cambios' : ''} onChange={(e) => cambiar(k, e.target.value)} />
    </label>
  )
  return (
    <Modal titulo={varias ? `Editar datos de ${ids.length} canciones` : 'Editar datos'} onCerrar={cerrar} ancho={520}>
      {error && <p className="error">{error}</p>}
      {!varias && !f && !error ? <p>Cargando…</p> : (
        <form onSubmit={guardar} className="form-edicion">
          {varias && <p className="nota">Solo se cambia lo que rellenes; lo demás queda como está. El título solo se edita canción a canción.</p>}
          {CAMPOS_TEXTO.filter(([k]) => !(varias && k === 'title')).map(([k, e]) => campo(k, e))}
          <label className="campo">Energía
            <select value={t.energy ?? ''} onChange={(e) => cambiar('energy', e.target.value)}>
              {varias && <option value="">Sin cambios</option>}
              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n ? `${energiaPuntos(n)}  (${n})` : 'Sin dato'}</option>)}
            </select>
          </label>
          {campo('themes', 'Temas (separados por comas)')}
          {campo('tags', 'Etiquetas (separadas por comas)')}
          <label className="campo">Tipo de medio
            <input value={t.mediaType ?? ''} placeholder={varias ? 'Sin cambios' : 'Vacío = música'} onChange={(e) => cambiar('mediaType', e.target.value)} />
          </label>
          <div className="botones">
            <button type="button" className="boton" onClick={cerrar}>Cancelar</button>
            <button type="submit" className="boton principal" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------- confirmación de cambios masivos

export function ConfirmarMasivo() {
  const c = useApp((s) => s.confirmacion)
  const [marca, setMarca] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  useEffect(() => { setMarca(false); setOcupado(false) }, [c])
  if (!c) return null
  const cerrar = () => poner({ confirmacion: null })
  const hacer = async () => {
    setOcupado(true)
    try { await c.ejecutar(c.n); cerrar() } catch (e) { aviso(String((e as Error)?.message ?? e), 'error'); setOcupado(false) }
  }
  return (
    <Modal titulo="Cambio masivo" onCerrar={cerrar}>
      <p>{c.texto}</p>
      <label className="check"><input type="checkbox" checked={marca} onChange={(e) => setMarca(e.target.checked)} /> Sí, confirmo el cambio de {c.n} canciones</label>
      <p className="nota">Se guarda en el registro de cambios y se puede deshacer desde la ficha de cada canción.</p>
      <div className="botones">
        <button className="boton" onClick={cerrar}>Cancelar</button>
        <button className="boton principal" disabled={!marca || ocupado} onClick={() => void hacer()}>{ocupado ? 'Aplicando…' : 'Aplicar'}</button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- subida

const FASES: Record<string, string> = { huella: 'Preparando', subiendo: 'Subiendo', ficha: 'Creando ficha', hecho: 'Terminado', error: 'Error' }

export function SubidaCanciones() {
  const sb = useApp((s) => s.subida)
  if (!sb) return null
  const p = sb.progreso
  const cerrar = () => poner({ subida: null })
  const pct = p && p.bytes > 0 ? Math.round((p.hecho / p.bytes) * 100) : 0
  return (
    <Modal titulo="Subir canciones" onCerrar={sb.activa ? () => {} : cerrar} ancho={460}>
      {sb.activa && (
        <>
          <p>{p ? `${p.indice + 1 > p.total ? p.total : p.indice + 1} de ${p.total} · ${p.nombre}` : 'Empezando…'}</p>
          <progress value={p?.fase === 'subiendo' ? pct : undefined} max={100} />
          <p className="nota">{p ? FASES[p.fase] ?? p.fase : ''}{p?.fase === 'subiendo' ? ` ${pct} %` : ''}. Si el archivo ya está en la nube solo se crea la ficha.</p>
        </>
      )}
      {sb.resultado && (
        <>
          <p>{sb.resultado.creadas} {sb.resultado.creadas === 1 ? 'canción nueva' : 'canciones nuevas'}{sb.resultado.existian ? ` · ${sb.resultado.existian} ya estaban` : ''}.</p>
          {sb.resultado.fallos.length > 0 && <ul className="error">{sb.resultado.fallos.slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul>}
          <p className="nota">Entran como música; puedes completar sus datos con «Editar datos».</p>
          <div className="botones"><button className="boton principal" onClick={cerrar}>Cerrar</button></div>
        </>
      )}
    </Modal>
  )
}
