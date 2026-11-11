# CliniVentas — Dirección de arte

Sistema visual de la web de presentación (landing comercial).
Implementación: `src/app/globals.css` · Tailwind CSS v4, configuración CSS-first.

---

## 1. Concepto de marca

**El azul del acuse de lectura.**

CliniVentas vive de una escena concreta: la recepcionista de una clínica con el
teléfono en la mano, esperando a que la paciente responda. En esa escena hay una
señal que todo el mercado latinoamericano ya sabe leer sin que nadie se la
explique: **la doble palomita que se pone azul**. No significa "verde", ni
significa "app de mensajería": significa *del otro lado alguien leyó, alguien
respondió, la cita está en pie*. Ese es el activo emocional que queremos, y es
un activo que WhatsApp no posee — el acuse de lectura es una convención
compartida (iMessage, Telegram, Messenger) y anterior a cualquiera de ellos.

Por eso la marca **se apropia de la confirmación, no del canal**. En los
primeros tres segundos el visitante debe sentir tres cosas en este orden:
*esto es mío* (reconoce burbujas, palomitas, una lista de conversaciones),
*esto es serio* (blancos fríos, tipografía firme, cero saturación de neón,
nada que huela a call center), *esto es una clínica* (limpieza, aire,
cuidado, ningún ruido decorativo). Familiaridad en la **forma**; identidad
propia en el **color**.

**El elemento firma: el hilo.** La página entera es un hilo de conversación
que baja. Cada sección es un mensaje. Su antetítulo no es `01 / 02 / 03`: es
una **marca de tiempo en monoespaciada** (`09:41`) con una doble palomita al
lado que, al pasar el scroll por la sección, cambia de gris (`--tick-idle`) a
azul (`--tick-read`). La numeración decorativa no dice nada; una hora sí:
codifica que una conversación es una secuencia en el tiempo. Es lo único
llamativo de la página. Todo lo demás se calla.

---

## 2. Paleta

### 2.1 El acento: **Verde Salvia `#4F7C6B`**

Un verde apagado con sesgo teal. Matiz ≈ 151°, saturación 0.36, brillo 0.49.

> **Nota de revisión.** La primera versión de este documento proponía un azul
> (`#2450DA`) para evitar cualquier parecido con WhatsApp. El cliente pidió
> explícitamente color verde: el argumento comercial central de la web es la
> familiaridad, y el color hace ese trabajo antes de que se lea una palabra.
> La solución no fue ceder al verde de Meta, sino **tomar el verde real del
> producto**, muestreado píxel a píxel de siete capturas de la app en
> producción. La restricción legal se mantiene intacta y el resultado es
> mejor: la web y el producto se ven como la misma cosa.

**Por qué este verde sí y el de WhatsApp no.** No es una opinión, es medible:

| | Matiz | Saturación | Brillo |
|---|---|---|---|
| WhatsApp `#25D366` | 142° | **0.83** | 0.84 |
| CliniVentas `#4F7C6B` | 151° | **0.36** | 0.49 |

Menos de **la mitad de saturación** y casi 40 puntos menos de brillo. El verde
de Meta es un verde de consumo: neón, ruidoso, de alta croma. El nuestro es un
salvia sobrio, casi eucalipto. Nadie los confunde puestos uno al lado del otro,
y el nuestro comunica mucho mejor lo que pide el sector —limpieza, quietud,
cuidado— que el verde de mensajería.

Siguen prohibidos y sin usar en todo el sistema: `#25D366`, `#128C7E`,
`#075E54`, el logo de WhatsApp y cualquier composición que imite su marca.

**La restricción de contraste que ordena la paleta.** El verde claro de la app,
`#68A387`, da **2.93:1 sobre blanco**: no llega a AA y por tanto **no puede
llevar texto encima ni ser color de texto sobre fondo claro**. Queda reservado
para superficies, bordes, avatares y estados activos, y como acento sobre fondo
oscuro. El botón primario usa `#4F7C6B`, que da **4.74:1 con texto blanco** y
sí cumple AA. Esa diferencia es la que decide qué verde va en cada sitio.

**Dónde vive la familiaridad.** Además del color, en la *forma*: burbujas con
cola asimétrica, palomitas dobles, lista de conversaciones, el crema `#EDEAE3`
de fondo de chat y el patrón de puntos. Son señales de género, no marcas
registradas. Y la palomita de "leído" conserva el azul (`--tick-read`), que es
convención universal de mensajería y no un activo de marca de Meta.

> ⚠️ **PENDIENTE — las tablas de las secciones 2.2, 2.3 y 3 están desactualizadas.**
> Corresponden a la paleta azul superada y todavía citan tokens que ya no
> existen en el código (`aqua`, `aqua-soft`). Los valores reales, ya en verde y
> con ambos modos resueltos, están implementados en `src/app/globals.css`, que
> es la **fuente de verdad**. Consulta ahí y no estas tablas hasta que se
> recalculen los ratios de contraste de la paleta verde.

### 2.2 Modo claro

