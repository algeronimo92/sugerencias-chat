# CliniVentas — Estrategia de posicionamiento, mensaje y copy

**Versión:** 2.0 — reescritura completa sobre el inventario verificado de producto
**Fecha:** 2026-08-31
**Fuente de verdad del producto:** `docs/inventario-producto.md` (verificado contra el código de `wsp-suggestions-app` + 5 capturas de producción)
**Mercado:** LATAM · Español neutro
**Producto:** CRM de ventas que corre sobre el WhatsApp real del negocio.

---

## 0. Qué cambió en esta versión (leer primero)

La versión 1.0 se escribió sin acceso al producto y asumió cosas que **son falsas**. Esta versión las corrige. Si tienes el borrador anterior a mano, tíralo.

### La corrección de fondo

**CliniVentas no "se parece" a WhatsApp. ES el WhatsApp del negocio.**

Se vincula el número que la clínica ya usa escaneando un QR, igual que WhatsApp Web. El teléfono sigue siendo el dispositivo principal. Lo que el dueño escribe desde su celular también entra al CRM. El historial anterior a la instalación se ve dentro del hilo. Y varias personas atienden ese mismo número a la vez sin pisarse.

Eso cambia todo el eje del mensaje: pasamos de vender **familiaridad de interfaz** (un argumento débil, que invita a "¿y para qué pago si WhatsApp es gratis?") a vender **cero migración y trabajo en equipo sobre un número** (un argumento fuerte, que es exactamente lo que el comprador teme perder).

### Afirmaciones del borrador anterior que eran falsas y quedan eliminadas

| Afirmación v1.0 | Realidad |
|---|---|
| "Agenda de citas" como función del producto | **No existe agenda ni calendario.** Hay campo de próxima cita, contador de no-show y un tipo de tarea "Cita". Es seguimiento comercial, no agenda. |
| "Exportas tus datos cuando quieras" | **No hay exportación desde la aplicación.** Ver objeción 5, reescrita con honestidad. |
| Seguimiento de paquetes de sesiones | No existe. Pertenece a otro producto de la misma marca. |
| Recordatorios automáticos de cita | No existen como tales. Existen **tareas** con fecha de recordatorio, que es otra cosa. |
| Plan "Multisede" con 3 sucursales | **Una cuenta = un número de WhatsApp.** El plan se eliminó. |
| "Prueba gratis 14 días, sin tarjeta", "crea tu cuenta" | La activación es asistida. Ver decisión de CTA en 0.2. |
| "Recupera leads fríos / reactiva clientes dormidos" | **Imposible hoy.** Ver 0.1. |
| "Integración con Google Calendar" | No existe. |
| Interfaz "inspirada en" WhatsApp | Es la bandeja de WhatsApp de verdad. |

### 0.1 El límite duro que hay que respetar en todo el copy

**Fuera de las 24 horas desde el último mensaje del cliente, WhatsApp no deja escribir primero.** Reabrir esa conversación requiere una plantilla aprobada por Meta, y eso solo funciona con la API oficial de Meta — no con la vinculación por QR, que es la que corre hoy.

Consecuencia para el copy: **está prohibido escribir cualquier variante de "recupera leads fríos", "reactiva clientes dormidos", "vuelve a contactar tu base"**. No es una limitación del producto, es una regla de WhatsApp, pero el resultado es el mismo y prometerlo genera reembolsos.

Lo que sí se puede decir, y es mejor: el producto **te avisa antes de que se cierre la ventana**, con un contador visible y un candado. Convierte la regla en urgencia útil.

### 0.2 Decisión de CTA (obligatoria)

La activación de cuenta es asistida. Por eso:

**CTA de hoy:**
> Botón: **Solicita tu acceso**
> Subtexto: *Te activamos la cuenta y te acompañamos en la puesta en marcha.*

**CTA del futuro** (cuando exista el alta automática — cambiar SOLO estas dos líneas):
> Botón: **Empieza gratis**
> Subtexto: *Tu cuenta lista en minutos.*

**Prohibido en todo el sitio:** "regístrate en 2 minutos", "crea tu cuenta ahora", "activación instantánea", "empieza solo, sin hablar con nadie", "prueba gratis sin tarjeta".

Todo el copy de este documento está escrito para que **ese cambio futuro sea de dos líneas**, no de secciones enteras. Ninguna sección explica el proceso de activación ni depende de él: la única mención vive en el botón, su subtexto y una línea del formulario.

**Y ojo con el reemplazo del "prueba gratis".** Sin prueba autoservicio, la reducción de riesgo se sostiene con otras tres piezas, que hay que mostrar juntas y arriba: **garantía de devolución de 30 días**, **sin permanencia** y **demo en vivo de 15 minutos**. Funciona igual de bien y no promete nada que no puedas cumplir.

### 0.3 Reglas permanentes

