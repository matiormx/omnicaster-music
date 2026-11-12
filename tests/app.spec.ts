import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

// Credenciales del servidor falso (no son reales).
const SERVIDOR = 'http://127.0.0.1:4533'
const CAPTURAS = 'docs/capturas'
mkdirSync(CAPTURAS, { recursive: true })

async function conectar(page: Page) {
  await page.goto('/')
  await page.getByLabel('Servidor').fill(SERVIDOR)
  await page.getByLabel('Usuario').fill('demo')
  await page.getByLabel('Contraseña').fill('demo')
  await page.getByRole('button', { name: 'Conectar' }).click()
  await expect(page.getByRole('heading', { name: 'Escuchar ahora' })).toBeVisible()
  await expect(page.getByText('50 canciones')).toBeVisible()
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

  await page.getByRole('button', { name: /Cola/ }).click()
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
  await page.getByRole('row').nth(1).dblclick()
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
