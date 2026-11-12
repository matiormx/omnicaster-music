# Pendiente y limitaciones conocidas

- **Servidor real sin probar**: `cloud.ngradio.es` no era accesible desde el entorno donde se desarrolló; todo se probó contra el servidor falso. Conviene una primera prueba real (conexión, carga de ~6.500 canciones, reproducción FLAC).
- **Audio probado sin dispositivo**: decodificación, remuestreo, salto, ReplayGain y la caché Range tienen tests; la salida por `cpal`, el gapless real y los controles multimedia (MPRIS/SMTC) no se pudieron escuchar ni ver en un equipo con sonido y escritorio. Hay que verificarlos a mano en Windows y Linux.
- **Gapless**: depende de que la pista siguiente se abra a tiempo; con servidores lentos puede haber un microcorte. El búfer de 4 s lo mitiga.
- **Remuestreo lineal**: sin filtro anti-alias; se puede sustituir por `rubato`.
- **Cambio de dispositivo de audio**: hay que reiniciar la aplicación.
- **Aleatorio**: al desactivarlo no se recupera el orden original de la cola.
- **Listas del servidor**: se importan una vez como listas locales (sin sincronización de vuelta); crear o editar listas solo afecta a lo local.
- **Sin conexión**: guarda el archivo original; no hay cuota de espacio ni reanudación de descargas interrumpidas.
- **Idioma**: solo español.
- **macOS**: no es objetivo de esta versión.