| Rol | Token | Hex | Uso |
|---|---|---|---|
| Fondo | `bg` | `#F2F5FA` | Lienzo de la página. Blanco frío, nunca crema. |
| Superficie | `surface` | `#FFFFFF` | Tarjetas, navbar, filas de tabla. |
| Superficie elevada | `surface-raised` | `#FFFFFF` | Modales, popovers, menús. |
| Superficie hundida | `surface-sunken` | `#E7EDF5` | Pozos, bloques de código, burbuja entrante. |
| Texto primario | `text` | `#0C1B2A` | Titulares y cuerpo. Casi negro con sesgo azul. |
| Texto secundario | `text-muted` | `#48596B` | Párrafos de apoyo, descripciones. |
| Texto terciario | `text-subtle` | `#586878` | Pies, etiquetas, metadatos. |
| Texto inverso | `text-inverse` | `#FFFFFF` | Sobre rellenos oscuros. |
| Borde hairline | `border` | `#DCE4EE` | Separadores decorativos. |
| Borde fuerte | `border-strong` | `#C3CFDE` | Contorno de tarjeta, líneas de tabla. |
| Borde de campo | `border-field` | `#7E8EA1` | Inputs. Cumple 3:1 (WCAG 1.4.11). |
| Acento primario | `accent` | `#2450DA` | CTA, enlaces, foco, palomita leída. |
| Acento hover | `accent-hover` | `#1C40B4` | |
| Acento activo | `accent-active` | `#16338F` | Estado `:active` / pulsado. |
| Tinta sobre acento | `accent-contrast` | `#FFFFFF` | Label del botón primario. |
| Acento suave | `accent-soft` | `#E7EDFE` | Fondo de badge, burbuja saliente, resalte. |
| Acento fuerte | `accent-strong` | `#16338F` | Texto sobre `accent-soft`. |
| Aguamarina | `aqua` | `#0AA396` | **Solo gráfico**: iconos, palomitas, ilustración. |
| Aguamarina suave | `aqua-soft` | `#DDF3F0` | Fondo de badge de apoyo. |
| Éxito (texto) | `success` | `#07786F` | |
| Éxito (relleno) | `success-solid` | `#0A7F74` | Con `success-contrast` `#FFFFFF` encima. |
| Éxito suave | `success-soft` | `#DDF3F0` | |
| Aviso (texto) | `warning` | `#A15C08` | |
| Aviso (relleno) | `warning-solid` | `#F0A824` | Con `warning-contrast` `#0C1B2A` encima. |
| Aviso suave | `warning-soft` | `#FCF0DC` | |
| Error (texto) | `danger` | `#C62B3E` | |
| Error (relleno) | `danger-solid` | `#D22B3C` | Con `danger-contrast` `#FFFFFF` encima. |
| Error suave | `danger-soft` | `#FCE6E9` | |
| Palomita enviada | `tick-idle` | `#8697A9` | Gris: entregado, aún sin leer. |
| Palomita leída | `tick-read` | = `accent` | Azul: leído / confirmado. |
| Burbuja entrante | `bubble-in` | = `surface-sunken` | Mensaje del paciente. |
| Burbuja saliente | `bubble-out` | = `accent-soft` | Mensaje de la clínica. |
| Anillo de foco | `ring` | = `accent` | |
| Velo de modal | `overlay` | `rgb(12 27 42 / .45)` | |

### 2.3 Modo oscuro

El fondo **no** es negro puro ni el verde-carbón de las apps de mensajería
(`#0B141A`): es un azul-tinta profundo, coherente con el acento.

| Rol | Token | Hex |
|---|---|---|
| Fondo | `bg` | `#0B1220` |
| Superficie | `surface` | `#131C2B` |
| Superficie elevada | `surface-raised` | `#1B2637` |
| Superficie hundida | `surface-sunken` | `#070D18` |
| Texto primario | `text` | `#E8EEF6` |
| Texto secundario | `text-muted` | `#A3B2C4` |
| Texto terciario | `text-subtle` | `#8494A8` |
| Texto inverso | `text-inverse` | `#08111F` |
| Borde hairline | `border` | `#253145` |
| Borde fuerte | `border-strong` | `#33415A` |
| Borde de campo | `border-field` | `#61748F` |
| Acento primario | `accent` | `#7FA8FF` |
| Acento hover | `accent-hover` | `#9CBCFF` |
| Acento activo | `accent-active` | `#B8D0FF` |
| Tinta sobre acento | `accent-contrast` | `#08111F` |
| Acento suave | `accent-soft` | `#16294A` |
| Acento fuerte | `accent-strong` | `#B8D0FF` |
| Aguamarina | `aqua` | `#2FD4BE` |
| Aguamarina suave | `aqua-soft` | `#0C2E2C` |
| Éxito / relleno | `success` / `success-solid` | `#2FD4BE` |
| Éxito suave | `success-soft` | `#0C2E2C` |
| Aviso / relleno | `warning` / `warning-solid` | `#F5B942` |
| Aviso suave | `warning-soft` | `#33260C` |
| Error / relleno | `danger` / `danger-solid` | `#FF7A85` |
| Error suave | `danger-soft` | `#3A1520` |
| Palomita enviada | `tick-idle` | `#61748F` |
| Burbuja entrante | `bubble-in` | = `surface-raised` |
| Velo de modal | `overlay` | `rgb(4 8 16 / .65)` |

**Decisión: el botón primario se invierte en oscuro.** En claro es relleno
azul con tinta blanca (6.49:1); en oscuro es relleno azul claro con tinta
casi negra (8.06:1). Un azul medio con texto blanco sobre fondo oscuro no
llega a 4.5:1 en su estado *hover* sin volverse gris, y aclarar el hover es
lo que el usuario espera en modo oscuro. El componente **no cambia de
código**: siempre `bg-accent text-accent-contrast`. El token hace el trabajo.

---

## 3. Verificación de contraste (WCAG 2.1)

Calculado con la fórmula oficial de luminancia relativa (sRGB, exponente 2.4)
sobre los valores exactos que están en `globals.css`. Script reproducible al
final de esta sección.

**Umbrales aplicados**
- Texto normal: **4.5:1** (AA, criterio 1.4.3).
- Objetos gráficos y bordes de control de formulario: **3:1** (AA, 1.4.11).
  Marcados como `GRÁFICO`.
- Bordes decorativos y escalones de superficie: sin requisito WCAG; se listan
  como `DECOR` solo para documentar que la jerarquía es perceptible.


## MODO CLARO

