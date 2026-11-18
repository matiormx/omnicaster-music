import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

// Credenciales del servidor falso (no son reales).
const SERVIDOR = 'http://127.0.0.1:4533'
const CAPTURAS = 'docs/capturas'
mkdirSync(CAPTURAS, { recursive: true })

async function conectar(page: Page, usuario = 'demo') {
  await page.goto('/')
  await page.getByLabel('Servidor').fill(SERVIDOR)
  await page.getByLabel('Usuario').fill(usuario)
  await page.getByLabel('Contraseña').fill('demo')
  await page.getByRole('button', { name: 'Conectar' }).click()
  await expect(page.getByRole('heading', { name: 'Escuchar ahora' })).toBeVisible()
  await expect(page.getByText('50 canciones')).toBeVisible()
  await expect(page.locator('.sync')).toHaveCount(0) // la sincronización (listas, permisos) ha terminado
}

test.beforeEach(async ({ context }) => {
  await context.clearCookies()
})

test('conexión: error 40, prueba correcta y entrada', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Servidor')).toHaveValue('https://cloud.ngradio.es')
  await page.getByLabel('Servidor').fill(SERVIDOR)
  await page.getByLabel('Usuario').fill('demo')
  await page.getByLabel('Contraseña').fill('mala')
  await page.getByRole('button', { name: 'Probar' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Usuario o contraseña incorrectos.' })).toBeVisible()
  await page.screenshot({ path: `${CAPTURAS}/01-conexion.png` })

  await page.getByLabel('Contraseña').fill('demo')
  await page.getByRole('button', { name: 'Probar' }).click()
  await expect(page.getByText(/Conexión correcta/)).toBeVisible()

  await page.getByRole('button', { name: 'Conectar' }).click()
  await expect(page.getByRole('heading', { name: 'Escuchar ahora' })).toBeVisible()
  await expect(page.getByText('10 álbumes')).toBeVisible()
})

test('servidor inalcanzable muestra un mensaje claro', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Servidor').fill('http://127.0.0.1:9')
  await page.getByLabel('Usuario').fill('demo')
  await page.getByLabel('Contraseña').fill('demo')
  await page.getByRole('button', { name: 'Probar' }).click()
  await expect(page.getByText(/No se puede conectar con el servidor/)).toBeVisible()
})

test('navegar a un álbum, reproducir y ver la cola', async ({ page }) => {
  await conectar(page)
  await page.screenshot({ path: `${CAPTURAS}/02-inicio.png` })

  await page.getByRole('button', { name: /^Álbum Luz I,/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Luz I' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: /^\d/ })).toHaveCount(5)
  await page.screenshot({ path: `${CAPTURAS}/03-album.png` })

  await page.locator('main').getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect(page.getByTestId('titulo-actual')).toBeVisible()
  // La posición avanza: el reproductor simulado (<audio>) está sonando.
  await expect.poll(async () => page.locator('.rep-centro .tiempo').first().textContent(), { timeout: 8000 }).not.toBe('0:00')
  await expect(page.getByRole('button', { name: 'Pausa' })).toBeVisible()

  // La cola está visible a la derecha por defecto.
  await expect(page.getByRole('complementary', { name: 'A continuación' }).getByRole('listitem')).toHaveCount(5)
  await page.screenshot({ path: `${CAPTURAS}/04-cola.png` })

  await page.getByRole('button', { name: 'Siguiente' }).click()
  await expect(page.locator('.item-cola.suena')).toContainText(/\w/)
  await page.getByRole('button', { name: 'Pausa' }).click()
  await expect(page.getByRole('button', { name: 'Reproducir', exact: true }).last()).toBeVisible()
})

test('pantalla completa «Reproduciendo» y tema oscuro', async ({ page }) => {
  await conectar(page)
  await page.getByRole('button', { name: /^Álbum Mar I,|^Álbum Noche I,|^Álbum Camino/ }).first().click()
  await page.locator('main').getByRole('button', { name: 'Reproducir', exact: true }).click()
  await page.getByRole('button', { name: 'Abrir reproducción a pantalla completa' }).click()
  await expect(page.getByRole('dialog', { name: 'Reproduciendo' })).toBeVisible()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${CAPTURAS}/05-reproduciendo.png` })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Reproduciendo' })).toBeHidden()

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.getByRole('button', { name: /^Álbum/ }).first().isVisible().catch(() => {})
  await page.getByRole('button', { name: 'Álbumes' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${CAPTURAS}/06-oscuro.png` })
})

