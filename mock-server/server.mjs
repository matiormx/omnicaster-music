// Servidor Subsonic falso para desarrollo y pruebas. 50 canciones, audio de tono generado en código.
// Credenciales de ejemplo (no reales): usuario «demo», contraseña «demo».
import http from 'node:http'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

const PORT = Number(process.env.PORT || 4533)
const USER = 'demo'
const PASS = 'demo'

const generos = ['Pop', 'Rock', 'Jazz', 'Electrónica', 'Clásica']
const artistasN = ['Aurora Norte', 'Los Faroles', 'Marea Baja', 'Cobalto', 'Violeta Roja']
const palabras = ['Luz', 'Noche', 'Camino', 'Mar', 'Fuego', 'Sueño', 'Ciudad', 'Viento', 'Sombra', 'Tierra']

const artistas = artistasN.map((nombre, i) => ({ id: `ar-${i + 1}`, name: nombre, albumCount: 2 }))
const albumes = []
const canciones = []
for (let a = 0; a < 10; a++) {
  const artista = artistas[a % 5]
  const album = {
    id: `al-${a + 1}`,
    name: `${palabras[a]} ${['I', 'II', 'Live', 'Acústico'][a % 4]}`,
    artist: artista.name,
    artistId: artista.id,
    genre: generos[a % 5],
    coverArt: `al-${a + 1}`,
    created: new Date(Date.UTC(2026, 0, 1 + a * 20)).toISOString(),
    songCount: 5,
    duration: 0,
  }
  if (a !== 3) album.year = 2005 + a * 2 // el álbum 4 no trae año
  for (let t = 0; t < 5; t++) {
    const n = a * 5 + t
    const s = {
      id: `s-${n + 1}`,
      title: `${palabras[(n + 3) % 10]} ${palabras[(n * 7) % 10].toLowerCase()}`,
      album: album.name,
      albumId: album.id,
      artist: artista.name,
      artistId: artista.id,
      genre: album.genre,
      duration: 20 + (n % 5) * 4,
      suffix: 'wav',
      contentType: 'audio/wav',
      coverArt: album.coverArt,
      track: t + 1,
      year: album.year,
      size: 0,
    }
    // Para probar robustez: algunas canciones sin pista, año ni carátula.
    if (n % 9 === 4) delete s.track
    if (n % 11 === 7) delete s.year
    if (n % 13 === 12) delete s.coverArt
    album.duration += s.duration
    canciones.push(s)
  }
  albumes.push(album)
}
const porId = Object.fromEntries(canciones.map((c) => [c.id, c]))
const estrellas = new Set(['s-2'])

// ---- audio: tono senoidal WAV 16 bits mono 22050 Hz
const wavCache = new Map()
function wav(id) {
  if (wavCache.has(id)) return wavCache.get(id)
  const s = porId[id]
  const sr = 22050
  const n = sr * s.duration
  const f = 220 * Math.pow(2, (Number(id.slice(2)) % 12) / 12)
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 500, (n - i) / 500)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * f * i) / sr) * 9000 * env), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  const b = Buffer.concat([h, data])
  s.size = b.length
  wavCache.set(id, b)
  return b
}
canciones.forEach((c) => wav(c.id))

// ---- carátulas: PNG degradado
function crc32(buf) {
  let c, crc = ~0
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return ~crc >>> 0
}
function chunk(tipo, datos) {
  const l = Buffer.alloc(4); l.writeUInt32LE(0); l.writeUInt32BE(datos.length)
  const t = Buffer.from(tipo)
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, datos])))
  return Buffer.concat([l, t, datos, c])
}
function png(seed, tam = 120) {
  const filas = []
  const h1 = (seed * 47) % 360
  for (let y = 0; y < tam; y++) {
    const fila = Buffer.alloc(1 + tam * 3)
    for (let x = 0; x < tam; x++) {
      const t = (x + y) / (2 * tam)
      const hue = (h1 + t * 60) % 360
      const [r, g, b] = hsl(hue, 0.6, 0.35 + 0.25 * (1 - t))
      fila[1 + x * 3] = r; fila[2 + x * 3] = g; fila[3 + x * 3] = b
    }
    filas.push(fila)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(filas))), chunk('IEND', Buffer.alloc(0)),
  ])
}
function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l)
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))) }
  return [f(0), f(8), f(4)]
}