| Texto / elemento | Sobre | Ratio | Minimo | WCAG AA |
|---|---|---|---|---|
| texto primario `#0C1B2A` | fondo `#F2F5FA` | **15.94:1** | 4.5:1 | Pasa |
| texto primario `#0C1B2A` | superficie `#FFFFFF` | **17.42:1** | 4.5:1 | Pasa |
| texto primario `#0C1B2A` | superficie elevada `#FFFFFF` | **17.42:1** | 4.5:1 | Pasa |
| texto primario `#0C1B2A` | superficie hundida `#E7EDF5` | **14.79:1** | 4.5:1 | Pasa |
| texto secundario `#48596B` | fondo `#F2F5FA` | **6.59:1** | 4.5:1 | Pasa |
| texto secundario `#48596B` | superficie `#FFFFFF` | **7.20:1** | 4.5:1 | Pasa |
| texto secundario `#48596B` | superficie hundida `#E7EDF5` | **6.11:1** | 4.5:1 | Pasa |
| texto terciario `#586878` | fondo `#F2F5FA` | **5.24:1** | 4.5:1 | Pasa |
| texto terciario `#586878` | superficie `#FFFFFF` | **5.73:1** | 4.5:1 | Pasa |
| texto terciario `#586878` | superficie hundida `#E7EDF5` | **4.86:1** | 4.5:1 | Pasa |
| acento (enlace) `#2450DA` | fondo `#F2F5FA` | **5.94:1** | 4.5:1 | Pasa |
| acento (enlace) `#2450DA` | superficie `#FFFFFF` | **6.49:1** | 4.5:1 | Pasa |
| tinta de boton `#FFFFFF` | acento `#2450DA` | **6.49:1** | 4.5:1 | Pasa |
| tinta de boton `#FFFFFF` | acento hover `#1C40B4` | **8.60:1** | 4.5:1 | Pasa |
| tinta de boton `#FFFFFF` | acento activo `#16338F` | **11.03:1** | 4.5:1 | Pasa |
| acento fuerte `#16338F` | acento suave `#E7EDFE` | **9.42:1** | 4.5:1 | Pasa |
| texto primario `#0C1B2A` | acento suave `#E7EDFE` | **14.88:1** | 4.5:1 | Pasa |
| éxito (texto) `#07786F` | superficie `#FFFFFF` | **5.35:1** | 4.5:1 | Pasa |
| éxito (texto) `#07786F` | éxito suave `#DDF3F0` | **4.62:1** | 4.5:1 | Pasa |
| tinta `#FFFFFF` | éxito solido `#0A7F74` | **4.88:1** | 4.5:1 | Pasa |
| aviso (texto) `#A15C08` | superficie `#FFFFFF` | **5.19:1** | 4.5:1 | Pasa |
| aviso (texto) `#A15C08` | aviso suave `#FCF0DC` | **4.60:1** | 4.5:1 | Pasa |
| tinta oscura `#0C1B2A` | aviso solido `#F0A824` | **8.57:1** | 4.5:1 | Pasa |
| error (texto) `#C62B3E` | superficie `#FFFFFF` | **5.50:1** | 4.5:1 | Pasa |
| error (texto) `#C62B3E` | error suave `#FCE6E9` | **4.62:1** | 4.5:1 | Pasa |
| tinta `#FFFFFF` | error solido `#D22B3C` | **5.06:1** | 4.5:1 | Pasa |
| GRÁFICO aqua (iconos/palomitas) `#0AA396` | superficie `#FFFFFF` | **3.14:1** | 3:1 | Pasa |
| GRÁFICO relleno acento `#2450DA` | fondo `#F2F5FA` | **5.94:1** | 3:1 | Pasa |
| GRÁFICO anillo de foco `#2450DA` | fondo `#F2F5FA` | **5.94:1** | 3:1 | Pasa |
| GRÁFICO anillo de foco `#2450DA` | superficie `#FFFFFF` | **6.49:1** | 3:1 | Pasa |
| GRÁFICO borde de campo `#7E8EA1` | superficie `#FFFFFF` | **3.35:1** | 3:1 | Pasa |
| GRÁFICO borde de campo `#7E8EA1` | fondo `#F2F5FA` | **3.06:1** | 3:1 | Pasa |
| DECOR borde fuerte `#C3CFDE` | superficie `#FFFFFF` | **1.58:1** | 1.2:1 | Pasa |
| DECOR borde hairline `#DCE4EE` | superficie `#FFFFFF` | **1.28:1** | 1.15:1 | Pasa |
| DECOR superficie `#FFFFFF` | fondo `#F2F5FA` | **1.09:1** | 1.05:1 | Pasa |
| DECOR superficie elevada `#FFFFFF` | fondo `#F2F5FA` | **1.09:1** | 1.05:1 | Pasa |

## MODO OSCURO

