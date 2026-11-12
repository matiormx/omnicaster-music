// MD5 compacto, solo para el backend web de desarrollo (en la app real lo hace Rust).
export function md5(texto: string): string {
  const bytes = new TextEncoder().encode(texto)
  const n = bytes.length
  const total = (((n + 8) >> 6) + 1) * 16
  const w = new Int32Array(total)
  for (let i = 0; i < n; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8)
  w[n >> 2] |= 0x80 << ((n % 4) * 8)
  w[total - 2] = n * 8
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0)
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476
  const rol = (x: number, c: number) => (x << c) | (x >>> (32 - c))
  for (let o = 0; o < total; o += 16) {
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f: number, g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      const t = d; d = c; c = b
      b = (b + rol((a + f + K[i] + w[o + g]) | 0, S[(i >> 4) * 4 + (i % 4)])) | 0
      a = t
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0
  }
  return [a0, b0, c0, d0].map((v) => Array.from({ length: 4 }, (_, i) => ((v >>> (i * 8)) & 255).toString(16).padStart(2, '0')).join('')).join('')
}
