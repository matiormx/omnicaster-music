# Decisiones tomadas durante el desarrollo

Registro de las decisiones que se tomaron sin preguntar (trabajo desatendido).

## Entorno y publicación
- **Repo**: la sesión no podía crear repositorios (`gh repo create` devolvía 403), así que se trabajó en local y el repo `matiormx/omnicaster-music` lo creó el usuario vacío. Se añadió como remoto y se hizo push de lo local.
- **Servidor real**: `cloud.ngradio.es` no es accesible desde el entorno de desarrollo (lista de dominios permitidos). Todo se probó contra el servidor Subsonic falso (`mock-server/`). La conexión real no se ha podido verificar aquí.
- **Mensaje de commit**: se usa exactamente `Co-Authored-By: Claude <noreply@anthropic.com>`, como pedía el encargo.
- **Claves de firma**: el par de claves del actualizador se generó con `tauri signer generate`. La pública está en `tauri.conf.json`. La privada y su contraseña no van al repo; hay que cargarlas como secretos (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).

## Tecnología
- **Versiones de crates**: se fijaron versiones conocidas y estables (symphonia 0.5, cpal 0.15, keyring 3, souvlaki 0.8, rusqlite 0.32) en lugar de las últimas, cuya API difiere.
- **Descarga de audio**: se usa el endpoint `download` (archivo original, con Range) y no `stream`, para evitar transcodificación y conocer la longitud exacta.
- **Remuestreo**: lineal, sin filtro anti-alias. Suficiente para escuchar; mejorable con `rubato` más adelante. Si la tasa de la pista coincide con la del dispositivo no se toca.
- **Salida de audio**: se usa la configuración por defecto del dispositivo; si cambia el dispositivo hay que reiniciar la app.
- **ReplayGain**: se lee de las etiquetas (`REPLAYGAIN_TRACK_GAIN`); si no hay, se usa la ganancia del servidor (OpenSubsonic `replayGain.trackGain`); si tampoco hay, volumen sin tocar. Solo ganancia de pista, limitada a ±26 dB.
- **Datos del usuario** (favoritos, historial, listas): se guardan como JSON en la tabla `kv` de SQLite; la biblioteca, en tablas propias.
- **Contraseña**: en el almacén del sistema con `keyring`. Si no está disponible (p. ej. Linux sin Secret Service) se avisa y se pide en cada arranque; nunca se guarda en claro.
- **Carátulas**: esquema propio `cover://` servido desde Rust con caché en disco, para no exponer credenciales en la interfaz.

## Estado de la publicación (v0.1.0)
- **Secretos y etiqueta**: desde la sesión de desarrollo no se podía escribir en los secretos de Actions (`gh secret set` → 403 del proxy), y sin la clave privada la Release firmada falla. Por eso **no se creó la etiqueta `v0.1.0`** (habría producido una ejecución fallida). Pasos: cargar `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` y luego `git tag v0.1.0 && git push origin v0.1.0`.
- **Verificación de instaladores**: el CI construye en cada push los instaladores de Windows (NSIS en español y MSI) y de Linux (AppImage y deb) sin firma de actualizaciones, y ejecuta clippy y tests también en Windows. El flujo de Release usa exactamente los mismos comandos más la firma.
- **Compilación local**: se generaron y firmaron `.deb` y `.AppImage` con la clave de actualizaciones para comprobar la configuración.
- **CI extra**: se añadió un trabajo de instaladores de prueba al CI (no estaba pedido) para detectar fallos de Windows antes de publicar.
