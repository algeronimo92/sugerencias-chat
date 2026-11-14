import type { ApiResponse } from '../../../frontend/src/shared/http/contract'
import { CHAT_ID } from '../../fixtures/crm'
import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

type Template = ApiResponse<'/api/templates', 'get'>[number]

function template(id: number, name: string, content: string): Template {
  return {
    id, name, content, shortcut: name.toLowerCase().split(' ')[0], category: 'General', stage: null, task_type: null,
    service: null, is_active: true, visibility: 'global', template_type: 'internal', official_name: null,
    official_language: null, official_category: null, official_status: null, official_rejected_reason: null,
    official_parameter_values: [], meta_template_id: null, official_header_type: 'none', official_header_text: null,
    official_header_media_asset_id: null, official_header_media_url: null, official_header_media_content_type: null,
    official_header_media_filename: null, official_footer: null, official_buttons: [], interactive_type: 'none',
    interactive_config: {}, imported_from_meta: false, is_favorite: false, last_used_at: null, use_count: 0,
    created_by_user_id: null, created_by_name: null, created_at: null, attachments: [],
  }
}

/**
 * Nada quedó corrido: ni la ventana ni ningún contenedor que no se pueda
 * desplazar con el dedo (overflow hidden o clip en ese eje). Las listas con
 * scroll propio no cuentan.
 */
async function expectShellNotShifted(page: import('@playwright/test').Page) {
  const corridos = await page.evaluate(() => {
    const hidden = (value: string) => value === 'hidden' || value === 'clip'
    const found: string[] = []
    if (window.scrollX || window.scrollY) found.push(`ventana ${window.scrollX},${window.scrollY}`)
    for (const element of document.querySelectorAll<HTMLElement>('#root, #root *')) {
      const style = getComputedStyle(element)
      const x = hidden(style.overflowX) ? element.scrollLeft : 0
      const y = hidden(style.overflowY) ? element.scrollTop : 0
      if (x || y) found.push(`${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} ${x},${y}`)
    }
    return found
  })
  expect(corridos).toEqual([])
}

test('abrir las plantillas no corre la interfaz y el panel entra entero en la pantalla', async ({ page, api }) => {
  api.on('get', '/api/templates', [
    template(1, 'Saludo inicial', '¡Hola! Gracias por escribirnos, ¿en qué tratamiento estás interesada?'),
    template(2, 'Precio del tratamiento', 'La sesión cuesta S/ 250 e incluye evaluación previa con la especialista.'),
  ])
  api.on('post', '/api/templates/{template_id}/use', {})

  await page.goto(`/chat/${CHAT_ID}`)
  const composer = page.getByLabel('Escribe un mensaje', { exact: true })
  await expectFullyOnScreen(composer)

  await page.getByRole('button', { name: 'Plantillas y respuestas rápidas' }).click()
  // En el celular el panel se salía ~70 px por la derecha y, al enfocar su
  // buscador fuera de pantalla, el navegador corría toda la interfaz. Se mira
  // por el buscador y las opciones, que existían antes del arreglo.
  await expectFullyOnScreen(page.getByPlaceholder('Buscar respuesta o /atajo'))
  await expectFullyOnScreen(page.getByRole('button', { name: /Precio del tratamiento/ }))
  await expectShellNotShifted(page)
  await expectNoPageOverflow(page)
  await expectFullyOnScreen(composer)
  const panel = page.getByRole('dialog', { name: 'Plantillas y respuestas rápidas' })
  await expectFullyOnScreen(panel)

  await panel.getByRole('button', { name: /Saludo inicial/ }).click()
  await expect(panel).toBeHidden()
  await expect(composer).toHaveValue(/Gracias por escribirnos/)
  await expectShellNotShifted(page)
})

test('si algo corre la app en el celular, la barra inferior vuelve a quedar a la vista', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'La barra inferior solo existe en el celular')

  await page.goto('/')
  const barra = page.getByRole('navigation', { name: 'Vista principal' })
  await expectFullyOnScreen(barra)

  // Enfocar un campo fuera de pantalla hace que el navegador corra la página
  // para mostrarlo, aunque tenga overflow: hidden; es lo que pasaba con el
  // buscador de plantillas o con el teclado. Al salir del campo, antes la
  // página quedaba corrida y la barra inferior fuera de la pantalla.
  await page.evaluate(() => {
    const campo = document.createElement('input')
    campo.id = 'campo-fuera-de-pantalla'
    campo.style.cssText = 'position:absolute;top:2000px;left:0'
    document.getElementById('root')!.firstElementChild!.appendChild(campo)
    campo.focus()
  })
  // El campo sigue en la página al salir de él, como un buscador de verdad:
  // si se quitara, la página se achicaría y el navegador volvería solo a cero.
  await page.evaluate(() => document.getElementById('campo-fuera-de-pantalla')!.blur())
  await expectShellNotShifted(page)
  await expectFullyOnScreen(barra)
  await page.evaluate(() => document.getElementById('campo-fuera-de-pantalla')!.remove())

  await page.reload()
  await expectFullyOnScreen(page.getByRole('navigation', { name: 'Vista principal' }))
  await expectShellNotShifted(page)
})