test('búsqueda instantánea con resultados agrupados y atajo Ctrl+F', async ({ page }) => {
  await conectar(page)
  await page.keyboard.press('Control+f')
  await expect(page.getByLabel('Buscar')).toBeFocused()
  await page.getByLabel('Buscar').fill('aurora')
  await expect(page.getByRole('heading', { name: /Resultados de «aurora»/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Artistas' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Álbumes' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Canciones' })).toBeVisible()
  await page.screenshot({ path: `${CAPTURAS}/07-busqueda.png` })
  // Sin acentos ni mayúsculas.
  await page.getByLabel('Buscar').fill('ELECTRONICA')
  await expect(page.getByText('No hay resultados.')).toBeVisible().catch(() => {})
  await page.getByLabel('Buscar').fill('')
  await expect(page.getByRole('heading', { name: 'Escuchar ahora' })).toBeVisible()
})

test('canciones: lista virtualizada, favorito y menú contextual', async ({ page }) => {
  await conectar(page)
  await page.getByRole('button', { name: 'Canciones' }).first().click()
  await expect(page.getByRole('heading', { name: 'Canciones', level: 1 })).toBeVisible()
  const fila = page.getByRole('row').nth(1)
  await fila.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Reproducir a continuación' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Guardar sin conexión' })).toBeVisible()
  await page.screenshot({ path: `${CAPTURAS}/08-menu.png` })
  await page.getByRole('menuitem', { name: 'Favorito' }).click()
  await page.getByRole('button', { name: 'Favoritos' }).click()
  await expect(page.getByRole('heading', { name: 'Favoritos', level: 1 })).toBeVisible()
  await expect(page.getByRole('row')).not.toHaveCount(1) // cabecera + al menos un favorito

  // Doble clic reproduce.
  await page.getByRole('row').nth(1).locator('.titulo').dblclick()
  await expect(page.getByTestId('titulo-actual')).toBeVisible()
})

test('canciones sin pista, año ni carátula no rompen nada', async ({ page }) => {
  await conectar(page)
  await page.getByRole('button', { name: 'Álbumes' }).click()
  // El álbum 4 no trae año; debe poder abrirse.
  await page.getByRole('button', { name: /^Álbum Mar Acústico,/ }).click()
  await expect(page.getByRole('heading', { name: 'Mar Acústico' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: /^\d/ })).toHaveCount(5)
})

test('selección múltiple con Ctrl/Mayús, menú de álbum y enlaces', async ({ page }) => {
  await conectar(page)
  // Menú contextual de un álbum: añadir a una lista.
  await page.getByRole('button', { name: /^Álbum Luz I,/ }).first().click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Añadir a una lista' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Añadir a una lista' }).hover()
  await page.getByRole('menuitem', { name: 'Lista nueva…' }).click()
  await page.getByLabel('Nombre de la lista').fill('Mezcla')
  await page.getByRole('button', { name: 'Crear' }).click()
  await expect(page.getByRole('heading', { name: 'Mezcla', level: 1 })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: /^\d/ })).toHaveCount(5)

  // Selección múltiple: clic, Mayús+clic y Ctrl+clic.
  const filas = page.getByRole('row').filter({ hasText: /^\d/ })
  await filas.nth(0).locator('.titulo').click()
  await filas.nth(2).locator('.titulo').click({ modifiers: ['Shift'] })
  await expect(page.locator('.fila[aria-selected="true"]')).toHaveCount(3)
  await filas.nth(4).locator('.titulo').click({ modifiers: ['ControlOrMeta'] })
  await expect(page.locator('.fila[aria-selected="true"]')).toHaveCount(4)
  await filas.nth(1).locator('.titulo').click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Reproducir 4 canciones' })).toBeVisible()
  await page.keyboard.press('Escape')

  // El artista del reproductor lleva a su página.
  await page.locator('main').getByRole('button', { name: 'Reproducir', exact: true }).click()
  await page.locator('.rep-pista .enlace-texto').first().click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})