1. **Nada que no esté en el inventario se publica.** Si una función no aparece ahí como CONFIRMADO o PROBABLE, no existe para la web.
2. **Cero prueba social inventada.** Ni testimonios, ni logos, ni contadores, ni sellos. Ver sección 7.
3. **Nunca prometer lo del otro producto:** historia clínica, fotos antes/después, paquetes de sesiones, facturación, pagos, comisiones. (La única mención permitida es la línea de alcance de 4.3, y es para decir que **no** lo hacemos.)
4. **La web habla como el producto.** Glosario obligatorio en 3.5.
5. **CliniVentas no es WhatsApp.** Nota de marca en 3.6.

---

## 1. ICP y segmentos

### El disparador de compra, en una frase

**Dos o más personas atienden el mismo WhatsApp y ya se están pisando.**

Ese es el momento exacto en que este producto pasa de ser interesante a ser necesario. Antes de eso, la venta cuesta el triple. Todo el marketing debería apuntar a negocios que ya cruzaron esa línea.

**Segunda señal, casi igual de fuerte:** el negocio pauta en Meta y los anuncios caen en el WhatsApp. Volumen de conversaciones + equipo compartiendo un número = dolor diario.

> Las cifras de facturación de abajo son **estimaciones para calibrar precio y mensaje**, no datos de estudio de mercado. Valídalas en las primeras 10 llamadas.

---

### Segmento 1 — Centro estético / medicina estética con 3 a 12 personas
**Prioridad 1. Es el encaje casi perfecto.**

| | |
|---|---|
| **Quién decide** | La dueña o el médico estético dueño. Decide solo, en una conversación. Ciclo de compra: días. |
| **Facturación estimada** | USD 8.000 – 30.000 al mes. |
| **Equipo** | 2 a 4 personas atendiendo mensajes (vendedoras / recepción), más cosmetólogas y a veces un médico. |
| **Qué usa hoy** | WhatsApp Business en un celular compartido, o WhatsApp Web abierto en dos computadoras con la misma sesión. Anuncios en Instagram y Facebook con botón "Enviar mensaje". Excel o cuaderno para saber quién compró. |
| **Ticket** | Sesión USD 40 – 200. Tratamientos de aparatología bastante más. |

**Por qué le duele:**
Pauta, le entran 40 conversaciones en un día y su equipo contesta por orden de llegada, sin criterio. Dos vendedoras le escriben a la misma persona. Nadie sabe quién iba con quién. Al día siguiente, la mitad de esas conversaciones ya pasó las 24 horas y no se puede escribir primero. **El dinero que puso en publicidad se evapora en la bandeja.**

Y no tiene forma de saber cuánto tarda su equipo en responder, que es justo la variable que decide si ese lead compra o le escribe a la clínica de al lado.

**Por qué el producto le queda medido:** las 13 etapas del embudo están escritas literalmente para este vertical (Nuevo, En diagnóstico, Calificado, Oferta presentada, En objeción, Agendado, Cliente activo, Postventa, En seguimiento, En nutrición…). No hay que adaptar nada.

**Frase que dice:** *"Pagué la publicidad, me llegaron los mensajes, y no sé qué pasó con la mitad."*

---

### Segmento 2 — Clínica dental o policlínico de 2 a 5 sillones
**Prioridad 2. El mejor ticket, ciclo un poco más largo.**

| | |
|---|---|
| **Quién decide** | El odontólogo dueño, a veces con quien lleva la administración. |
| **Facturación estimada** | USD 8.000 – 35.000 al mes. |
| **Equipo** | 2 a 5 profesionales, 1 o 2 personas en recepción atendiendo el WhatsApp. |
| **Qué usa hoy** | Un celular del negocio que vive en el mostrador. Google Calendar o cuaderno. A veces un software dental usado solo para lo clínico. |
| **Ticket** | Consulta USD 20 – 40. Tratamiento real USD 300 – 2.500. |

**Por qué le duele:**
Su problema no son las citas, es **el presupuesto que mandó y nadie volvió a tocar**. Cotiza una ortodoncia de USD 1.800, el paciente dice "lo consulto en casa", y ahí muere. Diez cotizaciones al mes sin seguimiento son miles de dólares, y no sabe cuántas fueron porque están enterradas en el chat.

Y el celular del mostrador es un punto único de falla: si esa persona no vino, nadie sabe a quién le quedaron debiendo respuesta.

**Frase que dice:** *"Yo sé que ahí hay plata. Pero no sé dónde está."*

---

### Segmento 3 — Consultorio de 1 a 2 personas con volumen de mensajes
**Prioridad 3. Encaje parcial, y conviene decirlo.**

| | |
|---|---|
| **Quién decide** | El profesional. Único usuario, o él más una asistente. |
| **Facturación estimada** | USD 2.000 – 8.000 al mes. |
| **Qué usa hoy** | Su WhatsApp, muchas veces el personal, sin separar del familiar. |
| **Ticket** | Consulta USD 25 – 80. El valor está en la recurrencia. |

