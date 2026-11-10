# Copiloto de IA: lo que le toca al negocio (DermicaPro) — 2026-11-09

Salió del panel sobre el copiloto (cinco expertos con sus contrapartes y
réplicas; síntesis en la sesión del 2026-11-09). El código ya hizo su parte
en tres PR: el contexto que lee el modelo (#127), el system prompt v2 y la
pantalla (#128) y el recorte de las plantillas de la plataforma (este PR).
Lo que sigue solo lo puede hacer la dueña del negocio, porque son decisiones
de negocio o textos suyos. Todo se hace en **Asistente IA** (pestañas
*Perfil* y *Conocimiento*), sin tocar código.

## 1. Tres decisiones de política (hoy el copiloto las inventa o las calla)

Las plantillas traían la política de otra clínica como si fuera la propia. Ya
se quitaron; mientras el Perfil no diga la real, el copiloto no afirma nada
sobre estos puntos.

| Decisión | Qué hay que definir | Dónde va |
|---|---|---|
| **Evaluación** | ¿La primera evaluación es gratuita o es una consulta de valoración con precio? Si se cobra: ¿cuánto y se descuenta del tratamiento? | Perfil → reglas «siempre» (una línea: «La evaluación es gratuita» o «La consulta de valoración cuesta S/ … y se descuenta del tratamiento») |
| **Adelanto** | ¿Se pide adelanto para separar la cita? ¿Cuánto? ¿Por qué medios (Yape, Plin, tarjeta, efectivo)? ¿Se descuenta del tratamiento? ¿Cuándo se paga el resto de un pack? | Perfil → reglas «siempre» + un documento «Política de reservas y pagos» (tipo *política*, para todos los servicios) |
| **Inasistencias** | Si no viene a la cita: ¿la primera vez conserva el adelanto? ¿La segunda lo pierde? ¿Qué pasa si cancela del todo (se devuelve, queda como crédito, se pierde)? ¿Con cuántas horas de aviso no cuenta como inasistencia? | El mismo documento «Política de reservas y pagos» |

Sin estas tres respuestas, cuando un lead pregunte «¿cómo pago?» o «¿y si no
puedo ir?» el copiloto solo puede sugerir «te lo confirmo con administración».

## 2. Cinco o seis reglas de método en el Perfil

El system prompt ya no trae un método de venta fijo: cada negocio pone el
suyo en el Perfil (reglas «siempre» / «nunca»). Estas son las que el panel
consideró mínimas para una clínica estética; son sugerencias, se redactan
con las palabras del negocio:

**Siempre**
1. Preguntar qué quiere tratarse antes de dar un precio; el precio va con el paquete del catálogo, nunca una cifra suelta.
2. Hacer una sola pregunta por mensaje.
3. Preguntar por embarazo, lactancia y tratamientos médicos en la zona antes de agendar.
4. Pedir una foto con buena luz cuando el servicio depende de la zona o del caso (manchas, tatuajes, flacidez).
5. Proponer dos horarios concretos al cerrar («martes 4 pm o jueves 11 am»).

**Nunca**
6. Prometer resultados ni decir que algo «no duele»: lo que se siente lo dice la ficha de cada servicio.
7. (Estilo) Más de un emoji por mensaje; el emoji va al final de la frase.

## 3. Recortar la copia propia de las plantillas

Las plantillas de la plataforma ya están recortadas (dirección, medios de
pago, montos y nombres de autores fuera; conversación de ejemplo en su propio
documento). Pero **las copias que el negocio importó antes del 2026-11-09 no
cambian solas**: son suyas. En *Asistente IA → Conocimiento*:

- «Guiones de WhatsApp por etapa del funnel»: borrar la copia e importar de
  nuevo la plantilla (botón «Importar otra vez»), o editar la copia quitando
  la dirección de Trujillo, el enlace de Maps, «Yape o Plin», los montos (S/
  50, S/ 80, S/ 160, S/ 400, S/ 590) y la sección 11.
- «Mapa dolor → solución» y «Playbook de objeciones»: igual, borrar e
  importar de nuevo es lo más rápido si no se editaron.
- Importar la plantilla nueva «Conversación de ejemplo: de la pregunta de
  precio a la cita».

Si la copia ya tiene cambios propios, conviene editarla a mano: el recorte
es de unas quince líneas.

## 4. Vincular las fichas a sus servicios

Quince de las dieciséis fichas importadas quedaron sin servicio (el PR #124
arregló las importaciones futuras, no las copias existentes). Sin el
vínculo, el copiloto no reserva espacio para la ficha del servicio que le
interesa al lead y depende de que la búsqueda la encuentre.

En *Asistente IA → Conocimiento*, abrir cada ficha y marcar sus servicios en
la lista (buscador por nombre; la casilla del tratamiento marca todas sus
zonas):

| Ficha | Servicios a marcar |
|---|---|
| Depilación láser tridiodo | Depilación Láser (todas las zonas) |
| HIFU 12D | HIFU 12D (todas las zonas) |
| Hollywood Peel | Hollywood Peel (todas las zonas) |
| Limpieza facial | Limpieza Facial |
| Exosomas TRX | Exosomas TRX |
| Ácido tranexámico | Ácido Tranexámico |
| ADN de salmón | ADN de Salmón |
| Exosomas + ADN (VTECH) | VTECH |
| Enzimas recombinantes | Enzimas Recombinantes |
| Borrado de cejas · Borrado de tatuajes | Borrado de Cejas y Borrado de Tatuajes (todas las tallas) |
| Botox | Botox (1, 2 y 3 zonas) |
| Remoción de lunares o acrocordones | Remoción de Lunares |
| Rinomodelación | Rinomodelación |
| Mentomodelación | Mentomodelación |
| Puntos de anclaje | Puntos de Anclaje |
| Hidratación con ácido hialurónico | Hidratación con Ácido Hialurónico |

Los nombres exactos son los del catálogo del ERP; el buscador de la lista
ignora tildes y mayúsculas.

## 5. Qué no hace falta hacer

- No hay que escribir el método de venta completo en el Perfil: el panel
  descartó meterlo en el system prompt (+79 % de tokens y pisa la voz de cada
  negocio); con las reglas de la sección 2 alcanza.
- No hay que cargar las plantillas de WhatsApp aprobadas en el conocimiento:
  el copiloto no las necesita para sugerir texto libre y ocuparían el 22 %
  del prompt.
- No hay que tocar el analista (vive en n8n): las situaciones «Retomar
  seguimiento», «No vino a la cita» y «Responder objeción» ya se eligen con
  un chip antes de generar.

## Después (lado del código, M)

Evaluación con servicio de interés y un banco de 10-20 chats reales (hace
falta una clave de IA de prueba); trazabilidad de fragmentos (título junto a
los ids en el job); «Basado en…» en el chat (PR3 del panel de Conocimiento).
