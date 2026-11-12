import { useState } from 'react'
import { backend } from '../backend'
import { conectar, useApp } from '../store'

const SERVIDOR_POR_DEFECTO = 'https://cloud.ngradio.es'

export function Conectar() {
  const guardado = useApp((s) => s.servidor)
  const usuarioGuardado = useApp((s) => s.usuario)
  const necesitaClave = useApp((s) => s.necesitaClave)
  const [servidor, setServidor] = useState(guardado || SERVIDOR_POR_DEFECTO)
  const [usuario, setUsuario] = useState(usuarioGuardado)
  const [clave, setClave] = useState('')
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const completo = servidor.trim() && usuario.trim() && clave

  async function probar() {
    setOcupado(true)
    setEstado({ tipo: 'info', texto: 'Probando la conexión…' })
    try {
      const i = await backend.probar(servidor, usuario, clave)
      const que = [i.serverType, i.serverVersion].filter(Boolean).join(' ')
      setEstado({ tipo: 'ok', texto: `Conexión correcta. Subsonic ${i.version}${que ? ` (${que})` : ''}${i.openSubsonic ? ' · OpenSubsonic' : ''}.` })
    } catch (e) {
      setEstado({ tipo: 'error', texto: String(e) })
    } finally { setOcupado(false) }
  }

  async function entrar(ev: React.FormEvent) {
    ev.preventDefault()
    if (!completo) return
    setOcupado(true)
    setEstado({ tipo: 'info', texto: 'Conectando…' })
    try {
      const aviso = await conectar(servidor, usuario, clave)
      if (aviso) setEstado({ tipo: 'info', texto: aviso })
    } catch (e) {
      setEstado({ tipo: 'error', texto: String(e) })
    } finally { setOcupado(false) }
  }

  return (
    <main className="conectar">
      <form className="tarjeta-conexion" onSubmit={entrar}>
        <div className="logo-grande" aria-hidden="true">♪</div>
        <h1>OmniCaster Music</h1>
        <p className="sub">{necesitaClave ? 'Escribe la contraseña para volver a conectar.' : 'Conecta con el servidor de música de tu emisora.'}</p>
        <label>Servidor<input name="servidor" value={servidor} onChange={(e) => setServidor(e.target.value)} placeholder="https://servidor.ejemplo.es" autoComplete="url" spellCheck={false} /></label>
        <label>Usuario<input name="usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" spellCheck={false} /></label>
        <label>Contraseña<input name="clave" type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" /></label>
        {estado && <p className={`estado ${estado.tipo}`} role="status">{estado.texto}</p>}
        <div className="botones">
          <button type="button" className="boton" onClick={() => void probar()} disabled={!completo || ocupado}>Probar</button>
          <button type="submit" className="boton principal" disabled={!completo || ocupado}>Conectar</button>
        </div>
        <p className="nota">La contraseña se guarda cifrada en el almacén de claves del sistema. La música no se descarga: se escucha en directo desde el servidor.</p>
      </form>
    </main>
  )
}