// ---- respuestas
const resp = (extra = {}) => ({ 'subsonic-response': { status: 'ok', version: '1.16.1', type: 'mock', serverVersion: '0.1', openSubsonic: true, ...extra } })
const fallo = (code, message) => ({ 'subsonic-response': { status: 'failed', version: '1.16.1', error: { code, message } } })
const cancionOut = (s) => ({ ...s, isDir: false, type: 'music', ...(estrellas.has(s.id) ? { starred: '2026-01-01T00:00:00Z' } : {}) })
const albumOut = (a) => ({ id: a.id, name: a.name, artist: a.artist, artistId: a.artistId, year: a.year, genre: a.genre, coverArt: a.coverArt, songCount: a.songCount, duration: a.duration, created: a.created })

function autenticado(q) {
  if (q.get('u') !== USER) return false
  if (q.get('t') && q.get('s')) return q.get('t') === crypto.createHash('md5').update(PASS + q.get('s')).digest('hex')
  return q.get('p') === PASS
}

function pagina(lista, q, tam = 'size', off = 'offset') {
  const o = Number(q.get(off) || 0), n = Math.min(Number(q.get(tam) || 10), 500)
  return lista.slice(o, o + n)
}

function manejar(metodo, q) {
  switch (metodo) {
    case 'ping': return resp()
    case 'getLicense': return resp({ license: { valid: true } })
    case 'getOpenSubsonicExtensions': return resp({ openSubsonicExtensions: [{ name: 'formPost', versions: [1] }] })
    case 'getMusicFolders': return resp({ musicFolders: { musicFolder: [{ id: 1, name: 'Música' }] } })
    case 'getIndexes':
    case 'getArtists': {
      const idx = {}
      for (const a of artistas) (idx[a.name[0]] ||= []).push(a)
      return resp({ [metodo === 'getArtists' ? 'artists' : 'indexes']: { index: Object.entries(idx).map(([name, artist]) => ({ name, artist })) } })
    }
    case 'getArtist': {
      const a = artistas.find((x) => x.id === q.get('id'))
      if (!a) return fallo(70, 'Artista no encontrado')
      return resp({ artist: { ...a, album: albumes.filter((x) => x.artistId === a.id).map(albumOut) } })
    }
    case 'getAlbum': {
      const a = albumes.find((x) => x.id === q.get('id'))
      if (!a) return fallo(70, 'Álbum no encontrado')
      return resp({ album: { ...albumOut(a), song: canciones.filter((s) => s.albumId === a.id).map(cancionOut) } })
    }
    case 'getSong': {
      const s = porId[q.get('id')]
      return s ? resp({ song: cancionOut(s) }) : fallo(70, 'Canción no encontrada')
    }
    case 'getMusicDirectory': return resp({ directory: { id: q.get('id'), child: [] } })
    case 'getAlbumList2': {
      const tipo = q.get('type') || 'alphabeticalByName'
      let l = [...albumes]
      if (tipo === 'newest') l.sort((a, b) => b.created.localeCompare(a.created))
      else if (tipo === 'alphabeticalByArtist') l.sort((a, b) => a.artist.localeCompare(b.artist))
      else if (tipo === 'alphabeticalByName') l.sort((a, b) => a.name.localeCompare(b.name))
      else if (tipo === 'random') l.sort(() => Math.random() - 0.5)
      else if (tipo === 'byYear') l = l.filter((a) => a.year >= Number(q.get('fromYear') || 0) && a.year <= Number(q.get('toYear') || 9999))
      else if (tipo === 'byGenre') l = l.filter((a) => a.genre === q.get('genre'))
      return resp({ albumList2: { album: pagina(l, q).map(albumOut) } })
    }
    case 'getRandomSongs': {
      let l = canciones.filter((s) => !q.get('genre') || s.genre === q.get('genre')).sort(() => Math.random() - 0.5)
      return resp({ randomSongs: { song: l.slice(0, Number(q.get('size') || 10)).map(cancionOut) } })
    }
    case 'getGenres': return resp({ genres: { genre: generos.map((g) => ({ value: g, songCount: 10, albumCount: 2 })) } })
    case 'getSongsByGenre': return resp({ songsByGenre: { song: pagina(canciones.filter((s) => s.genre === q.get('genre')), q, 'count').map(cancionOut) } })
    case 'search3': {
      const t = (q.get('query') || '').replace(/"/g, '').toLowerCase()
      const ok = (...c) => !t || c.some((x) => (x || '').toLowerCase().includes(t))
      return resp({
        searchResult3: {
          artist: pagina(artistas.filter((a) => ok(a.name)), q, 'artistCount', 'artistOffset'),
          album: pagina(albumes.filter((a) => ok(a.name, a.artist)), q, 'albumCount', 'albumOffset').map(albumOut),
          song: pagina(canciones.filter((s) => ok(s.title, s.artist, s.album)), q, 'songCount', 'songOffset').map(cancionOut),
        },
      })
    }
    case 'getPlaylists': return resp({ playlists: { playlist: [{ id: 'pl-1', name: 'Mezcla de ejemplo', songCount: 3 }] } })
    case 'getPlaylist': return resp({ playlist: { id: 'pl-1', name: 'Mezcla de ejemplo', songCount: 3, entry: canciones.slice(0, 3).map(cancionOut) } })
    case 'getStarred2': return resp({ starred2: { song: [...estrellas].map((i) => cancionOut(porId[i])), album: [], artist: [] } })
    // star, unstar, scrobble: el servidor real puede no hacer nada; aquí tampoco.
    case 'star': case 'unstar': case 'scrobble': return resp()
    default: return fallo(0, `Método no implementado: ${metodo}`)
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
    const m = url.pathname.match(/^\/rest\/([A-Za-z0-9]+?)(?:\.view)?$/)
    if (!m) { res.writeHead(404, cors); return res.end('No encontrado') }
    const q = url.searchParams
    const json = (o) => { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)) }
    if (!autenticado(q)) return json(fallo(40, 'Wrong username or password'))
    const metodo = m[1]
    if (metodo === 'stream' || metodo === 'download') {
      const s = porId[q.get('id')]
      if (!s) return json(fallo(70, 'Canción no encontrada'))
      const b = wav(s.id)
      const r = (req.headers.range || '').match(/bytes=(\d+)-(\d*)/)
      if (r) {
        const a = Number(r[1]), z = Math.min(r[2] ? Number(r[2]) : b.length - 1, b.length - 1)
        if (a >= b.length) { res.writeHead(416, { ...cors, 'Content-Range': `bytes */${b.length}` }); return res.end() }
        res.writeHead(206, { ...cors, 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${z}/${b.length}`, 'Content-Length': z - a + 1 })
        return res.end(b.subarray(a, z + 1))
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': b.length })
      return res.end(b)
    }
    if (metodo === 'getCoverArt') {
      const id = q.get('id') || ''
      if (!/^al-\d+$/.test(id)) return json(fallo(70, 'Carátula no encontrada'))
      res.writeHead(200, { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' })
      return res.end(png(Number(id.slice(3)), Math.min(Number(q.get('size') || 120), 240)))
    }
    json(manejar(metodo, q))
  })
  .listen(PORT, () => console.log(`Servidor Subsonic falso en http://localhost:${PORT} (usuario: ${USER}, contraseña: ${PASS})`))