| Texto / elemento | Sobre | Ratio | Minimo | WCAG AA |
|---|---|---|---|---|
| texto primario `#E8EEF6` | fondo `#0B1220` | **16.04:1** | 4.5:1 | Pasa |
| texto primario `#E8EEF6` | superficie `#131C2B` | **14.64:1** | 4.5:1 | Pasa |
| texto primario `#E8EEF6` | superficie elevada `#1B2637` | **13.05:1** | 4.5:1 | Pasa |
| texto primario `#E8EEF6` | superficie hundida `#070D18` | **16.66:1** | 4.5:1 | Pasa |
| texto secundario `#A3B2C4` | fondo `#0B1220` | **8.67:1** | 4.5:1 | Pasa |
| texto secundario `#A3B2C4` | superficie `#131C2B` | **7.91:1** | 4.5:1 | Pasa |
| texto secundario `#A3B2C4` | superficie hundida `#070D18` | **9.00:1** | 4.5:1 | Pasa |
| texto terciario `#8494A8` | fondo `#0B1220` | **6.05:1** | 4.5:1 | Pasa |
| texto terciario `#8494A8` | superficie `#131C2B` | **5.52:1** | 4.5:1 | Pasa |
| texto terciario `#8494A8` | superficie hundida `#070D18` | **6.28:1** | 4.5:1 | Pasa |
| acento (enlace) `#7FA8FF` | fondo `#0B1220` | **7.98:1** | 4.5:1 | Pasa |
| acento (enlace) `#7FA8FF` | superficie `#131C2B` | **7.28:1** | 4.5:1 | Pasa |
| tinta de boton `#08111F` | acento `#7FA8FF` | **8.06:1** | 4.5:1 | Pasa |
| tinta de boton `#08111F` | acento hover `#9CBCFF` | **9.95:1** | 4.5:1 | Pasa |
| tinta de boton `#08111F` | acento activo `#B8D0FF` | **12.16:1** | 4.5:1 | Pasa |
| acento fuerte `#B8D0FF` | acento suave `#16294A` | **9.31:1** | 4.5:1 | Pasa |
| texto primario `#E8EEF6` | acento suave `#16294A` | **12.41:1** | 4.5:1 | Pasa |
| éxito (texto) `#2FD4BE` | superficie `#131C2B` | **9.18:1** | 4.5:1 | Pasa |
| éxito (texto) `#2FD4BE` | éxito suave `#0C2E2C` | **7.82:1** | 4.5:1 | Pasa |
| tinta `#08111F` | éxito solido `#2FD4BE` | **10.16:1** | 4.5:1 | Pasa |
| aviso (texto) `#F5B942` | superficie `#131C2B` | **9.69:1** | 4.5:1 | Pasa |
| aviso (texto) `#F5B942` | aviso suave `#33260C` | **8.36:1** | 4.5:1 | Pasa |
| tinta oscura `#0C1B2A` | aviso solido `#F5B942` | **9.87:1** | 4.5:1 | Pasa |
| error (texto) `#FF7A85` | superficie `#131C2B` | **6.82:1** | 4.5:1 | Pasa |
| error (texto) `#FF7A85` | error suave `#3A1520` | **6.40:1** | 4.5:1 | Pasa |
| tinta `#08111F` | error solido `#FF7A85` | **7.54:1** | 4.5:1 | Pasa |
| GRÁFICO aqua (iconos/palomitas) `#2FD4BE` | superficie `#131C2B` | **9.18:1** | 3:1 | Pasa |
| GRÁFICO relleno acento `#7FA8FF` | fondo `#0B1220` | **7.98:1** | 3:1 | Pasa |
| GRÁFICO anillo de foco `#7FA8FF` | fondo `#0B1220` | **7.98:1** | 3:1 | Pasa |
| GRÁFICO anillo de foco `#7FA8FF` | superficie `#131C2B` | **7.28:1** | 3:1 | Pasa |
| GRÁFICO borde de campo `#61748F` | superficie `#131C2B` | **3.58:1** | 3:1 | Pasa |
| GRÁFICO borde de campo `#61748F` | fondo `#0B1220` | **3.93:1** | 3:1 | Pasa |
| DECOR borde fuerte `#33415A` | superficie `#131C2B` | **1.66:1** | 1.2:1 | Pasa |
| DECOR borde hairline `#253145` | superficie `#131C2B` | **1.31:1** | 1.15:1 | Pasa |
| DECOR superficie `#131C2B` | fondo `#0B1220` | **1.10:1** | 1.05:1 | Pasa |
| DECOR superficie elevada `#1B2637` | fondo `#0B1220` | **1.23:1** | 1.05:1 | Pasa |

FALLOS TOTALES: 0

**72 pares comprobados, 0 fallos.** Los tres pares más ajustados son
`success` sobre `success-soft` (4.62:1), `warning` sobre `warning-soft`
(4.60:1) y `danger` sobre `danger-soft` (4.62:1): son badges semánticos, y
por eso su texto nunca baja de 13 px con peso 500.

**Dos limitaciones que hay que respetar al construir:**

1. `aqua` `#0AA396` da **3.14:1** sobre blanco. Es válido para iconos,
   palomitas, trazos e ilustración (objetos gráficos, 1.4.11), y para texto
   grande a partir de 24px/700. **No es válido para texto pequeño.** Para
   texto usa `success` `#07786F`.
2. `border` y `border-strong` no llegan a 3:1 a propósito: son separadores
   decorativos. Si un control (input, checkbox, select) se identifica **solo**
   por su borde, ese borde tiene que ser `border-field`, que sí cumple.

<details>
<summary>Script de verificación</summary>

```js
const L = (hex) => {
  const h = hex.replace('#','');
  const [r,g,b] = [0,2,4].map(i => parseInt(h.slice(i,i+2),16)/255)
    .map(c => c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
  return 0.2126*r + 0.7152*g + 0.0722*b;
};
const CR = (a,b) => {
  const [hi,lo] = [L(a),L(b)].sort((x,y)=>y-x);
  return (hi+0.05)/(lo+0.05);
};
CR('#0C1B2A', '#F2F5FA'); // 15.94
```
</details>

---

## 4. Tipografía

Dos familias de Google Fonts, **auto-hospedadas** en `public/fonts/`
(subconjuntos `latin` + `latin-ext`, formato WOFF2, `font-display: swap`).

> Se auto-hospedan y no se enlazan porque el pipeline CSS de Next.js 16 con
> Turbopack **elimina los `@import` externos** de las hojas de estilo: un
> `@import url(fonts.googleapis.com…)` se descarta silenciosamente en el
> build y las fuentes nunca cargarían. Además evita una petición bloqueante a
> un tercero. Peso real: **109 KB** para el par normal en `latin`.

### 4.1 Titulares — **Bricolage Grotesque** (300–800, eje óptico 12–96)

Grotesca contemporánea de aperturas cerradas y formas ligeramente
condensadas. Se eligió por tres motivos concretos:

- **El español ocupa más.** Un titular traducido del inglés crece un 20–25%
  ("Book more appointments" → "Agenda más citas y deja de perder pacientes").
  Un display algo condensado recupera esa longitud sin bajar el cuerpo.
- **Tiene carácter sin ser disfraz.** Frente a Inter, Poppins o Montserrat
  —que hacen que cualquier SaaS parezca el mismo SaaS— Bricolage tiene una
  voz reconocible que sigue siendo legible y profesional a 16 px de distancia.
- **Eje óptico real.** Con `font-optical-sizing: auto` el dibujo se ajusta
  solo: más abierto en cuerpos pequeños, más apretado en el hero. Un titular
  de 72 px y un `h4` de 19 px de la misma familia no pelean.

Diacríticos: cobertura completa de `á é í ó ú ü ñ ¿ ¡` en el subconjunto
`latin`; `latin-ext` cubre nombres propios del resto de Europa.

**Regla de contención:** Bricolage **nunca por debajo de 24 px**, nunca en
párrafos, nunca en etiquetas de interfaz ni en botones. Solo `h1`–`h4` y
cifras destacadas. Su carácter funciona en dosis grandes y espaciadas; en
cuerpo pequeño se vuelve ruido.

### 4.2 Texto e interfaz — **Hanken Grotesk** (300–800 + cursiva)

