# 18 — Rediseño de la UI: auditoría y sistema visual (fase 1)

Fecha: 2026-11-19. Rama de trabajo al escribirlo: `feature/contactos`. Estado: **propuesta**, sin código tocado.

Este documento abre el rediseño completo de la interfaz del CRM. Tiene cuatro partes:
auditoría del frontend actual con archivo y línea, el sistema visual nuevo (tokens listos para
pegar), la pantalla de chats en columnas y el plan de migración por fases con sus riesgos.

La referencia que eligió el usuario es el Live Chat de Manychat. Se toma su **estructura y su
contención visual**, no su marca: ni logo, ni nombre, ni su verde, ni su sección de canales (acá
hay un solo canal, ver §6.3).

---

## 0. Resumen de decisiones

| # | Decisión | Por qué |
|---|---|---|
| 1 | Tokens **semánticos que cambian solos con el tema** (`bg-surface`, `text-fg`, `border-line`) en vez de pares `wa-x` / `wa-x-dark` | Hoy hay 3.783 prefijos `dark:` en `.tsx`. Con variables que se redefinen en `.dark`, un componente se escribe una vez y el modo oscuro no se puede olvidar |
| 2 | Un solo acento, **el color de marca del negocio** (hoy `#00a884` por defecto) | La app ya es marca blanca: `applyBrand()` pisa el primario por tenant. El sistema tiene que funcionar con cualquier color, no solo con el verde |
| 3 | Relleno de acción con `accent-strong` (`#008069`) y no con `#00a884` | El botón primario actual da 3,0:1 (texto blanco sobre `#00a884`). Con `#008069` da 4,9:1 |
| 4 | Superficies blancas, separadores de 1 px, sin tarjetas flotantes ni sombras en los paneles | Es el rasgo de la referencia que pide el usuario y además baja el ruido: hoy cada columna es una tarjeta con sombra sobre un fondo gris con relleno |
| 5 | Navegación con **icono y etiqueta**, activo marcado con color de acento y peso semibold, sin bloque de fondo | Etiqueta visible: hoy el nombre de la vista solo está en un tooltip, que no existe en táctil. El peso es la señal que no depende del color (WCAG 1.4.1) |
| 6 | Chats en columnas: riel, **bandejas con contadores**, lista, hilo y ficha | Ley de Jakob (WhatsApp/Manychat) y reconocer antes que recordar: los filtros que hoy viven en un panel desplegable pasan a estar siempre a la vista |
| 7 | Texto de interfaz con **mínimo 12 px** | Hoy hay 485 usos de `text-[9px]`, `text-[10px]` y `text-[11px]` |
| 8 | Nada de colores sueltos en componentes: ni `[#hex]` ni paletas de Tailwind (`gray-*`, `green-*`, `violet-*`) | Hoy hay 81 hex arbitrarios y más de 1.800 clases de paleta cruda que no siguen ni al tema ni a la marca |
| 9 | Migración por capas: tokens con **puente** `wa-*` → semánticos, luego `shared/`, luego feature por feature ordenadas por uso | Un primer PR cambia el aspecto global sin tocar las 15 features; cada PR siguiente deja la suite verde |

---

## 1. Quién usa esto y en qué condiciones

| Rol | Pantalla dominante | Contexto | Lo que necesita |
|---|---|---|---|
| Vendedora | Chats (lista + hilo + ficha) | Escritorio la jornada entera; celular (PWA) fuera de la clínica | Ver qué responder primero, responder rápido, mover de etapa sin salir del chat. Densidad y atajos |
| Admin / dueña | Chats, embudo, dashboard, configuración | Escritorio, ratos cortos varias veces al día | Ver la carga del equipo y los chats sin dueño; configurar sin buscar dónde está cada cosa |
| Analista | Dashboard | Escritorio | Leer métricas; no ve el resto (`navigation.ts:54`) |

Consecuencia de diseño: la pantalla de chats es la que se optimiza primero y sin concesiones de
densidad para la vendedora. Las pantallas de administración se optimizan para encontrar, no para
la velocidad.

---

## 2. Qué se toma de la referencia y qué no

| Rasgo de Manychat | Se toma | Adaptación |
|---|---|---|
| Fondo blanco/gris muy claro, separadores finos, casi sin sombras | Sí | `canvas` `#f6f7f9`, `surface` blanco, `line` `#e4e7eb`. Sombra solo en lo que flota (menús, modales) |
| Navegación con icono de línea + etiqueta; activo solo con color | Sí, con un ajuste | Se suma semibold al activo: el color solo no basta para quien no distingue el verde (WCAG 1.4.1) |
| Columna de filtros con títulos de sección, contador a la derecha, seleccionado en pastilla gris | Sí | Secciones con datos reales de la app: bandejas de asignación, atención, etapas, etiquetas (§6.3) |
| Secciones plegables | Sí | Etapas y etiquetas plegables; el estado se recuerda por usuario |
| Lista: avatar redondo grande, nombre semibold, vista previa gris, tiempo relativo, punto de no leído | Sí | Se conserva el contador numérico de WhatsApp además del punto (pregunta abierta 3) |
| Selector "Open 46" con casilla de selección múltiple, filtro y orden | Sí | "Abiertas 46" usa `conversacion_abierta`, que ya existe en el lead. La selección múltiple usa `bulkMoveStage` y `bulkAssignTag`, que ya existen |
| Sección "Channels" con Instagram, Facebook, etc. | **No** | La app tiene un solo canal (WhatsApp Cloud API). Una sección con un ítem es ruido (Hick). Aparece el día que haya un segundo canal |
| Su verde, su logo, sus iconos de marca de colores | **No** | El acento es el color de marca del tenant |
| Tipografía grande | Sí | Escala 12/14/15/16/20/24 con el nombre en lista a 15 px |

---

## 3. Auditoría del frontend actual

Recorrido: `frontend/src/index.css`, `shared/ui/*`, `app/{layout,Sidebar,MobileNavBar,navigation}`,
`features/chats` (lista, ítem, espacio de trabajo, hilo), `features/contacts`, `features/dashboard`,
`features/platform/components/SettingsDialog.tsx` y los encabezados de todas las páginas.

### 3.1 Cifras globales (`.tsx` de producción)

| Medida | Valor | Lectura |
|---|---|---|
| Prefijos `dark:` | 3.783 | El modo oscuro se escribe a mano en cada clase: es fácil olvidarlo y el resultado diverge |
| `dark:text-white` | 110 | Blanco puro en oscuro, cuando el token es `wa-text-dark` `#e9edef` |
| `bg-white` | 445 | Superficie sin token: no se puede re-apuntar |
| Hex arbitrarios `[#...]` | 81 en 14 archivos | Colores fuera del sistema |
| Paleta cruda de Tailwind | red 670, amber 405, gray 307, green 166, blue 114, violet 97, emerald 41, sky 39 | Cuatro grises y tres verdes conviven; `gray-*` no es la familia de grises de la app |
| Texto de 8 a 11 px | 485 (`text-[11px]` 249, `[10px]` 200, `[9px]` 36) | Por debajo del mínimo de 12 px |
| Radios | `rounded-lg` 394, `-full` 266, `-xl` 225, `-md` 141, `rounded` 83, `-2xl` 59 | Seis radios sin regla de cuándo usar cuál |
| Sombras | `shadow-sm` 87, `shadow` 32, `-2xl` 30, `-xl` 25, `-lg` 16 | Cinco niveles de elevación sin escala |
| `<button>` a mano vs `<Button>` | 442 vs 240 | Dos de cada tres botones no usan el componente base |
| `Card` de `shared/ui` | **0 importaciones** | Existe y nadie lo usa; la misma tarjeta está escrita a mano 69 veces (`rounded-xl border border-wa-border bg-white`) |
| `Spinner` de `shared/ui` | **0 importaciones** | Cada pantalla usa `Loader2` con su propio tamaño y color |
| `<h1>` de página | 5 tamaños: `text-base`, `xl`, `2xl`, `3xl`, `[38px]` | Ver §3.4 |

### 3.2 Crítico (accesibilidad o errores de lectura)

1. **El botón primario no llega a 4,5:1.**
   `shared/ui/Button.tsx:11`: texto blanco semibold de 14 px sobre `bg-wa-primary` `#00a884` = **3,0:1**.
   Principio: WCAG 1.4.3. Solución: el relleno de acción es `accent-fill` = `#008069` en claro (4,9:1);
   `#00a884` queda para lo decorativo (punto de no leído, icono activo, anillo de foco en oscuro).
   El contador de no leídos tiene el mismo problema y además a 11 px: `features/chats/components/ChatItem.tsx:318`,
   `app/MobileNavBar.tsx:176`, `shared/ui/Badge.tsx:9`.

2. **El texto gris no pasa sobre el fondo gris.** `wa-muted` `#667781` da 4,6:1 sobre blanco pero
   **4,1:1 sobre `#f0f2f5`**, que es a la vez `wa-app`, `wa-head`, `wa-field` y `wa-active`
   (`index.css:30,32,34,38`). Todo texto secundario dentro de un encabezado, un campo o una fila
   seleccionada falla. Solución: `fg-muted` `#5b6670` (5,9:1 sobre blanco, 5,3:1 sobre `subtle`).

3. **Los campos de formulario no tienen borde perceptible.** `shared/ui/Input.tsx:17`: `bg-wa-field`
   con `border-transparent`; el gris `#f0f2f5` sobre blanco da 1,1:1. Principio: WCAG 1.4.11 (contraste
   de componentes, 3:1). Solución: campo blanco con borde `line-control` `#8a949e` (3,1:1).

