import { useEffect } from 'react'
import { Conectar } from './components/Conectar'
import { Actualizacion, Avisos, BarraReproductor, ContextMenu, Lateral, NuevaLista, PanelCola, Reproduciendo } from './components/shell'
import { alternarPausa, anterior, arrancar, irA, obtener, poner, ponerVolumen, siguiente, useApp } from './store'
import { Vista } from './views/vistas'

function atajos(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  const escribiendo = !!t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'))
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    const b = document.getElementById('buscador') as HTMLInputElement | null
    b?.focus(); b?.select()
    return
  }
  if (escribiendo || e.ctrlKey || e.metaKey || e.altKey || obtener().fase !== 'lista') return
  const s = obtener()
  switch (e.key) {
    case ' ': e.preventDefault(); void alternarPausa(); break
    case 'ArrowRight': e.preventDefault(); if (e.shiftKey) siguiente(); else void irA(Math.min(s.duracion, s.posicion + 5)); break
    case 'ArrowLeft': e.preventDefault(); if (e.shiftKey) anterior(); else void irA(Math.max(0, s.posicion - 5)); break
    case 'ArrowUp': e.preventDefault(); ponerVolumen(Math.min(1, +(s.volumen + 0.05).toFixed(2))); break
    case 'ArrowDown': e.preventDefault(); ponerVolumen(Math.max(0, +(s.volumen - 0.05).toFixed(2))); break
  }
}

export function App() {
  const fase = useApp((s) => s.fase)
  const ruta = useApp((s) => s.ruta)
  const panel = useApp((s) => s.panelCola)
  const tema = useApp((s) => s.tema)

  useEffect(() => { void arrancar() }, [])
  useEffect(() => {
    window.addEventListener('keydown', atajos)
    const sinMenuNativo = (e: MouseEvent) => e.preventDefault()
    window.addEventListener('contextmenu', sinMenuNativo)
    return () => { window.removeEventListener('keydown', atajos); window.removeEventListener('contextmenu', sinMenuNativo) }
  }, [])
  useEffect(() => {
    if (tema === 'sistema') delete document.documentElement.dataset.tema
    else document.documentElement.dataset.tema = tema
  }, [tema])

  if (fase === 'cargando') return <div className="cargando" role="status">Cargando…</div>
  if (fase === 'conexion') return (<><Conectar /><Avisos /></>)
  return (
    <div className={`app${panel ? ' con-panel' : ''}`}>
      <Lateral />
      <main className="contenido" onScroll={() => obtener().menu && poner({ menu: null })}>
        <Actualizacion />
        <Vista ruta={ruta} />
      </main>
      {panel && <PanelCola />}
      <BarraReproductor />
      <Reproduciendo />
      <ContextMenu />
      <NuevaLista />
      <Avisos />
    </div>
  )
}