Neutra-humanista, altura de x generosa, números claros. Es la que hace el
trabajo invisible: párrafos largos, tablas de precios, etiquetas, campos de
formulario, FAQ. Deliberadamente **no es Inter** —el default de todo— pero
comparte su legibilidad a 15 px. Su cursiva real (no oblicua sintética) sirve
para las citas de testimonio.

### 4.3 Utilitaria — **Geist Mono**

Ya viene cargada por `layout.tsx`. Se usa **solo** para las marcas de tiempo
del hilo (`09:41`), los contadores y los datos tabulares. Es la que sostiene
el motivo de conversación: una hora en monoespaciada lee como registro, no
como decoración.

### 4.4 Escala

| Token | Tamaño | Interlineado | Tracking | Peso | Familia | Uso |
|---|---|---|---|---|---|---|
| `text-display-1` | `clamp(2.75rem, 1.6rem + 4.4vw, 4.5rem)` | 1.02 | −0.035em | 700 | display | Titular del hero. Uno por página. |
| `text-display-2` | `clamp(2.25rem, 1.6rem + 2.6vw, 3.25rem)` | 1.06 | −0.03em | 700 | display | Cierre / CTA final. |
| `text-h1` | `clamp(2rem, 1.55rem + 1.9vw, 2.75rem)` | 1.10 | −0.025em | 700 | display | Título de sección. |
| `text-h2` | `clamp(1.625rem, 1.4rem + 1.1vw, 2rem)` | 1.18 | −0.02em | 650 | display | Subsección. |
| `text-h3` | 24 px | 1.30 | −0.015em | 600 | display | Título de tarjeta, plan de precios. |
| `text-h4` | 19 px | 1.35 | −0.01em | 600 | display | Pregunta del FAQ, título de feature. |
| `text-lead` | `clamp(1.0625rem, 1rem + 0.4vw, 1.25rem)` | 1.60 | −0.005em | 400 | sans | Subtítulo del hero, entradilla. |
| `text-body` | 16 px | **1.65** | 0 | 400 | sans | Párrafo por defecto. |
| `text-body-sm` | 15 px | 1.60 | 0 | 400 | sans | Texto de tarjeta, celdas de tabla. |
| `text-caption` | 13 px | 1.50 | +0.005em | 500 | sans | Pies, notas legales, badges. |
| `text-eyebrow` | 12 px | 1.20 | +0.02em | 500 | **mono** | Marca de tiempo del hilo. |
| `text-micro` | 11 px | 1.40 | +0.02em | 600 | sans | Etiqueta de badge, "Más popular". |

**Justificación de las tres decisiones que importan:**

- **Interlineado 1.65 en cuerpo** (no el 1.5 habitual). El español encadena
  palabras largas y menos espacios; con 1.5 el bloque se apelmaza. 1.65 abre
  el párrafo y refuerza la sensación de "clínica limpia".
- **Tracking negativo escalonado** (−0.035em a −0.01em). Bricolage a 72 px se
  desarma si no se aprieta; a 19 px ya no necesita casi nada. El tracking
  baja conforme baja el cuerpo, no es un valor único.
- **Antetítulos en minúscula y en mono, no en versalitas espaciadas.** El
  `EYEBROW TRACKING WIDE UPPERCASE` es la firma de la plantilla SaaS. Aquí el
  antetítulo es una hora (`09:41`) y una hora no se escribe en mayúsculas.

---

## 5. Espaciado, radios, sombras y elevación

### 5.1 Espaciado

Base de **4 px** (`--spacing: 0.25rem`). Toda la escala de Tailwind se deriva
sola: `p-1` = 4 px, `p-2` = 8, `p-3` = 12, `p-4` = 16, `p-6` = 24, `p-8` = 32,
`p-12` = 48, `p-16` = 64.

Ritmo vertical de la landing (tokens propios):

| Token | Valor | Uso |
|---|---|---|
| `py-seccion` / `gap-seccion` | `clamp(4rem, 2rem + 8vw, 7.5rem)` | Aire entre secciones grandes. |
| `py-seccion-sm` / `gap-seccion-sm` | `clamp(2.5rem, 1.5rem + 4vw, 4.5rem)` | Bloques secundarios, footer. |
| `max-w-pagina` | `76rem` | Ancho máximo del contenido. |
| `max-w-lectura` | `68ch` | Columna de párrafo largo. |

Dentro de un componente, el salto siempre es **×2 o ×1.5**, nunca arbitrario:
etiqueta→valor = 4, elementos hermanos = 12, grupos = 24, secciones internas
de tarjeta = 32.

### 5.2 Radios

| Token | Valor | Uso |
|---|---|---|
| `rounded-xs` | 6 px | Badges, chips, foco. |
| `rounded-sm` | 8 px | Inputs pequeños, celdas. |
| `rounded-md` | 12 px | Botones, campos de formulario. |
| `rounded-lg` | 16 px | Tarjetas. |
| `rounded-xl` | 20 px | Tarjetas grandes, paneles. |
| `rounded-2xl` | 28 px | Contenedor del hero, tarjeta de precio destacada. |
| `rounded-3xl` | 36 px | Bloques de imagen a sangre. |
| `rounded-bubble` | 20 px | Tres esquinas de una burbuja. |
| `rounded-bubble-tail` | 6 px | La cuarta esquina: la cola. |
| `rounded-full` | — | Solo avatares y el botón de "escribiendo". |

Nada de esquina viva (0 px): en salud lee como frío hostil. Nada de píldoras
gigantes en tarjetas: lee como infantil.

### 5.3 Sombras y elevación

Las sombras están **teñidas de azul-tinta** (`--shadow-tint: 12 27 42`), no de
negro puro: sobre fondos fríos el negro produce un gris sucio que arruina la
sensación de limpieza. En modo oscuro el token cambia a negro puro y se
multiplica por `--shadow-boost: 4`, porque una sombra teñida sobre fondo
oscuro no se percibe. Mismo token, dos comportamientos.