4. **Filtros con placeholder como etiqueta.** `features/chats/components/ChatList.tsx:618-635`
   ("Servicio", "Origen"), `:671-684` ("Inactivo (días)") y selects cuya primera opción hace de
   etiqueta (`:648-653`, `:665-668`, `:696`). Al escribir, la etiqueta desaparece. Principio: WCAG 3.3.2
   y "el placeholder no es etiqueta". Solución: componente `Field` con `<label>` visible (§5.5).

5. **El nombre de cada vista vive solo en un tooltip.** `app/Sidebar.tsx:10-12` lo dice explícitamente.
   En tablet táctil no hay hover; con 14 iconos, varios no son universales (`Bug` para reportes,
   `Columns3` para kanban, `Send` para flujos enviados). Principio: reconocer antes que recordar; el
   tooltip no puede ser el único portador. Solución: riel con etiqueta visible y modo compacto opcional (§5.1).

6. **La navegación son botones, no enlaces.** `app/Sidebar.tsx:47` y `app/MobileNavBar.tsx:172`
   usan `<button onClick={navigate}>`: no hay "abrir en otra pestaña", ni clic central, ni
   `aria-current="page"`. Principio: HTML nativo antes que ARIA (`<a>` para navegar). Solución:
   `NavLink` de react-router.

7. **Un mismo concepto en dos colores.** El contador de no leídos es rojo en el riel
   (`app/Sidebar.tsx:51`, `bg-red-500`, 9 px) y verde en la barra inferior (`MobileNavBar.tsx:176`).
   El rojo además significa error. Principio: consistencia y semántica estable del color.

8. **Conversación cerrada en rojo.** `features/chats/components/ChatThread.tsx:388-396`: el
   interruptor abrir/cerrar es un icono solo, rojo cuando está cerrada, y desaparece en móvil
   (`max-sm:hidden`). Cerrar una conversación no es un error. Solución: botón con texto
   ("Cerrar conversación" / "Reabrir"), neutro, y el estado visible en el selector de la lista.

9. **Etiquetas con texto blanco sobre un color que elige el negocio.** `ChatItem.tsx:333-344` y
   `ChatList.tsx:597-609` pintan el fondo con `tag.color` y el texto en blanco, a 10-11 px. Con un
   amarillo o un celeste el contraste cae por debajo de 2:1. Solución: chip neutro con un punto del
   color de la etiqueta (el color decora, el texto lo lleva `fg`).

10. **Cierres sin nombre o diminutos.** `app/layout.tsx:332-337` (aviso de mención: botón X sin
    `aria-label`, 24 px); `features/platform/components/SettingsDialog.tsx:47-53` (X de 16 px sin
    área táctil, hover con `gray-600`, fuera de la paleta).

### 3.3 Importante (consistencia, tokens, jerarquía)

1. **Tokens duplicados con el mismo valor.** `index.css:30,32,34,38`: cuatro nombres para `#f0f2f5`.
   `index.css:25,33,37`: `wa-in-dark`, `wa-head-dark` y `wa-hover-dark` son todos `#202c33`.
   `index.css:35,39`: `wa-field-dark` = `wa-active-dark`. En oscuro, hover y seleccionado se ven
   igual que un encabezado. Además `wa-faint` y `wa-muted` se invierten entre modos (`:48-51`):
   el "más tenue" en claro es el "más fuerte" en oscuro.

2. **Un tercer fondo fuera del sistema.** `app/layout.tsx:349` y `features/chats/components/ChatWorkspace.tsx:322`:
   `bg-[#edf2f0] dark:bg-[#081216]`, distinto de `wa-app` (`#f0f2f5` / `#0c1317`). Y otros dos más
   en `index.css`: `body` `#008069` (`:228`, por la barra de Safari) y `.dark body` `#202c33` (`:249`),
   `#root` `#f0f2f5` / `#0c1317` (`:267`, `:271`) escritos en hex en vez de con el token.

3. **Dos sistemas de color para gráficos.** `index.css:65-80` (`--color-viz-*` en `@theme`, con
   `-dark`) y `index.css:103-128` (`--viz-cat-*` en `:root`/`.dark`, que cambian solos). El segundo
   es el patrón correcto; el primero obliga a escribir `dark:`.

4. **Hex sueltos dentro de CSS de componentes.** `index.css:288-323` (barras de desplazamiento),
   `index.css:454-490` (`.automation-form`, que fuerza colores de texto con hex y `accent-color: #00a884`
   en `:468`, ignorando la marca del tenant).

5. **Las columnas de chats son tarjetas flotantes.** `ChatWorkspace.tsx:322` pone `gap-2 p-2` sobre
   el fondo gris; `ChatList.tsx:413` y `ChatWorkspace.tsx:375,424` son tarjetas `rounded-2xl` con
   borde y `shadow-sm`. Son tres marcos más tres sombras que compiten con el contenido; la referencia
   separa columnas con una línea de 1 px. Principio: Gestalt (el espacio y una línea bastan para
   separar), minimalismo.

6. **Cinco jerarquías de título de página.** `ChatList.tsx:419` `text-base font-bold`;
   `DashboardPage.tsx:91` y `KanbanBoard.tsx:419` `text-xl font-semibold`; `ContactsPage.tsx:94`,
   `TasksPage.tsx:433`, `CatalogsPage.tsx:34` `text-2xl font-semibold`; `AutomationsPage.tsx:355`,
   `TemplatesPage.tsx:385`, `MediaLibraryPage.tsx:169` `text-3xl font-bold`. Pasar de una vista a otra
   cambia el tamaño del título. Solución: `PageHeader` único (§5.10).

7. **Avatar cuadrado e idéntico para todos.** `ChatItem.tsx:249`: `rounded-xl` con el mismo
   degradado verde para cada lead. No ayuda a reconocer a nadie y contradice la referencia y WhatsApp
   (círculo). Solución: `Avatar` redondo, iniciales sobre un tono derivado del id (8 tonos validados).

8. **Menú contextual hecho a mano.** `ChatItem.tsx:357-420`: `div` fijo con `z-[100]`. Sin Radix no
   hay navegación con flechas, foco atrapado ni retorno del foco al disparador. El archivo pasa de
   400 líneas (443) en buena parte por esto.

9. **`Modal` y `Dialog` conviven.** `shared/ui/Modal.tsx` es el armazón accesible (9 usos), pero
   `shared/ui/Dialog.tsx` exporta solo clases sueltas y 25 diálogos arman su propia cabecera, cierre
   y pie (p. ej. `SettingsDialog.tsx`). Tres formas de cerrar, tres paddings.

10. **Tarjetas del dashboard reescritas.** `features/dashboard/components/primitives.tsx:39,47,75`
    repiten la tarjeta con `shadow-sm` y `hover:shadow-md`, título en `gray-800` (`:79`) y subtítulo
    a 11 px (`:80`), icono de KPI en `bg-green-50` (`:26`): verde de Tailwind, no el de la marca.

11. **Segundo acento violeta para la IA.** `ChatWorkspace.tsx:97-113`, `InternalNoteComposer.tsx`,
    `NotificationCenter.tsx`, 97 usos de `violet-*`. Si la IA tiene color propio, que sea un token
    (`info` o un `ai` semántico), no una paleta suelta.

12. **Navegación plana de 14 entradas.** `app/navigation.ts:17-32`. Mezcla vistas de uso diario
    (Chats, Tareas) con configuración (Catálogos, Integraciones, Asistente IA) y una **acción**
    disfrazada de vista ("Nueva Cita", `:22`). En móvil, "Reportes" de errores (`:23`) ocupa una de
    las tres pestañas principales. Principio: Hick, un objetivo por pantalla, ayuda consistente
    (WCAG 3.2.6: reportar un problema debería vivir siempre en el mismo sitio, junto a la ayuda).

13. **Vistas guardadas solo en este navegador.** `ChatViewChips.tsx` guarda en `localStorage`: la
    vista que una vendedora arma en la PC no está en su celular. No es parte de esta fase, pero el
    panel de bandejas las va a exponer y conviene saberlo (pregunta abierta 9).

### 3.4 Pulido

- `app/layout.tsx:169,188`: chip "CRM" y rol del usuario a 9 px.
- `app/layout.tsx:311`: el aviso de mención es un toast propio en ámbar; ya está `sonner` en el proyecto.
- `shared/ui/Input.tsx:161`: título de grupo del select a 10 px en mayúsculas.
- `ChatWorkspace.tsx:65`: rótulo a 10 px con `tracking-[0.18em]`.
- `ChatViewChips.tsx:26,109`: chips a 11 px en escritorio y 32 px de alto en móvil (mejor que antes, aún bajo 44).
- `Sidebar.tsx:49` cambia el grosor del trazo del icono (1,8 a 2,4) al activarse: el icono "salta".
- `SettingsDialog.tsx:24` pestañas con relleno verde lleno: tercer patrón de pestañas (los otros:
  `LeadPanelTabs.tsx` y el segmentado de `ChatList.tsx:497-530`).
- Estados vacíos solo con texto: `ChatList.tsx:788-791` ("Sin resultados.", "No hay chats sin leer."),
  `AutomationsPage.tsx:431`. `EmptyState` existe (6 usos) y no se usa ahí.
- Error de lista en rojo de Tailwind sin acción de reintento visible en todos los casos (`ChatList.tsx:104-110`, `:778`).

---

## 4. Sistema visual

### 4.1 Principios

1. **Una sola voz de color.** Neutros para todo; el acento solo para "esto es acción" o "esto está
   activo". Los colores de estado (peligro, advertencia, éxito, información) aparecen siempre con
   icono o texto.