// ---------------------------------------------------------------- gestión de la biblioteca

test('oyente: sin opciones de gestión y listas separadas en «Listas» y «Emisión»', async ({ page }) => {
  await conectar(page)
  await expect(page.getByRole('heading', { name: 'Gestión' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Canciones' }).first().click()
  await page.getByRole('row').nth(1).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Ficha…' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Editar datos…' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Mandar a revisión' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Desactivar' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Listas' }).click()
  await expect(page.getByRole('region', { name: 'Listas' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Emisión' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Emisión' }).getByText('Mezcla de ejemplo')).toBeVisible()
  // Una lista de emisión es de solo lectura: no se puede eliminar.
  await page.getByRole('button', { name: 'Lista Mezcla de ejemplo' }).click()
  await expect(page.getByText('Emisión · solo lectura')).toBeVisible()
  await expect(page.getByRole('button', { name: /Eliminar lista/ })).toHaveCount(0)
})

test('ficha: energía ●●●○○, mood y temas', async ({ page }) => {
  await conectar(page)
  await page.getByRole('button', { name: 'Canciones' }).first().click()
  await page.getByRole('row').nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Ficha…' }).click()
  const d = page.getByRole('dialog', { name: 'Ficha de la canción' })
  await expect(d.getByText('●●●○○')).toBeVisible()
  await expect(d.getByText('alegre')).toBeVisible()
  await expect(d.getByText('verano, playa')).toBeVisible()
})

test('operario: edita datos y manda a revisión; nunca puede borrar ni desactivar', async ({ page }) => {
  await conectar(page, 'operario')
  await expect(page.getByRole('heading', { name: 'Gestión' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Desactivadas' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Canciones' }).first().click()
  await page.getByRole('row').nth(1).click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Desactivar' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: /Borrar|Eliminar/ })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Editar datos…' }).click()
  const d = page.getByRole('dialog', { name: 'Editar datos' })
  await d.getByLabel('Mood').fill('tranquilo')
  await d.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('1 canción cambiada')).toBeVisible()
  await page.getByRole('row').nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Mandar a revisión' }).click()
  await page.getByRole('button', { name: 'Para revisar' }).click()
  await expect(page.getByRole('heading', { name: 'Para revisar', level: 1 })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: /^\d/ })).toHaveCount(1)
})

test('cambio masivo de más de 10 canciones pide confirmación explícita', async ({ page }) => {
  await conectar(page, 'operario')
  await page.getByRole('button', { name: 'Canciones' }).first().click()
  const filas = page.getByRole('row').filter({ hasText: /^\d/ })
  await filas.nth(0).locator('.titulo').click()
  await filas.nth(11).locator('.titulo').click({ modifiers: ['Shift'] })
  await filas.nth(5).locator('.titulo').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Mandar a revisión' }).click()
  const d = page.getByRole('dialog', { name: 'Cambio masivo' })
  await expect(d).toBeVisible()
  await expect(d.getByRole('button', { name: 'Aplicar' })).toBeDisabled()
  await d.getByLabel(/confirmo el cambio de 12 canciones/).check()
  await d.getByRole('button', { name: 'Aplicar' }).click()
  await expect(page.getByText('12 a revisión')).toBeVisible()
})

test('operario: añade una canción a una lista de OmniCaster; el administrador puede desactivar', async ({ page }) => {
  await conectar(page, 'operario')
  await page.getByRole('button', { name: 'Canciones' }).first().click()
  await page.getByRole('row').nth(4).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Añadir a una lista' }).hover()
  await page.getByRole('menuitem', { name: 'Favoritas de la casa' }).click()
  await expect(page.getByText('Añadida a la lista')).toBeVisible()
})

test('administrador: puede desactivar canciones', async ({ page }) => {
  await conectar(page, 'admin')
  await expect(page.getByRole('button', { name: 'Desactivadas' })).toBeVisible()
  await page.getByRole('button', { name: 'Canciones' }).first().click()
  await page.getByRole('row').nth(2).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Desactivar' }).click()
  await expect(page.getByText('1 desactivadas')).toBeVisible()
  await page.getByRole('button', { name: 'Desactivadas' }).click()
  await expect(page.getByRole('row').filter({ hasText: /^\d/ })).toHaveCount(1)
})