| Nivel | Token | Uso |
|---|---|---|
| 0 | `shadow-none` | Bloques de contenido plano sobre el fondo. |
| 1 | `shadow-xs` | Badges, chips. |
| 2 | `shadow-sm` | Tarjeta en reposo, navbar al hacer scroll. |
| 3 | `shadow-md` | Tarjeta en hover, plan de precios destacado. |
| 4 | `shadow-lg` | Popover, dropdown, tarjeta flotante del hero. |
| 5 | `shadow-xl` | Modal. Único nivel que va con `overlay`. |
| — | `shadow-bubble` | Las burbujas. Casi imperceptible, solo despega del fondo. |

**En modo claro la elevación se comunica con sombra, no con luminosidad:**
`surface` ya es `#FFFFFF` y no hay nada más claro. Por eso `surface-raised`
tiene el mismo hex que `surface` — lo que los separa es el nivel de sombra y
el `border-strong`. En modo oscuro sí hay escalón de luminosidad
(`#131C2B` → `#1B2637`), que es como funciona la elevación en oscuro.

---

## 6. Lenguaje de componentes

### Botones

Altura 44 px (`h-11`) en desktop, 48 px en móvil — el mínimo cómodo de toque.
`rounded-md` (12 px). Peso 600, `text-body-sm`, sin mayúsculas.

| Variante | Reposo | Hover | Activo | Foco |
|---|---|---|---|---|
| **Primario** | `bg-accent text-accent-contrast shadow-sm` | `bg-accent-hover` + `shadow-md` | `bg-accent-active`, sin sombra | anillo `ring` a 2 px con 2 px de separación |
| **Secundario** | `bg-surface text-text border border-border-strong shadow-xs` | `bg-surface-sunken`, borde `border-field` | `bg-surface-sunken`, sin sombra | igual |
| **Fantasma** | transparente, `text-text-muted` | `bg-surface-sunken text-text` | `bg-surface-sunken` | igual |

Un solo botón primario por pantalla visible. El CTA principal lleva a la
derecha una doble palomita de 14 px en `accent-contrast` al 70% — es el único
adorno que se le permite, y se anima al entrar en viewport.
Estado deshabilitado: `opacity-50`, cursor por defecto, sin cambio de color
(el color deshabilitado propio siempre acaba fallando contraste).

### Tarjetas

`bg-surface rounded-xl border border-border shadow-sm p-6 md:p-8`.
Hover (solo si es clicable): `shadow-md` y `-translate-y-0.5` en 180 ms.
Nunca degradado de fondo. Si una tarjeta necesita destacar, se destaca con
`border-accent` y un badge `bg-accent-soft text-accent-strong` — no con relleno
de color, que rompe el ritmo de la retícula.

### Tabla de precios

Tres columnas en desktop, apiladas en móvil con la destacada **primera**.
La destacada: `rounded-2xl border-2 border-accent shadow-lg`, escalada 1.02, y
un badge `text-micro` `bg-accent text-accent-contrast` montado a caballo del
borde superior. Las otras dos: `rounded-xl border border-border shadow-sm`.

El precio en `text-h1` con `font-display`, la moneda y el `/mes` en
`text-body-sm text-text-subtle`. **Cifras tabulares obligatorias** (ya activo
en `th`/`td` y con `[data-numerico]`): sin ellas las columnas de precio bailan.

Lista de características: palomita simple de 16 px en `text-success` +
`text-body-sm`. Lo que un plan **no** incluye va en `text-text-subtle` con la
palomita sustituida por una raya — nunca una cruz roja, que en salud lee como
alarma.

### Acordeón de FAQ

Filas separadas por `border-b border-border`, sin caja. Pregunta en
`text-h4 font-display`, área de toque completa de 64 px de alto. Indicador: un
`+` que rota 45° hasta `×` en 260 ms con `ease-suave` — no un chevron, que ya
está en todas partes. La respuesta se despliega en `text-body text-text-muted`
con `max-w-lectura`. Solo un panel abierto a la vez. El primero abierto por
defecto, para que se vea que se puede abrir.

### Badges

`text-micro`, `rounded-xs`, `px-2 py-0.5`, peso 600, sin mayúsculas.
Fondo `*-soft` + texto del par que cumple contraste:
`accent-soft`/`accent-strong`, `success-soft`/`success`,
`warning-soft`/`warning`, `danger-soft`/`danger`, `aqua-soft`/`success`.
Nunca badge de relleno sólido salvo el de "Más popular" en precios.

### Campos de formulario

`h-11 rounded-md bg-surface border border-border-field px-3 text-body`.
Etiqueta **siempre visible** encima en `text-caption text-text-muted` — nada
de placeholder-como-etiqueta, que desaparece justo cuando hace falta.
Foco: `border-accent` + anillo `ring` de 2 px, sin `outline: none` a secas.
Error: `border-danger` + mensaje debajo en `text-caption text-danger`, con
texto que dice qué pasó y cómo arreglarlo ("Falta el código de país" y no
"Teléfono inválido").

### Navbar

Fija, 72 px, `vidrio` (translúcida con `backdrop-filter`) sobre contenido en
scroll, `border-b border-border` que aparece solo tras 8 px de scroll.
Logotipo a la izquierda, enlaces al centro en `text-body-sm text-text-muted`,
un botón fantasma y un primario a la derecha. En móvil: hoja inferior a
pantalla completa, no un menú hamburguesa desplegable.

### Footer

`bg-surface-sunken`, `py-seccion-sm`, `border-t border-border`. Cuatro
columnas: producto, sectores (clínicas dentales, estética, spa, veterinaria…),
recursos, legal. Encima de todo, una última burbuja saliente con el CTA — el
hilo termina con un mensaje enviado, no con un muro de enlaces. Debajo, línea
de copyright en `text-caption text-text-subtle`.

---

## 7. El motivo "conversación"

Cuatro recursos. Ni uno más.

### 7.1 Burbujas

Tokens: `burbuja-entrante` / `burbuja-saliente` (utilidades propias). La cola
se sugiere recortando **una** esquina a `rounded-bubble-tail` (6 px) en lugar
de dibujar un triángulo: más limpio, escalable y no imita el pico exacto de
ninguna app concreta.