2. **La jerarquía la hacen el tamaño y el peso.** El gris secundario es uno solo (`fg-muted`).
3. **Separar con espacio y una línea, no con cajas.** Las tarjetas quedan para contenido que se
   agrupa de verdad (un KPI, un bloque de configuración), no para enmarcar columnas.
4. **Escribir el componente una vez.** Los tokens cambian con el tema; `dark:` queda para excepciones.
5. **Marca blanca segura.** Cualquier color de tenant tiene que pasar contraste; si no, se oscurece
   (claro) o se aclara (oscuro) solo.

### 4.2 Paleta

Tres capas: **primitivo** (el valor), **semántico** (la intención, cambia con el tema) y
**componente** (la clase que escribe el componente). Los contrastes están calculados con la fórmula
WCAG 2.x sobre el fondo indicado.

**Claro**

| Token | Valor | Uso | Contraste clave |
|---|---|---|---|
| `canvas` | `#f6f7f9` | Fondo de la app detrás de las páginas | — |
| `surface` | `#ffffff` | Paneles, columnas, tarjetas, campos | — |
| `surface-raised` | `#ffffff` | Menús, popovers, modales (con sombra) | — |
| `subtle` | `#f2f4f6` | Hover de filas e ítems | — |
| `selected` | `#e9ecef` | Ítem seleccionado (pastilla gris) | `fg` sobre él 15:1 |
| `line` | `#e4e7eb` | Separadores y bordes de tarjeta (decorativos) | — |
| `line-control` | `#8a949e` | Borde de inputs, selects, checkboxes | 3,1:1 sobre `surface` |
| `fg` | `#111b21` | Texto principal | 17:1 |
| `fg-muted` | `#5b6670` | Texto secundario, metadatos, vista previa | 5,9:1 sobre `surface`; 5,3:1 sobre `subtle` |
| `fg-disabled` | `#9aa3ab` | Deshabilitado (exento de contraste) | — |
| `accent` | marca (`#00a884`) | Punto de no leído, icono activo, decoración | 3,0:1 (solo no-texto) |
| `accent-strong` | marca oscurecida (`#008069`) | Texto de acento, enlaces, nav activa | 4,9:1 sobre `surface` |
| `accent-fill` | = `accent-strong` | Relleno de botón primario y contador | texto blanco 4,9:1 |
| `accent-soft` | 10 % de marca sobre blanco | Fondo de chip o aviso de acento | `accent-deep` sobre él ≥ 5,5:1 |
| `on-accent` | `#ffffff` | Texto sobre `accent-fill` | — |
| `ring` | = `accent-strong` | Anillo de foco de 2 px | 4,9:1 |
| `danger` / `danger-fg` / `danger-soft` | `#dc2626` / `#b42318` / `#fdecea` | Error, destructivo | 4,8:1 / 5,8:1 sobre soft |
| `warning` / `warning-fg` / `warning-soft` | `#b45309` / `#92400e` / `#fef3e2` | Advertencia, ventana 24 h por vencer | 5,0:1 |
| `success` / `success-fg` / `success-soft` | `#15803d` / `#166534` / `#e7f6ec` | Éxito (distinto del verde de marca) | 5,0:1 |
| `info` / `info-fg` / `info-soft` | `#1d64d8` / `#1e4fae` / `#e8f0fd` | Informativo, IA, tick leído en texto | 5,4:1 |

**Oscuro** (se re-apunta, no se invierte; grises algo menos azulados que los actuales)

| Token | Valor | Contraste clave |
|---|---|---|
| `canvas` | `#0b1014` | — |
| `surface` | `#11181d` | — |
| `surface-raised` | `#182127` | Sustituye a la sombra, que en oscuro no se ve |
| `subtle` | `#1a232a` | — |
| `selected` | `#233039` | — |
| `line` | `#24303a` | — |
| `line-control` | `#66727c` | 3,6:1 sobre `surface` |
| `fg` | `#e9edef` | 15:1 |
| `fg-muted` | `#9aa6ae` | 7,2:1 |
| `fg-disabled` | `#5f6b73` | — |
| `accent` / `accent-strong` | marca (`#00a884`) | 5,9:1 sobre `surface` |
| `accent-fill` + `on-accent` | marca + `#0b141a` | 5,7:1 (texto oscuro sobre verde, como WhatsApp oscuro) |
| `danger` | `#f07167` | 6,2:1 |
| `warning` | `#e5a43a` | > 8:1 |
| `success` | `#4cc38a` | > 7:1 |
| `info` | `#6aa8f5` | > 7:1 |

**Burbujas, fondo del hilo y editor de flujos**: se conservan (`wa-chat`, `wa-out`, `wa-in`,
`wa-faint-strong`, `flow-*`). Dentro del hilo la metáfora de WhatsApp sigue mandando (Jakob); se
convierten a variables que cambian solas en la fase 5, sin cambiar los valores.

**Avatares**: 8 tonos de fondo suave con iniciales en su tono `-fg`, elegidos por hash del id del
lead. Cada par se valida a 4,5:1 en los dos modos antes de entrar al sistema.

### 4.3 Marca del tenant con contraste garantizado

`shared/branding.ts:34-45` deriva `strong` y `deep` multiplicando por 0,76 y 0,655. Con un color
de marca claro (amarillo, celeste) `strong` puede quedar por debajo de 4,5:1. Propuesta:

- `applyBrand()` deja de escribir `--color-wa-primary*` y escribe `--brand`, `--brand-strong`,
  `--brand-deep` (la misma lógica en el script en línea de `index.html:45-63`).
- `brandShades()` oscurece `strong` hasta llegar a 4,5:1 contra blanco y `deep` hasta 4,5:1 contra
  `accent-soft`. Para oscuro, se comprueba `--brand` contra `#11181d` y se aclara si hace falta.
- `--brand-soft` no lo calcula JS: es `color-mix()` en CSS, así sigue a cualquier marca.
- Tests en `branding.test.ts` con tres colores límite (amarillo `#f5c400`, celeste `#53bdeb`, azul
  marino `#173185`, que ya usa el test actual).

### 4.4 Tipografía