**Por qué le duele:** vive con el trabajo y la vida en la misma bandeja, contesta pacientes a las 11 de la noche, y no puede delegar sin entregar su celular personal.

**Sé honesto con este segmento.** Buena parte del valor del producto —bandeja compartida, reparto por turnos entre vendedores, notas internas con menciones, dashboard de carga por persona— solo aparece cuando hay equipo. Un profesional solo aprovecha bien el orden, las tareas, las plantillas, los flujos y el aviso de las 24 horas; el resto le sobra.

Véndeselo así, sin adornos: es el que menos paga y el que más soporte consume. Si no está desbordado de mensajes, todavía no es tu cliente.

**Frase que dice:** *"No quiero un sistema. Quiero dejar de vivir pegado al celular."*

---

### 1.1 Para quién NO es (publicar esto en la web)

Filtra antes de vender. Cada cliente mal encajado son dos meses de soporte y un reembolso.

- **Si tus clientes te escriben sobre todo por Instagram o Messenger.** CliniVentas trabaja solo con WhatsApp. No es multicanal.
- **Si tienes varias sedes con números de WhatsApp distintos.** Una cuenta trabaja con un número.
- **Si necesitas un embudo con tus propias etapas.** Las etapas vienen definidas y están pensadas para clínicas y centros estéticos. No se renombran.
- **Si buscas historia clínica, facturación o pagos.** No es eso, y no pensamos que lo sea.
- **Si tu plan es escribirle a una base fría de contactos.** WhatsApp no lo permite fuera de las 24 horas. Ver la explicación completa en el FAQ.
- **Si recibes tres mensajes por semana.** Con tu WhatsApp estás bien. Vuelve cuando te desborde.

---

## 2. El problema, en las palabras del cliente

Esto no es una lista de features al revés: es **cómo lo dice él**. Úsalo textual en web, anuncios y guiones de venta.

### El celular compartido

- *"El WhatsApp del negocio lo tiene Karla. Si Karla no vino, nadie contesta."*
- *"Ese celular no puede salir del mostrador. Y si se pierde, se pierde el negocio."*
- *"Tenemos la sesión de WhatsApp Web abierta en dos computadoras y se cierra sola cada rato."*
- *"Le escribimos dos al mismo cliente. Quedamos como desorganizados."*
- *"Cuando entra una chica nueva no tengo cómo mostrarle en qué iba cada conversación."*

### Los mensajes perdidos

- *"Abro el chat y hay 40 conversaciones sin leer. No sé por dónde empezar."*
- *"Me escribió el martes preguntando el precio. Le contesté. Y ahí quedó."*
- *"Le dije 'ahorita te confirmo' y se me pasó. Me acordé tres días después."*
- *"Busco un chat viejo y tengo que hacer scroll diez minutos."*
- *"Ya no le puedo escribir porque pasó un día. Se cerró la conversación."*

### Los anuncios que se pierden en la bandeja

- *"Pagué la publicidad, llegaron los mensajes, y no sé qué pasó con la mitad."*
- *"No sé cuál anuncio me trajo a esta persona."*
- *"Los mensajes llegan todos juntos y contestamos los que alcanzamos."*

### El seguimiento que no existe

- *"Le mandé el presupuesto y ya no supe más."*
- *"Al que no vuelve, nadie lo busca. Simplemente deja de aparecer."*
- *"Los que preguntaron el mes pasado están ahí, pero es como si no existieran."*

### Los números que no tiene

- *"¿Cuánto nos tardamos en contestar? Ni idea. Supongo que rápido."*
- *"No sé cuántos me escribieron ni cuántos terminaron viniendo."*
- *"Me entero de que fue un mes malo cuando voy a pagar la renta."*

### Lo que ya intentó, y por qué falló

- *"Probé un sistema. Era una pantalla llena de cuadritos. Nunca lo usamos."*
- *"Las chicas no lo abrían. Decían que era más rápido por WhatsApp. Y tenían razón."*
- *"Me pedían que usara otro número. Ahí se acabó la conversación."*
- *"Me cobraban por usuario. Somos cinco. No, gracias."*

### La traducción estratégica

| Lo que él dice | Lo que realmente dice | Lo que CliniVentas responde |
|---|---|---|
| "Me pedían otro número" | No pienso arriesgar mi activo más importante | Es tu mismo número. Se vincula con un QR |
| "Las chicas no lo usaron" | Cualquier sistema nuevo es un riesgo de adopción | Es la misma bandeja de WhatsApp, con orden encima |
| "Le escribimos dos al mismo cliente" | Mi equipo se pisa y se nota | Cada lead tiene un vendedor asignado |
| "Se cerró la conversación" | Perdí el lead por lento | Contador de 24 horas visible en cada chat |
| "No sé cuánto tardamos" | No tengo control | Tiempo de respuesta promedio en el dashboard |
| "Es caro" | No confío en que lo vayamos a usar | Precio por negocio + garantía + demo en vivo |

---