**Dónde:**
1. **En el hero.** Una conversación real de 4–5 mensajes, con texto que
   vende: la paciente pregunta el precio, el sistema responde, se agenda.
   Es la tesis del producto contada en su propio idioma.
2. **En los testimonios.** El testimonio *es* un mensaje entrante, con avatar,
   nombre de la clínica y hora. Coherente y más creíble que una tarjeta con
   comillas gigantes.

**Dónde no:** jamás como contenedor de contenido de la página. Una feature no
va dentro de una burbuja. Un precio no va dentro de una burbuja. La burbuja
solo contiene **conversación citada**. Máximo dos grupos por página, máximo
5 burbujas por grupo.

### 7.2 Palomitas dobles

Un SVG de dos trazos, 14–16 px, `stroke-linecap: round`. Dos estados:
`text-tick-idle` (gris, entregado) y `text-tick-read` (azul, leído).

**Dónde:** al final de cada burbuja saliente; junto a la hora de cada sección
en el hilo; en el CTA primario; en la lista de características de precios (ahí
en `text-success`, palomita simple).

**El límite:** la palomita solo aparece donde significa *confirmado / leído /
incluido*. En el momento en que se usa como viñeta genérica de lista, deja de
ser una señal y pasa a ser una decoración — y ahí es donde la página se
vuelve caricatura. Si la lista no es de cosas confirmadas, la viñeta es un
punto.

### 7.3 Patrón de fondo

Utilidad `patron-conversacion`: retícula de puntos de 1 px cada 22 px, al
**9% de opacidad** del acento. Es el equivalente funcional del fondo con
garabatos de las apps de mensajería (dar textura al lienzo del chat) en un
lenguaje que es nuestro: geométrico, sobrio, clínico.

Reglas duras: **máximo dos secciones por página**; nunca sube del 9%; y
**siempre** combinado con `patron-desvanecido`, que lo enmascara hacia los
bordes. Un patrón que llega a tocar el borde de la sección se lee como
"fondo de plantilla".

### 7.4 "Escribiendo…"

Tres puntos con `animate-escribiendo` (desfase de 0.15 s entre ellos) dentro
de una `burbuja-entrante` estrecha. **Una sola instancia en toda la página**,
en el hero, y solo mientras dura la secuencia de entrada de la conversación.
Un indicador de "escribiendo" permanente es ruido; dos a la vez es un circo.

### 7.5 La línea que no se cruza

Nunca: la barra de cabecera verde, el juego de iconos de WhatsApp, su
tipografía, su fondo de garabatos, su icono de teléfono, ni un lockup del
tipo "CliniVentas ♥ WhatsApp". Nunca un mockup de teléfono con la interfaz de
WhatsApp dentro. Nunca emoji haciendo de iconos. El producto se **conecta**
con WhatsApp y eso se dice **con palabras**, en texto legal claro, no
vistiéndose de él.

---

## 8. Sistema de movimiento

El movimiento existe para explicar que *esto es una conversación en marcha*.
Todo lo que no sirva a eso, fuera.

### Curvas

| Token | Valor | Para qué |
|---|---|---|
| `ease-suave` | `cubic-bezier(.32,.72,0,1)` | Hover, foco, cambios de estado. La de uso general. |
| `ease-entrada` | `cubic-bezier(.16,1,.3,1)` | Entradas al viewport, despliegues. |
| `ease-salida` | `cubic-bezier(.4,0,1,1)` | Salidas, cierres. |
| `ease-burbuja` | `cubic-bezier(.34,1.35,.64,1)` | **Solo** la llegada de una burbuja. |

### Duraciones

`--duration-micro` 120 ms · `--duration-rapida` 180 ms · `--duration-media`
260 ms · `--duration-lenta` 420 ms · `--duration-ambiente` 700 ms.
En Tailwind: `duration-(--duration-media)`.

### Qué se anima

| Elemento | Animación | Duración / curva |
|---|---|---|
| Color de botón, enlace, borde | `transition-colors` | 180 ms `ease-suave` |
| Elevación de tarjeta en hover | sombra + `-translate-y-0.5` | 180 ms `ease-suave` |
| Entrada de sección al scroll | `animate-aparecer` (12 px + fade) | 420 ms `ease-entrada`, escalonado 60 ms |
| Llegada de burbuja | `animate-burbuja` (8 px + escala 0.96→1) | 420 ms `ease-burbuja`, escalonado 220 ms |
| Palomita | `animate-palomita` (trazo dibujándose) | 260 ms `ease-entrada` |
| "Escribiendo…" | `animate-escribiendo` | 1.3 s en bucle |
| Resplandor del hero | `animate-respirar` | 6 s en bucle |
| Acordeón | altura + rotación del `+` | 260 ms `ease-suave` |

La burbuja **no rebota**: crece un 4% y se asienta. Suficiente para leerse
como mensaje que llega; no lo bastante para parecer un globo de dibujos.

### Movimiento reducido

`@media (prefers-reduced-motion: reduce)` en `globals.css` anula **todo**:
animaciones a 0.01 ms con una sola iteración, transiciones a 0.01 ms y
`scroll-behavior: auto`. Lo que **se conserva** es el cambio de color de
hover y foco: no es movimiento, es información, y quitarlo dejaría la página
sin señal de interacción. El contenido revelado al scroll debe ser visible sin
JS y sin animación — la animación solo acompaña, nunca condiciona la
aparición.

---

## 9. Tres cosas que esta web no va a hacer

**1. Nada de captura de dashboard flotando en perspectiva 3/4 sobre bruma de
degradado.** Es el hero por defecto de todo SaaS desde 2019: una interfaz
inclinada, con brillo, ilegible, que no demuestra nada porque no se lee. En su
lugar el hero muestra una conversación real, plana, a tamaño legible, con
copy que un dueño de clínica reconoce como suyo. Si el producto es fácil de
entender, se enseña; no se insinúa en perspectiva.

**2. Nada de prueba social sin sustancia.** Cero muros de logotipos en gris al
40% que nadie identifica. Cero contadores animados subiendo hasta "+10.000
citas agendadas" sin decir en qué periodo ni de dónde sale el dato. Cero
testimonios de "María G., Directora" con foto de banco de imágenes. O tenemos
nombre de clínica, ciudad y una cifra que podemos defender, o esa sección no
existe todavía. En salud, la confianza inventada se paga cara.