Fuente del sistema (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`), como hoy: cero
bytes, nativa en cada plataforma. Alternativa en la pregunta abierta 6.

| Rol | Tamaño / alto de línea | Peso | Clase |
|---|---|---|---|
| Título de página (h1) | 20 / 28 | 600 | `text-xl font-semibold` |
| Título de sección, modal (h2) | 16 / 24 | 600 | `text-base font-semibold` |
| Nombre en lista, título de tarjeta | 15 / 22 | 600 (no leído) o 500 | `text-md` (token nuevo) |
| Cuerpo, ítems de nav y filtros, campos | 14 / 20 | 400, activo 600 | `text-sm` |
| Mensaje en burbuja | 14,2 / 19 | 400 | se conserva |
| Metadatos, contadores, etiquetas, ayuda | 12 / 16 | 500 | `text-xs` |
| Cifra de KPI | 24 / 32 | 600, `tabular-nums` | `text-2xl` |

Reglas: nada por debajo de 12 px; dos pesos por bloque (regular y semibold); mayúsculas con
tracking solo en rótulos de 12 px y con moderación; números alineados en columnas con `tabular-nums`.

### 4.5 Espaciado

Escala de Tailwind (múltiplos de 4 px), sin valores arbitrarios. Convención por contenedor:

| Contenedor | Relleno |
|---|---|
| Página (escritorio / móvil) | 32 / 16 px horizontal (`px-8` / `px-4`), 24 px arriba |
| Columna de chats (cabecera) | 16 px horizontal, 12 px vertical |
| Fila de lista | 16 px horizontal, 12 px vertical; avatar 44 px; separación 12 px |
| Ítem de nav y de filtro | 12 px horizontal, 40 px de alto (44 en táctil) |
| Tarjeta | 20 px (16 en móvil) |
| Modal | 24 px (cabecera y cuerpo), pie 16 px vertical |
| Entre secciones de una página | 32 px |
| Entre campos de formulario | 16 px |

### 4.6 Radios

Se usan los valores por defecto de Tailwind 4 (no se redefinen: cambiarlos movería 900 usos de un
golpe) con una regla de uso:

| Radio | Valor | Para qué |
|---|---|---|
| `rounded-md` | 6 px | Checkbox, chips pequeños, teclas |
| `rounded-lg` | 8 px | Botones, inputs, ítems de nav y filtros (pastilla), filas seleccionadas |
| `rounded-xl` | 12 px | Tarjetas, menús, popovers, modales |
| `rounded-2xl` | 16 px | Hoja inferior en móvil (solo esquinas superiores) |
| `rounded-full` | — | Avatares, contadores, punto de no leído, búsqueda en píldora |
| `rounded-bubble` | 7,5 px | Burbujas (se conserva) |

### 4.7 Elevación

| Nivel | Uso | Claro | Oscuro |
|---|---|---|---|
| 0 | Columnas, páginas, tarjetas | Sin sombra; `line` si hace falta | Igual |
| 1 | Menús, popovers, select abierto, tooltip | `shadow-popover` | `surface-raised` + `line` |
| 2 | Modales, hojas, cajón de la ficha | `shadow-overlay` + velo `rgb(11 20 26 / 0.45)` | `surface-raised` + velo `0.6` |

### 4.8 Iconografía

- Solo `lucide-react` (ya integrado). Sin emojis en la UI. Marcas de terceros (WhatsApp, Meta,
  Google) solo con `BrandMarks.tsx` y solo en Integraciones.
- Trazo 1,75 en todo (el de Lucide es 2; 1,75 se acerca al "línea fina" de la referencia sin
  perder lectura a 16 px). El activo **no** cambia el trazo: cambia el color y la etiqueta pasa a
  semibold.
- Tamaños: 20 px en navegación y acciones de cabecera; 16 px en línea con texto de 14 px;
  14 px junto a texto de 12 px.
- Icono sin texto solo para acciones universales (cerrar, buscar, enviar, adjuntar, más). El resto
  lleva etiqueta visible o, en barras densas, `aria-label` + tooltip + la misma acción con texto
  en el menú "Más".

### 4.9 Movimiento

Se conserva lo que hay (`ui-popover-in` 140 ms, tooltips, `prefers-reduced-motion` global en
`index.css:439-449`). Reglas nuevas:

- Plegar columnas o secciones no anima `width` ni `height`: o es instantáneo o se hace con
  `motion` y `layout` (transform). 
- Cajón de la ficha y hoja inferior: 220 ms `ease-out` al entrar, 160 ms `ease-in` al salir, con
  `transform`.
- Cambio de bandeja: la lista no anima; muestra esqueleto si tarda más de 100 ms.

### 4.10 Bloque CSS listo para usar

Va en `frontend/src/index.css` reemplazando el bloque `@theme` de marca y superficies
(`index.css:10-55`). Las burbujas, `flow-*` y `--radius-bubble` siguen como están. El puente del
final permite que todo lo que hoy usa `wa-*` tome el aspecto nuevo sin tocar ningún `.tsx`.

```css
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

/* ============================================================
   1. Primitivos de marca. Los pisa applyBrand() (shared/branding.ts)
      y el script en línea de index.html con el color del negocio.
   ============================================================ */
:root {
  --brand: #00a884;
  --brand-strong: #008069; /* >= 4,5:1 contra blanco: lo garantiza brandShades() */
  --brand-deep: #006e5b;
}

/* ============================================================
   2. Semánticos. Cambian con el tema: un componente se escribe
      una sola vez, sin `dark:`.
   ============================================================ */
:root {
  --canvas: #f6f7f9;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --subtle: #f2f4f6;
  --selected: #e9ecef;
  --line: #e4e7eb;
  --line-control: #8a949e; /* 3,1:1: bordes de controles (WCAG 1.4.11) */

  --fg: #111b21;
  --fg-muted: #5b6670; /* 5,9:1 sobre surface, 5,3:1 sobre subtle */
  --fg-disabled: #9aa3ab;

  --accent: var(--brand); /* decorativo: punto, icono activo */
  --accent-strong: var(--brand-strong); /* texto de acento y enlaces */
  --accent-fill: var(--brand-strong); /* relleno de acción */
  --accent-soft: color-mix(in srgb, var(--brand) 10%, #ffffff);
  --accent-deep: var(--brand-deep); /* texto sobre accent-soft */
  --on-accent: #ffffff;
  --ring: var(--brand-strong);

  --danger: #dc2626;
  --danger-fg: #b42318;
  --danger-soft: #fdecea;
  --warning: #b45309;
  --warning-fg: #92400e;
  --warning-soft: #fef3e2;
  --success: #15803d;
  --success-fg: #166534;
  --success-soft: #e7f6ec;
  --info: #1d64d8;
  --info-fg: #1e4fae;
  --info-soft: #e8f0fd;

  --elev-popover: 0 1px 2px rgb(16 24 40 / 0.06), 0 6px 16px rgb(16 24 40 / 0.08);
  --elev-overlay: 0 12px 32px rgb(16 24 40 / 0.16);
  --scrim: rgb(11 20 26 / 0.45);
}

.dark {
  --canvas: #0b1014;
  --surface: #11181d;
  --surface-raised: #182127;
  --subtle: #1a232a;
  --selected: #233039;
  --line: #24303a;
  --line-control: #66727c; /* 3,6:1 sobre surface */

  --fg: #e9edef;
  --fg-muted: #9aa6ae; /* 7,2:1 */
  --fg-disabled: #5f6b73;

  --accent: var(--brand);
  --accent-strong: var(--brand); /* 5,9:1 sobre surface con el verde por defecto */
  --accent-fill: var(--brand);
  --accent-soft: color-mix(in srgb, var(--brand) 16%, transparent);
  --accent-deep: var(--brand);
  --on-accent: #0b141a;
  --ring: var(--brand);

  --danger: #f07167;
  --danger-fg: #f07167;
  --danger-soft: color-mix(in srgb, #f07167 14%, transparent);
  --warning: #e5a43a;
  --warning-fg: #e5a43a;
  --warning-soft: color-mix(in srgb, #e5a43a 14%, transparent);
  --success: #4cc38a;
  --success-fg: #4cc38a;
  --success-soft: color-mix(in srgb, #4cc38a 14%, transparent);
  --info: #6aa8f5;
  --info-fg: #6aa8f5;
  --info-soft: color-mix(in srgb, #6aa8f5 14%, transparent);

  --elev-popover: 0 0 0 1px var(--line);
  --elev-overlay: 0 0 0 1px var(--line), 0 16px 40px rgb(0 0 0 / 0.5);
  --scrim: rgb(0 0 0 / 0.6);
}

/* ============================================================
   3. Utilidades. `inline` hace que la clase emita var(--x) tal
      cual, así sigue al tema y a la marca en tiempo de ejecución.
      bg-surface, text-fg, text-fg-muted, border-line,
      border-line-control, bg-accent-fill, text-on-accent,
      ring-ring, bg-danger-soft, text-danger-fg, shadow-popover...
   ============================================================ */
@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-subtle: var(--subtle);
  --color-selected: var(--selected);
  --color-line: var(--line);
  --color-line-control: var(--line-control);

  --color-fg: var(--fg);
  --color-fg-muted: var(--fg-muted);
  --color-fg-disabled: var(--fg-disabled);

  --color-accent: var(--accent);
  --color-accent-strong: var(--accent-strong);
  --color-accent-fill: var(--accent-fill);
  --color-accent-soft: var(--accent-soft);
  --color-accent-deep: var(--accent-deep);
  --color-on-accent: var(--on-accent);
  --color-ring: var(--ring);

  --color-danger: var(--danger);
  --color-danger-fg: var(--danger-fg);
  --color-danger-soft: var(--danger-soft);
  --color-warning: var(--warning);
  --color-warning-fg: var(--warning-fg);
  --color-warning-soft: var(--warning-soft);
  --color-success: var(--success);
  --color-success-fg: var(--success-fg);
  --color-success-soft: var(--success-soft);
  --color-info: var(--info);
  --color-info-fg: var(--info-fg);
  --color-info-soft: var(--info-soft);

  --shadow-popover: var(--elev-popover);
  --shadow-overlay: var(--elev-overlay);
  --color-scrim: var(--scrim);
}

@theme {
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  /* 15 px: nombre en la lista de chats y títulos de tarjeta. */
  --text-md: 0.9375rem;
  --text-md--line-height: 1.375rem;
}

/* ============================================================
   4. Puente temporal wa-* -> semánticos. Las ~3.700 clases wa-*
      existentes toman el aspecto nuevo sin tocar componentes.
      Ambas variantes (x y x-dark) apuntan al mismo semántico,
      que ya cambia solo con el tema. Se borra en la fase 8.
      wa-field queda en `subtle` (no en surface) hasta que Input
      tenga borde: si no, los campos serían blanco sobre blanco.
   ============================================================ */
@theme inline {
  --color-wa-primary: var(--accent);
  --color-wa-primary-strong: var(--accent-strong);
  --color-wa-primary-deep: var(--accent-deep);

  --color-wa-panel: var(--surface);
  --color-wa-panel-dark: var(--surface);
  --color-wa-app: var(--canvas);
  --color-wa-app-dark: var(--canvas);
  --color-wa-head: var(--surface);
  --color-wa-head-dark: var(--surface-raised);
  --color-wa-field: var(--subtle);
  --color-wa-field-dark: var(--subtle);
  --color-wa-hover: var(--subtle);
  --color-wa-hover-dark: var(--subtle);
  --color-wa-active: var(--selected);
  --color-wa-active-dark: var(--selected);
  --color-wa-border: var(--line);
  --color-wa-border-dark: var(--line);

  --color-wa-text: var(--fg);
  --color-wa-text-dark: var(--fg);
  --color-wa-muted: var(--fg-muted);
  --color-wa-muted-dark: var(--fg-muted);
}

/* Fondos del documento con tokens, no con hex (antes index.css:228-271). */
body { background: var(--surface); }
#root { background: var(--canvas); }
```

Notas del bloque:

- `color-mix()` y `@theme inline` están soportados en los navegadores que ya exige Tailwind 4
  (Safari 16.4+, Chrome 111+).
- `body` pasa del verde `#008069` a `surface`: con la barra superior blanca, la barra de Safari 26
  (que toma el color del `body`, `index.css:224-228`) queda blanca también. Depende de la pregunta
  abierta 2; si se mantiene la barra de color, `body` usa `var(--accent-strong)`.
- `wa-faint`, `wa-faint-strong`, `wa-accent`, burbujas y `flow-*` no entran al puente en esta fase:
  los usan el hilo y el editor de flujos, que se migran aparte.

---

## 5. Componentes base

Todos en `frontend/src/shared/ui/`, con CVA y `cn`, una historia en Storybook por variante y estado,
y revisión con `@storybook/addon-a11y`. Ninguno importa de `features/` (lo exige `architecture.test.ts`).

### 5.1 Navegación lateral (`app/Sidebar.tsx`, renombrado a riel)

```
 Expandido (>= 1600 px o fijado)        Compacto (< 1600 px)
 +------------------------------+       +--------+
 | [logo] DermicaPro        v   |       | [logo] |
 |------------------------------|       |--------|
 |  (o) Chats              12   |       |  (o)12 |   <- contador en el icono
 |  [] Embudo                   |       |  []    |
 |  @  Contactos                |       |  @     |
 |  [v] Tareas               3  |       |  [v] 3 |
 |  ~  Dashboard                |       |  ~     |
 |                              |       |        |
 |  HERRAMIENTAS                |       |  ----  |
 |  >> Automatizaciones         |       |  >>    |
 |  [] Plantillas               |       |  []    |
 |                              |       |        |
 |  (bell) Notificaciones       |       | (bell) |
 |  (?)  Ayuda y reportes       |       |  (?)   |
 |  (*)  Configuración          |       |  (*)   |
 |  [AV] Ana Torres  · Vendedora|       |  [AV]  |
 |  <<  Contraer                |       |  >>    |
 +------------------------------+       +--------+
```

- `<nav aria-label="Vista principal">` (nombre que buscan los e2e) con `NavLink`: `<a>` real y
  `aria-current="page"`.
- Ítem: 40 px de alto (44 en táctil), icono 20 px, etiqueta 14 px. Reposo `text-fg-muted`; hover
  `text-fg` + `bg-subtle`; **activo `text-accent-strong` + `font-semibold`, sin fondo**; foco
  `ring-2 ring-ring`.
- Contador: 12 px, `bg-accent-fill text-on-accent`, el mismo en riel y en barra inferior.
- Compacto: 64 px, icono con `aria-label` y tooltip; el botón "Expandir" es la salida para quien no
  reconoce un icono. Preferencia guardada por usuario (`localStorage`, solo conveniencia).
- Arriba: logo y nombre del negocio (sustituye la barra superior en escritorio, gana 56 px de alto).
- Abajo, siempre en el mismo sitio: notificaciones, "Ayuda y reportes" (WCAG 3.2.6), configuración
  y el menú de cuenta (seguridad, tema, cerrar sesión).
- Reordenamiento de entradas en §7.1.

### 5.2 Panel de filtros con contadores (`FilterPanel`, `FilterSection`, `FilterItem`)

```
 +---------------------------------+
 | Conversaciones               << |   <- h2 16/600 y botón plegar columna
 |                                 |
 | (inbox) Sin asignar          4  |
 | (user)  Mías                12  |
 | (users) Todas               46  |   <- seleccionado: bg-selected, rounded-lg, 600
 |---------------------------------|
 | Atención                     ^  |   <- FilterSection plegable (button aria-expanded)
 | (dot)   No leídos            9  |
 | (clock) Esperando respuesta  7  |
 | (alarm) Más de 1 h           2  |
 | (moon)  Sin actividad 7 días 15 |
 | (zap)   Sin automatizaciones 3  |
 |---------------------------------|
 | Etapas                       v  |
 |   . Nuevo                   18  |   <- punto del color de la etapa
 |   . Interesado              11  |
 |   . Cita separada            6  |
 |---------------------------------|
 | Etiquetas                    v  |
 | Mis vistas                   v  |
 |   + Guardar vista actual        |
 +---------------------------------+
```

- Genérico: recibe secciones e ítems por props (id, etiqueta, icono, contador, color opcional). La
  composición con datos de chats vive en `features/chats/components/inbox/`.
- Ítem: `<button aria-pressed>` dentro de una lista; 40 px; icono 16 px `text-fg-muted`; etiqueta
  14 px `text-fg`; contador 12 px `text-fg-muted tabular-nums` alineado a la derecha.
  Seleccionado: `bg-selected font-semibold`. Si el contador todavía carga, esqueleto de 16 px (no "0").
- Sección: título 12 px semibold `text-fg-muted`, chevron, `aria-expanded`, estado plegado recordado.
- Teclado: Tab entra al panel; flechas arriba/abajo recorren ítems (roving tabindex); Enter aplica.

### 5.3 Ítem de lista / conversación (`ListItem` + `Avatar` en shared; `ChatItem` en la feature)

```
 +--------------------------------------------------------------+
 | [ ]  ( JP )  Josefina Paredes                     . 10:42    |  <- no leído: punto accent, nombre 600, hora accent-strong
 |              Claro, te paso los precios de la...      (3)    |  <- vista previa 14 fg-muted; contador
 |              . Interesada  ·  Ana  ·  [. Botox] [. Facial]    |  <- 12 px: etapa, vendedora, 2 etiquetas
 +--------------------------------------------------------------+
   ^ casilla solo en modo selección o al pasar el mouse
```

- 72 px de alto con dos líneas; 88 px con la línea de metadatos (opcional por preferencia de densidad).
- Avatar 44 px redondo, iniciales 14 px semibold.
- Leído: nombre 500, hora `text-fg-muted`, sin punto.
- Estados de espera (los `TIER_*` actuales): la hora toma `warning` o `danger` **con icono de reloj**,
  no solo color.
- Iconos de estado al final de la vista previa (automatización pausada, ventana 24 h cerrada) con
  `aria-label`, como hoy.
- Hover `bg-subtle`; seleccionado `bg-selected` dentro de `mx-2 rounded-lg` (la pastilla de la
  referencia); foco `ring-2 ring-inset ring-ring`.
- Menú contextual con Radix (§5.11), abierto también con la tecla de menú y con un botón "Más" que
  aparece al foco o hover.
- Etiquetas: chip neutro `bg-subtle text-fg` 12 px con un punto de `tag.color` (resuelve el
  contraste del §3.2.9).

### 5.4 Botones (`Button`)

| Variante | Reposo | Hover | Presionado | Uso |
|---|---|---|---|---|
| `primary` | `bg-accent-fill text-on-accent` | 8 % más oscuro (`color-mix`) | 14 % más oscuro | Una por vista |
| `secondary` | `bg-surface border border-line-control text-fg` | `bg-subtle` | `bg-selected` | Acciones de igual rango |
| `ghost` | `text-fg-muted` | `bg-subtle text-fg` | `bg-selected` | Barras de herramientas |
| `link` | `text-accent-strong underline-offset-2` | subrayado | — | Acciones en línea |
| `danger` | `bg-danger text-white` | más oscuro | — | Destructivo confirmado |
| `danger-ghost` | `text-danger-fg` | `bg-danger-soft` | — | "Eliminar" en menús |

Tamaños: `sm` 32 px (escritorio denso), `md` 40 px (por defecto), `lg` 44 px (móvil y CTA),
`icon` 40 × 40 (44 en táctil). Sin `shadow-sm` (hoy en `Button.tsx:11-14`). Estado `loading`:
`Spinner` en lugar del icono, ancho fijo, `aria-busy`. Foco `ring-2 ring-ring ring-offset-2 ring-offset-surface`.

### 5.5 Campos (`Input`, `Textarea`, `Select`, nuevo `Field`)

- Campo: `bg-surface border border-line-control rounded-lg h-10 px-3 text-sm`, placeholder
  `text-fg-muted`. Foco: borde `accent-strong` + `ring-2 ring-ring/25`. Error: borde `danger`,
  mensaje debajo.
- La búsqueda conserva la píldora (`rounded-full bg-subtle`, sin borde): es un patrón universal de
  WhatsApp y la lupa la identifica.
- `Field`: `<label>` 14 px 500 arriba, ayuda 12 px `text-fg-muted`, error 12 px `text-danger-fg`
  con icono y `role="alert"`, todo conectado por `aria-describedby`. Compatible con
  `react-hook-form` (`register` o `Controller`). Validación al salir del campo.
- La regla de 16 px en móvil (`index.css:277-283`) se conserva.

### 5.6 Tablas (`DataTable`, sobre `@tanstack/react-table` ya instalado)

- Cabecera 12 px semibold `text-fg-muted`, sin mayúsculas forzadas, fija al desplazar; fondo `surface`
  con línea inferior.
- Filas de 52 px, separadas por `line`, sin cebra. Hover `bg-subtle`. Seleccionada `bg-selected`.
- Números a la derecha con `tabular-nums`; texto a la izquierda; la primera columna lleva el nombre
  como enlace.
- Columna de selección con `Checkbox`; barra de acciones masivas que reemplaza la cabecera mientras
  hay selección ("3 seleccionados · Mover de etapa · Agregar etiqueta · Cancelar").
- Acciones de fila: botón "Más" siempre presente (no solo al hover: en táctil no hay hover).
- Por debajo de 768 px la tabla se convierte en lista (`ListItem`), no en scroll horizontal.
- Más de 200 filas: virtualización con `@tanstack/react-virtual`.

### 5.7 Tarjetas (`Card`, `StatCard`)

- `Card`: `bg-surface border border-line rounded-xl p-5`, sin sombra. Variante `interactive`
  (hover `border-line-control`, foco con anillo). Cabecera opcional: título 16/600, descripción 14
  `fg-muted`, acciones a la derecha.
- `StatCard` (dashboard): etiqueta 12 px `fg-muted`, cifra 24/600 `tabular-nums`, variación con
  icono y signo (no solo color), pista 12 px. Reemplaza `dashboard/components/primitives.tsx:19-50`.

### 5.8 Modales y hojas (`Modal`, `Sheet`)

- `Modal` existente pasa a ser el único armazón: `bg-surface-raised rounded-xl shadow-overlay`,
  velo `bg-scrim`, padding 24, título 16/600, cierre de 40 px con `aria-label="Cerrar"`, pie con
  botones a la derecha (principal último). Los 25 diálogos que usan las clases de `Dialog.tsx`
  migran a `Modal` feature por feature.
- `Sheet` (nuevo, mismo Radix Dialog): lateral derecho de 380 px para la ficha del lead por debajo
  de 1440 px, e inferior en móvil (`rounded-t-2xl`, asa, `pb-safe`). Foco atrapado, `Esc` cierra,
  el foco vuelve al disparador.
- Sin modales anidados: una pregunta encima de un modal usa la capa `confirm` que ya existe.

### 5.9 Badges y contadores (`Badge`, `Counter`)

- `Badge` (etiqueta de estado): 12 px 500, `h-6 px-2 rounded-md`, siempre con icono o texto.
  Tonos: `neutral` (`bg-subtle text-fg`), `accent` (`bg-accent-soft text-accent-deep`), `danger`,
  `warning`, `success`, `info` (fondo `-soft`, texto `-fg`).
- `Counter` (número): 12 px 600 `tabular-nums`, `min-w-5 h-5 rounded-full px-1.5`,
  `bg-accent-fill text-on-accent` o `neutral`. "99+" a partir de 100.
- `Dot`: 8 px `bg-accent` con texto oculto para lectores ("no leído").

### 5.10 Encabezado de página (`PageHeader`)

```
 +--------------------------------------------------------------------------+
 | Contactos                                    [Importar CSV] [+ Nuevo]    |  h1 20/600
 | Agenda del negocio: personas con o sin conversación.                     |  14 fg-muted, opcional
 |--------------------------------------------------------------------------|
 | (Q Buscar por nombre o teléfono)   [Etapa v] [Etiqueta v]   128 contactos |  barra de filtros
 +--------------------------------------------------------------------------+
```

Un solo `<h1>` por vista; un botón `primary` como máximo; el resto `secondary`. En móvil la
descripción se oculta y las acciones secundarias pasan a "Más".

### 5.11 Menús, popovers y pestañas

- Menú contextual y de "Más": Radix Dropdown Menu. **No está instalado**
  (`package.json` solo trae alert-dialog, checkbox, dialog, select, slot y tooltip): requiere
  aprobación (pregunta abierta 5). Sin él, los menús siguen a mano y el `ChatItem` no baja de 400 líneas.
- Popover (filtros avanzados, selector de etapa): Radix Popover, misma condición.
- Pestañas (ficha / copiloto, configuración): componente `Tabs` con roving tabindex. Puede hacerse
  sin dependencia nueva, como `LeadPanelTabs.tsx`, o con Radix Tabs.
- Estilo de pestaña único: texto 14 px, activo `text-fg font-semibold` con subrayado de 2 px
  `accent` (forma además de color); sustituye las pestañas de relleno verde (`SettingsDialog.tsx:24`).

### 5.12 Estados vacío, carga y error

| Estado | Componente | Contenido |
|---|---|---|
| Vacío (primera vez) | `EmptyState` | Icono 40 px `fg-muted`, título 16/600, explicación 14 px, **una acción de salida** ("Conecta tu WhatsApp", "Importar contactos") |
| Vacío (por filtro) | `EmptyState` compacto | "No hay chats en Más de 1 h. Buen trabajo." + "Ver todas" |
| Cargando | `Skeleton` con la forma real | Filas con círculo de 44 px y dos líneas; reserva el alto (CLS) |
| Carga larga (> 1 s) | `Spinner` + texto | "Cargando conversaciones..." |
| Error | `ErrorState` (nuevo) | Qué pasó, por qué si se sabe, botón "Reintentar"; `role="alert"`; icono, no solo rojo |
| Sin conexión en vivo | Banda `warning-soft` | Se conserva la de `ChatList.tsx:724-736`, con tokens |

---

## 6. Pantalla de chats

### 6.1 Qué existe de verdad (verificado en el código)

| Dato | Dónde | Sirve para |
|---|---|---|
| Vendedora asignada `vendedor_id`, `vendedor` | `features/leads/types.ts` (`Chat`) | Bandejas "Mías", "Sin asignar", carga por vendedora |
| Filtro rápido `all` / `unread` / `mine` | `features/chats/layoutContext.ts:4` | Base de las bandejas |
| Filtros avanzados: etapas, etiquetas (any/all), servicio, vendedora, origen, último emisor, días inactivo, tiempo de espera, automatización pausada | `ChatFilters`, `features/leads/types.ts:57-69`; parámetros en `leads/api.ts` `filterParams` | Secciones del panel y popover avanzado |
| Vistas predefinidas (esperando, más de 1 h, 7 días, sin automatizaciones) y vistas propias | `features/chats/domain/savedViews.ts:19-24` | Sección "Atención" y "Mis vistas" |
| Estado de la conversación `conversacion_abierta` | `Chat`; se cambia en `ChatThread.tsx:119-127` | Selector "Abiertas / Cerradas" |
| Etapas con color y tipo; contadores por etapa | `LeadStageDefinition`; `fetchKanbanSnapshot` devuelve `counts` | Sección "Etapas" |
| Etiquetas con color | `features/catalogs` | Sección "Etiquetas" |
| Acciones masivas | `bulkMoveStage`, `bulkAssignTag` en `features/leads/api.ts:74,83` | Casilla de selección múltiple |
| Contador global de no leídos | `GET /api/chats/unread-count` | Riel y barra inferior |
| Canales | Solo WhatsApp | No hay sección de canales |
| Ficha del lead con pestañas "Ficha" y "Copiloto IA" | `LeadPanelTabs.tsx:6-8` | Quinta columna |

**Lo que falta en el backend** (cada punto es un PR de contrato separado, con `schema.d.ts` regenerado):

1. `GET /api/chats/counts`: contadores de cada bandeja y vista con los mismos filtros que
   `filterParams`, en una sola consulta (`COUNT(*) FILTER (WHERE ...)`), invalidada por el tiempo real.
   Sin esto, el panel muestra contadores solo donde ya existen (no leídos, etapas) y oculta el resto
   en lugar de inventar un "0".
2. Filtro "sin asignar" (`seller_id=none`): hoy `sellerId: null` significa "cualquiera".
3. Filtro por estado de conversación (`conversation=open|closed`).
4. Orden (`order=recent|waiting`): hoy la lista solo ordena por último mensaje.
5. Asignación masiva de vendedora (no existe `bulkAssignSeller`).

### 6.2 Columnas y puntos de quiebre

| Ancho | Riel | Bandejas | Lista | Hilo | Ficha |
|---|---|---|---|---|---|
| >= 1600 | 208 (con etiquetas) | 232 | 340 | flexible (>= 560) | 360 en línea |
| 1440 - 1599 | 64 | 224 | 320 | flexible (>= 500) | 340 en línea |
| 1280 - 1439 | 64 | plegada: selector en la cabecera de la lista | 320 | flexible | 340 en línea |
| 1024 - 1279 | 64 | plegada | 320 | flexible | `Sheet` lateral |
| 768 - 1023 | 64 | plegada | 300 | flexible | `Sheet` lateral |
| < 768 | barra inferior | hoja inferior | pantalla completa | pantalla completa | pantalla completa |

- A 1440 × 900 (el proyecto de escritorio de los e2e) caben riel, bandejas, lista, hilo y ficha:
  64 + 224 + 320 + 340 = 948, quedan 492 px para el hilo. Es el mínimo aceptable (WhatsApp Web se
  usa bien a ese ancho); si las vendedoras lo sienten estrecho, la bandeja se pliega con `<<` y la
  preferencia se recuerda (pregunta abierta 4).
- Columnas separadas por `border-line` de 1 px, sin `gap`, sin relleno exterior, sin tarjetas.
- Nada se anima en ancho al plegar (§4.9).

### 6.3 Escritorio, 1440 px

```
+------+--------------------------+-------------------------------+-------------------------------------------+---------------------------+
| [DP] | Conversaciones        << | [ ] Abiertas 46 v    (Y) (=v) | (JP) Josefina Paredes          [Cita] [..] | Ficha   Copiloto IA       |
|      |                          | (Q Buscar nombre, tel. o msj) |      . Interesada v  ·  Ana v  · 24 h ok   | ------                    |
| (o)12| (in) Sin asignar       4 |-------------------------------|-------------------------------------------| Josefina Paredes          |
|      | (u)  Mías             12 | (JP) Josefina Paredes . 10:42 |                 -- Hoy --                 | +51 987 654 321           |
| []   |[(uu) Todas           46]|      Claro, te paso los... (3)|                                           |                           |
|      |--------------------------|      . Interesada · Ana       |  +------------------------+               | Etapa      . Interesada v |
| @    | Atención               ^ |-------------------------------|  | Hola, quería saber el  |               | Vendedora  Ana v          |
|      | (.) No leídos          9 | (MR) María Ruiz         1 d   |  | precio del botox       |               | Servicio   Botox          |
| [v] 3| (c) Esperando resp.    7 |      Gracias, lo pienso       |  +------------------ 10:40               | Origen     Anuncio CTWA   |
|      | (!) Más de 1 h         2 |      . Nuevo · Sin asignar    |               +--------------------------+| Etiquetas  [. Botox] [+]  |
| ~    | (z) Sin actividad 7 d 15 |-------------------------------|               | Claro, te paso los precios| |                           |
|      | (p) Sin automatiz.     3 | (CL) Carla León        1 d    |               +----------------- 10:42 vv | Próxima cita              |
|------|--------------------------|      Audio 0:42               |                                           |  Sin cita  [Separar cita] |
| >>   | Etapas                 v | ...                           |-------------------------------------------|                           |
| []   | Etiquetas              v |                               | (+) (:)  Escribe un mensaje         (mic) | Actividad               v |
|      | Mis vistas             v |                               |                                           |                           |
| (?)  |                          |                               |                                           |                           |
| (*)  |                          |                               |                                           |                           |
| [AV] |                          |                               |                                           |                           |
+------+--------------------------+-------------------------------+-------------------------------------------+---------------------------+
```

- **Cabecera de la lista**: casilla "seleccionar todo lo visible", selector de estado
  (`Abiertas 46` / `Cerradas` / `Todas`, como el "Open 46" de la referencia), botón de filtros
  avanzados (popover con etiquetas reales y un contador de filtros activos) y orden.
  El `<h1>Conversaciones</h1>` se mantiene (lo buscan los e2e); en escritorio pasa a ser el título
  de la columna de bandejas, y cuando esa columna está plegada vuelve a la cabecera de la lista.
- **Modo selección**: al marcar una casilla, la cabecera se reemplaza por
  `3 seleccionados · Mover de etapa · Agregar etiqueta · Cancelar` (y `Asignar` cuando exista el endpoint).
  Las vistas rápidas en chips (`ChatViewChips`) desaparecen en escritorio: ahora son la sección "Atención".
- **Cabecera del hilo**: avatar, nombre (16/600), etapa como selector en línea y vendedora como
  selector en línea (una vendedora mueve la etapa sin ir a la ficha), estado de la ventana de 24 h
  como texto corto. Acciones: "Separar cita" con texto; llamar, iniciar flujo, buscar en el chat,
  pausar automatizaciones y "Cerrar conversación" en un menú "Más" con texto (hoy son iconos sueltos).
- **Ficha**: pestañas "Ficha" y "Copiloto IA" (las de hoy), secciones con título 12 px y pares
  etiqueta/valor editables en el lugar. Etapa y vendedora aparecen aquí también (la cabecera es el
  atajo).
- **Hilo**: sin cambios de fondo, burbujas ni colita (fase 5 solo cambia el marco).

### 6.4 Escritorio, 1280 px (bandejas plegadas)

```
+------+-------------------------------------+------------------------------------+---------------------------+
| [DP] | Conversaciones                   >> | (JP) Josefina Paredes    [Cita][..]| Ficha   Copiloto IA       |
|      | [Todas 46 v]  [ ] Abiertas v (Y)(=) |                                    |                           |
| (o)12| (Q Buscar nombre, teléfono o msj)   |                                    |                           |
|      |-------------------------------------|                                    |                           |
| ...  | (JP) Josefina Paredes      . 10:42  |               ...                  |           ...             |
```

`[Todas 46 v]` abre el mismo `FilterPanel` en un popover anclado. `>>` fija la columna.

### 6.5 Móvil (< 768 px, PWA)

```
 Lista                           Hoja "Bandejas"                 Hilo
 +-----------------------------+ +-----------------------------+ +-----------------------------+
 | Conversaciones   (bell) (+) | |            ----             | | <  (JP) Josefina P.   (..)  |
 | [Mías 12 v] [Abiertas v] (Y)| | Conversaciones              | |    Interesada · Ana         |
 | (Q Buscar...              ) | | (in) Sin asignar          4 | |-----------------------------|
 | [Esperando] [Más de 1 h] >  | | (u)  Mías                12 | |          -- Hoy --          |
 |-----------------------------| | (uu) Todas               46 | | +-----------------+         |
 | (JP) Josefina Paredes 10:42 | |-----------------------------| | | Hola, quería... |         |
 |      Claro, te paso... (3)  | | Atención                    | | +---------- 10:40 |         |
 |-----------------------------| | (.) No leídos             9 | |        +------------------+ |
 | (MR) María Ruiz        1 d  | | (c) Esperando respuesta   7 | |        | Claro, te paso...| |
 |      Gracias, lo pienso     | | ...                         | |        +--------- 10:42 vv| |
 |-----------------------------| | Etapas                    v | |                             |
 | ...                         | |                             | | (+) Escribe un mensaje (mic)|
 |-----------------------------| |  [ Ver 12 conversaciones ]  | +-----------------------------+
 | Chats Embudo Tareas Contac. Más |                             |   sin barra inferior (como hoy)
 +-----------------------------+ +-----------------------------+
```

- La barra superior global se reduce a la cabecera de la lista: título, notificaciones y "nuevo lead".
- `[Mías 12 v]` abre la hoja inferior con el mismo `FilterPanel` (Radix Dialog, 75 % de alto, asa,
  `pb-safe`); el botón final confirma y cierra. Los chips de vistas se conservan en móvil (acceso
  con el pulgar sin abrir la hoja).
- Fila de 72 px, objetivo táctil completo; casilla de selección por pulsación larga, siempre con una
  alternativa sin gesto ("Seleccionar" en el menú de la cabecera): la pulsación larga no se descubre.
- Barra inferior: etiquetas a 12 px (hoy 10 px, `MobileNavBar.tsx:181`), contador con el mismo
  componente que el riel, `pb-safe` como hoy. Contenido en la pregunta abierta 7.
- Dentro de un chat no hay barra inferior ni superior global (comportamiento actual, lo comprueban
  los e2e de `abrir-y-volver`).

---

## 7. Otras pantallas (dirección, no detalle)

### 7.1 Navegación reorganizada

| Grupo | Entradas | Cambio |
|---|---|---|
| Principal (todos los roles) | Chats, Embudo (hoy "Kanban"), Contactos, Tareas, Dashboard (admin y analista) | "Kanban" es el mecanismo; "Embudo" es lo que la dueña busca. "Nueva Cita" deja de ser una vista: es la acción "Separar cita" del chat y un botón en Tareas/Agenda |
| Herramientas (admin) | Automatizaciones, Plantillas | "Flujos enviados" pasa a ser una pestaña dentro de Automatizaciones (y, para vendedoras, dentro de Tareas) |
| Configuración (admin) | General, Usuarios, Etapas del embudo, Etiquetas y catálogos, Archivos, Integraciones, Asistente IA | Pasan del riel (6 entradas) a una página con sub-navegación, que reusa `FilterPanel` como menú de secciones |
| Pie del riel | Notificaciones, Ayuda y reportes, Configuración, Cuenta | "Reportes" de errores deja de ser vista principal |

De 14 entradas planas a 5 + 2 + pie. Las rutas no cambian (enlaces y marcadores siguen sirviendo);
solo cambia dónde se muestran.

### 7.2 Configuración como página

```
+------+------------------------+-------------------------------------------------------------+
| riel | Configuración          | Usuarios                                      [+ Invitar]   |
|      |                        | Quién entra al CRM y qué puede ver.                         |
|      | (g) General            |-------------------------------------------------------------|
|      |[(u) Usuarios          ]| Nombre            Rol          Atiende llamadas   Estado    |
|      | (f) Etapas del embudo  | Ana Torres        Vendedora    (on)               Activa  ..|
|      | (t) Etiquetas          | Caro Díaz         Vendedora    (off)              Activa  ..|
|      | (a) Archivos           | ...                                                         |
|      | (p) Integraciones      |                                                             |
|      | (s) Asistente IA       |                                                             |
+------+------------------------+-------------------------------------------------------------+
```

Hoy es un diálogo de 512 px con dos pestañas (`SettingsDialog.tsx`) y el resto está repartido por
el riel. Una página da espacio a tablas, deja enlazar una sección (`/configuracion/usuarios`) y
pone toda la configuración en un solo lugar (pregunta abierta 8).

### 7.3 Contactos, Tareas, Embudo, Dashboard

- **Contactos**: `PageHeader` + barra de filtros + `DataTable` (nombre, teléfono, etapa, vendedora,
  última interacción, etiquetas); en móvil, `ListItem`. Hoy son tarjetas de 64 px de alto apiladas.
- **Tareas**: misma cabecera; grupos "Vencidas / Hoy / Próximas" como secciones de lista, no tarjetas.
- **Embudo**: columnas sin tarjeta exterior, título de etapa 14/600 con punto de color y `Counter`;
  tarjetas de lead `Card` compactas con `Avatar` de 32 px. El arrastre ya tiene alternativa
  (mover desde el menú de la tarjeta): se verifica con teclado (WCAG 2.5.7).
- **Dashboard**: `StatCard` en fila, gráficos en `Card` sin sombra, paleta `--viz-cat-*` única
  (se borra el juego `--color-viz-*` con `-dark`).

---

## 8. Plan de migración

Orden por uso: chats > embudo > tareas > contactos > dashboard > plantillas > automatizaciones >
configuración > autenticación y plataforma. Cada fase deja `npm run lint && npm test && npm run build`
y los e2e en verde. Ninguna fase mezcla traslado de archivos con cambio de contrato (regla del repo).

| Fase | Alcance | PRs | Riesgo principal |
|---|---|---|---|
| 1. Fundaciones | Bloque CSS de §4.10 con el puente `wa-*`; `body`, `#root`, barras de desplazamiento y `.automation-form` con tokens; `branding.ts` + script de `index.html` a `--brand*` con guarda de contraste y tests; historia "Tokens" en Storybook | 1 | Cambio visual global de un golpe; `branding.test.ts` y el color de la barra de Safari |
| 2. `shared/ui` | `Button` (variantes y tamaños), `Field` + `Input`/`Select` con borde, `Badge`/`Counter`/`Dot`, `Avatar`, `Card`/`StatCard`, `ListItem`, `FilterPanel`, `PageHeader`, `EmptyState`/`ErrorState`, `Sheet`, `Tabs`; menús con Radix si se aprueba | 2-3 | Cambios de altura en botones e inputs mueven layouts de pantallas aún no migradas |
| 3. Shell (`app/`) | Riel con enlaces, grupos, etiquetas y cuenta abajo; sin barra superior en escritorio; barra inferior a 12 px; `navigation.ts` reorganizado | 1 | Tests de caracterización y e2e que buscan nombres y roles (abajo) |
| 4a. Backend de bandejas | Contadores, sin asignar, estado de conversación, orden, asignación masiva; `schema.d.ts` regenerado | 1-2 (contrato) | Rendimiento de los contadores con 10 mil leads por tenant |
| 4b. Chats: lista y bandejas | `features/chats/components/inbox/*`; partir `ChatList.tsx` (884) en cabecera, popover de filtros y cuerpo; `ChatItem` con `Avatar` y menú Radix; `ChatWorkspace` en columnas con un hook de layout | 2 | `KNOWN_LARGE_COMPONENTS` y el ancho del hilo a 1440 |
| 5. Chats: hilo y ficha | Cabecera del hilo con selectores en línea y menú "Más"; ficha con secciones; marco del composer; burbujas a variables sin cambiar valores | 1-2 | `MessageFooter.test.tsx` y `AlbumBubble.test.tsx` comprueban `text-wa-faint-strong` |
| 6. Embudo, Tareas, Contactos, Dashboard | `PageHeader`, `DataTable`, `StatCard`; `primitives.tsx` del dashboard a `Card` | 3-4 | `KanbanBoard.tsx` (572) y `TasksPage.tsx` en la lista de grandes |
| 7. Administración | Configuración como página; Plantillas (31 `gray`, 32 `green`, 50 `blue`), Automatizaciones, Archivos, Catálogos, IA, Integraciones, Reportes | 4-6 | El editor de flujos tiene tema propio (`flow-*`): solo se toca su marco |
| 8. Cierre | Login y plataforma; borrar el puente `wa-*` y las clases `dark:` redundantes; test de tokens | 1-2 | Restos de `wa-*` en archivos que nadie tocó |

### 8.1 Riesgos con `frontend/src/test/architecture.test.ts`

- El test compara **igualdad exacta** (`expect(large).toEqual(KNOWN_LARGE_COMPONENTS)`, línea 233):
  si un archivo de la lista baja de 400 líneas, el test falla hasta quitarlo de la lista. Cada PR
  que parta un componente grande tiene que achicar la lista en el mismo commit. Nunca se agrega.
- Ningún archivo nuevo puede pasar de 400 líneas. `ChatWorkspace.tsx` está en 500 y `ChatList.tsx`
  en 884: el layout de columnas y el panel de bandejas van en archivos nuevos
  (`features/chats/hooks/useInboxLayout.ts`, `features/chats/components/inbox/InboxPanel.tsx`), no
  dentro de los existentes.
- Candidatos a salir de la lista con este rediseño: `ChatItem.tsx` (443, menú contextual a Radix),
  `ChatList.tsx` (884, se parte en tres), `ChatWorkspace.tsx` (500, layout a un hook).
- `shared/` no puede importar `features/` ni `app/`: `FilterPanel`, `ListItem`, `Avatar` y
  `PageHeader` reciben todo por props. La composición con etapas y etiquetas vive en `features/chats`.
- El pedido de contadores va en `features/leads/api.ts` (donde ya vive `fetchChatsPage`), con su
  clave en `keys.ts` y respuesta tipada con `ApiResponse<'/api/chats/counts', 'get'>`.
- Capas: `chats` puede importar de `leads` y `catalogs` (capas inferiores), no al revés. El selector
  de etapa en línea de la cabecera del hilo usa lo que `leads` ya publica.

### 8.2 Riesgos con los e2e (`e2e/specs`) y los tests de caracterización

Los e2e buscan por rol y nombre accesible, no por clase: el rediseño es seguro si conserva estos nombres.

| Lo que buscan | Dónde | Cuidado |
|---|---|---|
| `navigation` "Vista principal" | `chat/abrir-y-volver`, `chat/plantillas` | El riel nuevo conserva el nombre; en móvil la barra inferior también. Debe seguir oculta dentro de un chat y entera en pantalla con el teclado abierto |
| `heading` "Conversaciones" | `navegacion/mas`, otros | Un solo h1 con ese texto, visible en escritorio y móvil |
| `button` "Más" y `dialog` "Más vistas" con Automatizaciones, Configuración, Reportar un problema, Modo oscuro, Cerrar sesión | `navegacion/mas` | Si "Reportes" pasa a "Ayuda y reportes", la acción "Reportar un problema" tiene que seguir llamándose así |
| `expectNoPageOverflow`, `expectShellNotShifted` | `navegacion/mas`, `chat/plantillas` | Columnas plegadas con `overflow-hidden` no pueden quedar desplazadas; usar `invisible`/`absolute` como hoy |
| `region` "Mensajes...", "Contactos...", "Llamadas de WhatsApp" | varios | Conservar los `aria-label` de regiones |
| `label` "Escribe un mensaje", botones "Separar cita para este lead", "Iniciar un flujo para este lead", "Volver a la lista de chats" | `chat/*` | Si pasan a un menú "Más", el e2e tiene que abrirlo primero: se actualiza el spec en el mismo PR |
| Escritorio a 1440 × 900 | `playwright.config.ts:32` | Es justo el ancho límite de cinco columnas: validar que el hilo no baje de 480 |

Tests unitarios afectados:

- `app/appShell.characterization.test.tsx:155` comprueba que **no** haya `button` "Dashboard":
  si el riel pasa a enlaces, la aserción negativa pasa siempre aunque el dashboard aparezca. Cambiarla
  a `link` en el mismo PR, junto con `findByRole('button', { name: 'Cerrar sesión' })` (`:169`, `:217`)
  si cerrar sesión entra al menú de cuenta.
- `MessageFooter.test.tsx` y `AlbumBubble.test.tsx` usan `toHaveClass('text-wa-faint-strong')`.
- `branding.test.ts` comprueba el `theme-color` con `#173185`.

### 8.3 Guardas para que no vuelva a degradarse

Propuesta para la fase 8, en el estilo del repo (lista de excepciones que solo se achica):
`frontend/src/test/design-tokens.test.ts` que falle si un `.tsx` de producción nuevo usa
`[#hex]`, `text-[8-11px]` o paletas crudas (`gray-`, `green-`, `violet-`...) fuera de una lista
`KNOWN_RAW_COLORS` congelada al iniciar la fase 1.

No hay pruebas de captura de pantalla. Antes de la fase 1 conviene tomar capturas de referencia de
cuatro pantallas (chats, embudo, contactos, dashboard) en claro y oscuro, escritorio y celular, para
revisar el cambio a ojo; `toHaveScreenshot` en CI es opcional por las diferencias de fuentes entre máquinas.

---

## 9. Cómo se mide

| Dimensión (HEART) | Métrica | Fuente |
|---|---|---|
| Task success | Tiempo hasta la primera respuesta de la vendedora y % de chats con más de 1 h sin responder | Ya se calcula (`waitingTime`, dashboard) |
| Task success | Prueba moderada con 5 vendedoras: "abre los chats sin asignar de más de 1 h y asigna dos a Ana"; tiempo y errores antes/después | Sesión guiada |
| Engagement | Uso de cada bandeja y vista (clics por día) para podar las que nadie usa | Evento simple en el frontend |
| Adoption | % de admins que usan la acción masiva o la bandeja "Sin asignar" en su primera semana | Evento |
| Happiness | SUS a vendedoras y admins antes de la fase 4 y un mes después | Encuesta de 10 preguntas |
| Rendimiento | INP de abrir un chat y cambiar de bandeja <= 200 ms; CLS de la lista <= 0,1 | Web Vitals en producción |
| Densidad | Chats visibles sin desplazar a 1440 × 900 (hoy unos 11 con filas de ~68 px; con 72 px, unos 10) | Captura |

---

## 10. Decisiones del usuario (2026-11-19)

Las preguntas que estaban abiertas, ya respondidas:

| # | Tema | Decisión |
|---|---|---|
| 1 | Visibilidad de la vendedora | Ve solo sus conversaciones y las sin asignar: las bandejas "Todas" y "Equipo" no aparecen para ese rol |
| 2 | Barra del sistema y cabecera | Blanca, igual que la cabecera (en oscuro, el gris de la app). En escritorio ya no hay barra superior (fase 3) |
| 3 | No leídos | Punto + número, como WhatsApp |
| 4 | Entre 1280 y 1599 px | La ficha queda fija desde 1280 px; las bandejas aparecen desde 1440 px y se pliegan con `<<` |
| 5 | Dependencias | Aprobados `@radix-ui/react-dropdown-menu` (ya instalado, 2.1.22), `@radix-ui/react-popover` y `@radix-ui/react-tabs` |
| 6 | Fuente | La del sistema |
| 7 | Barra inferior en móvil | Chats, Tareas, Contactos y Más (Reportes pasa a "Más"; Embudo queda en "Más") |
| 8 | Configuración | Pasa a página con secciones y absorbe Integraciones, Asistente IA, Catálogos y Archivos |
| 9 | Vistas propias | Se guardan en el servidor (PR de contrato aparte) |
| 10 | Backend de bandejas | Aprobados los cuatro: contadores + sin asignar, estado abierta/cerrada, orden por espera y asignación masiva, cada uno en su PR antes de la fase 4b |