**3. Nada de texto con degradado, glassmorphism decorativo ni auroras de
fondo.** Ni titulares en degradado violeta-cian, ni tarjetas de cristal
apiladas, ni manchas borrosas de color respirando detrás del hero. Todo eso
es textura sin información y, en un sector que vende higiene, ensucia. El
único patrón del sistema es la retícula de puntos al 9%, enmascarada. Si un
bloque necesita destacar, destaca con espacio, jerarquía tipográfica y un
borde de acento — no con efectos.

---

## 10. Tokens disponibles

Referencia exacta de lo implementado en `src/app/globals.css`. Todo responde
a modo claro/oscuro automáticamente.

### 10.1 Modo oscuro

Funciona de las dos formas a la vez:
- **Automático:** `prefers-color-scheme: dark`.
- **Manual:** `data-theme="dark"` o `data-theme="light"` en `<html>`. Un
  `data-theme="light"` explícito gana siempre sobre la preferencia del SO.

La variante `dark:` de Tailwind está redefinida para respetar ambos, así que
`dark:algo` funciona igual en los dos casos. **Aun así, casi nunca la
necesitarás:** los tokens semánticos ya cambian solos. Usa `bg-surface`, no
`bg-white dark:bg-slate-900`.

### 10.2 Color

Cada nombre funciona con todos los prefijos de Tailwind: `bg-`, `text-`,
`border-`, `ring-`, `outline-`, `fill-`, `stroke-`, `divide-`, `from-`,
`via-`, `to-`, `shadow-`, `accent-`, `caret-`, `placeholder-`.

```
bg  surface  surface-raised  surface-sunken
text  text-muted  text-subtle  text-inverse
border  border-strong  border-field
accent  accent-hover  accent-active  accent-contrast  accent-soft  accent-strong
aqua  aqua-soft
success  success-solid  success-soft  success-contrast
warning  warning-solid  warning-soft  warning-contrast
danger   danger-solid   danger-soft   danger-contrast
tick-idle  tick-read  bubble-in  bubble-out
ring  overlay
background  foreground        ← alias de compatibilidad, no usar en código nuevo
```

Ojo con dos nombres: el texto primario es `text-text` (clase) y el fondo de
página es `bg-bg`. Es intencional: el token se llama por su rol.

### 10.3 Tipografía

```
font-display   font-sans   font-mono
text-display-1  text-display-2
text-h1  text-h2  text-h3  text-h4
text-lead  text-body  text-body-sm  text-caption  text-eyebrow  text-micro
```

Cada `text-*` propio ya trae interlineado, tracking y peso; no hace falta
añadir `leading-*`, `tracking-*` ni `font-*` salvo que quieras sobrescribir.
Los `h1`–`h4` de HTML ya salen con `font-display` y su escala desde la capa
base: solo necesitas la clase si cambias el nivel visual.

### 10.4 Espacio y medida

```
--spacing: 0.25rem        (base de p-*, m-*, gap-*, size-*, space-*)
p-seccion  py-seccion  my-seccion  gap-seccion         → clamp(4rem … 7.5rem)
p-seccion-sm  py-seccion-sm  gap-seccion-sm            → clamp(2.5rem … 4.5rem)
max-w-pagina    → 76rem
max-w-lectura   → 68ch
```

### 10.5 Radios

```
rounded-xs  rounded-sm  rounded-md  rounded-lg  rounded-xl
rounded-2xl  rounded-3xl  rounded-bubble  rounded-bubble-tail
```

### 10.6 Sombras

```
shadow-xs  shadow-sm  shadow-md  shadow-lg  shadow-xl  shadow-bubble  shadow-none
```

### 10.7 Movimiento

```
ease-suave  ease-entrada  ease-salida  ease-burbuja
duration-(--duration-micro | --duration-rapida | --duration-media
          | --duration-lenta | --duration-ambiente)
animate-aparecer  animate-burbuja  animate-palomita
animate-escribiendo  animate-respirar
```

### 10.8 Utilidades propias

| Clase | Qué hace |
|---|---|
| `patron-conversacion` | Retícula de puntos del acento al 9%, paso 22 px. |
| `patron-desvanecido` | Máscara radial que difumina el fondo hacia los bordes. Va con la anterior. |
| `burbuja-entrante` | Fondo, color, radios con cola a la izquierda y `shadow-bubble`. |
| `burbuja-saliente` | Ídem con cola a la derecha y fondo `accent-soft`. |
| `vidrio` | Superficie translúcida con `backdrop-filter` para la navbar. |
| `columna-lectura` | `max-width: 68ch`. |
| `subrayado-acento` | Resalta una palabra dentro de un titular con una banda del acento al 20% por detrás de la línea base. |

### 10.9 Variables CSS crudas

Disponibles en `:root` para CSS a mano, `style={{}}` o valores arbitrarios:
todos los nombres de color de §10.2 sin prefijo (`var(--accent)`,
`var(--text-muted)`, `var(--bubble-in)`…), más
`--pattern-dot`, `--pattern-gap`, `--radius-bubble`, `--radius-bubble-tail`,
`--shadow-tint`, `--shadow-boost`, `--duration-*` y `--ease-*`.

### 10.10 Dos cosas pendientes en `layout.tsx`

No se han tocado (fuera de alcance), pero conviene arreglarlas al construir:

1. **`<html lang="en">` debe ser `lang="es"`.** Afecta a la separación
   silábica, al corrector, a la voz de los lectores de pantalla y al SEO.
2. **`metadata`** sigue con el título y la descripción de `create-next-app`.

Opcionalmente, si prefieres cargar las tipografías con `next/font` en vez de
los `@font-face` auto-hospedados: define las variables `--font-display-src` y
`--font-body-src` en `<html>` y el sistema las tomará sin tocar `globals.css`
(ya están previstas como primer valor de `--font-display` y `--font-sans`).
Recuerda entonces borrar los `@font-face` del CSS y los WOFF2 de
`public/fonts/`.
