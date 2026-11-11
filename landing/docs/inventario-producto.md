# Inventario de producto — DermicaPro CRM

> Documento de trabajo para el equipo que escribe la web comercial.
> **Regla:** si algo no está en este documento marcado como CONFIRMADO o PROBABLE, no se promete en la web.

**Fecha del inventario:** 2026-08-31
**Analista:** revisión de código fuente + 5 capturas de producción

---

## ⚠️ NOTA CRÍTICA SOBRE LAS FUENTES (leer antes que nada)

El repositorio que se me indicó como fuente de verdad, `/Users/alangeronimo/dermicapro`, **NO es el producto que se ve en las capturas**. Es un producto distinto: un sistema de gestión de clínica (pacientes, citas, historia clínica, facturas, pagos, comisiones) hecho en Node.js/TypeScript + Prisma + React. No contiene chats, Kanban, flujos ni IA. Todos los `.md` de su raíz (FEATURES.md, CLAUDE.md, APPOINTMENTS_MODULE.md, HISTORIAL_MEDICO_FEATURE.md, ANALYTICS_*.md, MODULO_COMISIONES.md, etc.) describen ese otro producto.

**El producto de las capturas es otro repositorio: `/Users/alangeronimo/wsp-suggestions-app`** (nombre interno del repo: `sugerencias-chat`; dominio de producción: `chat.dermicapro.app`). Stack: **Python/FastAPI + SQLAlchemy + PostgreSQL** en el backend, **React 19 + TypeScript + Vite + TanStack Query + React Flow + Tailwind** en el frontend, desplegado con Docker + Traefik y blue-green.

Todo lo que sigue está verificado contra ESE repositorio y contra las capturas. Los dos proyectos comparten marca ("DermicaPro") y convención de nombres de base de datos, pero **no encontré ninguna integración de código entre ellos**. Son dos productos separados.

Estado del checkout local: último commit en `main` el **2026-08-27**. Las capturas son del 2026-08-31, así que puede haber hasta 4 días de trabajo en producción que no está en el código que revisé (ver §9, punto "Nueva Cita").

---

## 1. Resumen ejecutivo

**Qué es.** DermicaPro CRM es un CRM de ventas construido encima de WhatsApp: toda la bandeja de conversaciones del negocio se centraliza en una sola pantalla web, cada conversación es un "lead" con su ficha, etiquetas, etapa de embudo y tareas, y un equipo de vendedores atiende en paralelo sobre **un mismo número de WhatsApp** sin pisarse. Sobre esa base corre un motor de automatización con **constructor visual de flujos** (arrastrar bloques en un lienzo, versionar y publicar) que responde, etiqueta, deriva y reparte leads solo. Y una capa de IA que analiza la conversación, describe/transcribe los audios, fotos y videos que manda el cliente, y **le propone al vendedor qué responder** — el vendedor decide.

**La capacidad más diferenciadora.** El **constructor visual de flujos conversacionales conectado al WhatsApp real del negocio**, con ramificación por botones, esperas condicionales ("hasta que el cliente mande una foto"), reparto round-robin de leads entre vendedores, versionado con publicar/borrador/restaurar, simulador ("Probar") y límite de ejecuciones por hora como freno de seguridad anti-baneo. No es "autoresponder": es un motor de conversación con estado, con la lógica de negocio dibujada por el propio dueño de la clínica.

**El segundo diferenciador**, y el que más importa comercialmente: **no hay que cambiar de número ni migrar nada**. Se vincula el WhatsApp existente escaneando un QR, como WhatsApp Web, y el teléfono sigue siendo el dispositivo principal.

---

## 2. Módulos

Nivel de confianza:
- **CONFIRMADO** — visto en una captura de producción y/o código claro y completo.
- **PROBABLE** — documentado con rastro concreto en el código (rutas, modelos, servicios), sin verlo funcionando.
- **NO VERIFICADO** — solo mencionado; no lo encontré en el código.

### 2.1 Chats — Bandeja de WhatsApp
**Nombre en el producto:** `Chats` (ítem de navegación). La lista se titula **"Leads"**.
**Confianza: CONFIRMADO** (capturas 1, 2, 5 + `frontend/src/components/ChatList.tsx`, `ChatThread.tsx`, `backend/routers/chats.py`).

Para quién: vendedores y admin.

Qué hace, verificado:
- Lista de leads con búsqueda ("Buscar lead…"), pestañas **Todos / No leídos (con contador) / Mis leads**, y **Filtros avanzados**.
- Filtros avanzados reales (código `ChatList.tsx` + `chats.py`): etapas, etiquetas (modo **Cualquiera / Todas**), servicio, vendedor, origen, último emisor (Cliente/Vendedor), días de inactividad, y **tiempo esperando respuesta** con rangos "Todos esperando respuesta / Menos de 10 minutos / Entre 10 minutos y 1 hora / Más de 1 hora". Paginación por cursor, filtrado en PostgreSQL.
- Búsqueda **insensible a acentos** ("jose" encuentra "José"), sobre **todo el historial de mensajes** del chat (no solo el último), y que **matchea teléfonos por dígitos** ignorando el formato ("1112345678" encuentra "+54 9 11 1234-5678"). Usa `unaccent` + `pg_trgm`.
- Hilo estilo WhatsApp: burbujas, **checks de entrega y lectura** (un check gris al enviar, dos grises al entregar, dos azules al leer), audio con estado **"No escuchado"**, video con caption, imágenes con dimensiones pre-reservadas.
- **Responder citando un mensaje** (como en WhatsApp): la cita viaja a WhatsApp y el cliente la ve igual que desde el teléfono; tocar la cita salta al original.
- **Editar** un mensaje propio (texto, hasta 15 min, con marca "Editado") y **eliminar para todos** — actúa sobre WhatsApp de verdad, no solo sobre el CRM.
- **Reacciones** con emoji sobre mensajes, en ambos sentidos.
- **Reenviar mensajes** a otro chat (`ForwardMessageDialog`).
- Envío de: texto, **audio grabado en el navegador** (`VoiceRecorder`), imágenes/videos/documentos con vista previa antes de enviar, **stickers**, **ubicación** con mapa.
- Edición de imagen antes de enviar: **recorte** (`ImageCropDialog`) y **dibujo/anotación sobre la foto** (`ImageDrawDialog`).
- **Historial previo al CRM**: los mensajes anteriores a la instalación se leen al vuelo desde WhatsApp y se muestran en el hilo (solo lectura, no se guardan) — `backend/services/whatsapp_history.py`.
- Marcar chat como leído / no leído. Al abrir un chat, **también se marca como leído en el WhatsApp del cliente**.
- Menú contextual del lead: copiar teléfono, **marcar no-show**, eliminar, y **fusionar leads duplicados** (`MergeLeadDialog`, `lead_merge.py`).
- Tiempo real por **WebSocket** (`/ws/chats`), con refresco periódico de respaldo.

### 2.2 Ventana de atención de 24 horas
**Nombre en el producto:** "ventana de atención"; en pantalla, el contador **"Quedan 20h 29m para responder"**.
**Confianza: CONFIRMADO** (capturas 1 y 2 + `CustomerServiceWindowStatus.tsx`, endpoint `GET /api/chats/{id}/service-window`).

- Se calcula **exclusivamente desde el último mensaje entrante del cliente**; los mensajes del vendedor no reinician el plazo.
- Cuenta regresiva en el encabezado del chat, que **cambia de color** al acercarse el vencimiento, y **candado** en la lista de conversaciones para las ventanas cerradas (visible en la captura 2).
- Con la ventana cerrada se **bloquean** texto, audio, archivos, ubicación y plantillas internas. El bloqueo se revalida en el backend en cada ruta de envío, no depende de la UI. Las notas internas siguen disponibles.
- Con la ventana cerrada, el selector de plantillas muestra **solo plantillas oficiales de Meta con estado APPROVED**.

Este es un argumento comercial fuerte y honesto: el producto **educa y protege** al equipo sobre la regla de las 24 h de WhatsApp en lugar de dejar que se enteren cuando el mensaje falla.

### 2.3 Kanban — embudo de ventas
**Nombre en el producto:** `Kanban`. Las columnas son **"etapas"** (`estado` del lead).
**Confianza: CONFIRMADO** (ítem de navegación en las capturas + `KanbanBoard.tsx`, `GET /api/chats/kanban/*`, `PATCH /api/chats/{id}/stage`).

- **13 etapas fijas**, con estos nombres exactos en la UI: Nuevo · En diagnóstico · Calificado · Oferta presentada · En objeción · Agendado · Cliente activo · Postventa · En seguimiento · En nutrición · Perdido · Descalificado · Baja.
- Arrastrar entre columnas cambia la etapa; el cambio queda en el historial de actividad del lead con actor, valor anterior y nuevo.
- Al mover a "Perdido" se pide **motivo de pérdida** (`LostReasonDialog`, campo `razon_perdido`).
- Cambiar de etapa **dispara automatizaciones** (trigger "Cambio de etapa").
- Búsqueda y filtros compartidos con la bandeja.
- ⚠️ **Las etapas son un enum fijo en base de datos, no configurables por el cliente.** Ver §9.

### 2.4 Tareas — seguimiento
**Nombre en el producto:** `Tareas`. En la ficha del lead aparece como **"Próxima acción"**.
**Confianza: CONFIRMADO** (ítem de navegación en las capturas + `TasksPage.tsx`, `routers/tasks.py`, tabla `lead_tasks`).

- Cada lead puede tener varias tareas pendientes; el panel del lead muestra la que vence primero.
- La vista agrupa **vencidas / de hoy / próximas**.
- Tipos de tarea (etiquetas exactas de la UI): **WhatsApp · Llamada · Cotización · Cita · Seguimiento · Otro**.
- Prioridad **Baja / Normal / Alta**; estado **pendiente / completada / cancelada**; fecha límite y **fecha de recordatorio**; asignación a un usuario.
- **Auto-completado inteligente**: si la tarea era "responderle a este lead" y el vendedor responde (desde el CRM o desde su teléfono), la tarea se cierra sola (`productivity_service.complete_reply_tasks`).
- Worker de recordatorios (`task_reminder.py`) y trigger de automatización "Tarea vencida".

### 2.5 Dashboard CRM
**Nombre en el producto:** `Dashboard`; título de la página **"Dashboard CRM — Atención, seguimiento y distribución de leads"**.
**Confianza: CONFIRMADO** (captura 4 + `DashboardPage.tsx`, `backend/services/dashboard_service.py`). **Solo admin.**

Métricas exactas que calcula (verificado en el SQL):
- **Leads totales** (base actual)
- **Leads nuevos** (en el período)
- **Esperando respuesta** (leads cuyo último mensaje es del cliente)
- **Tareas vencidas** (pendientes fuera de plazo)
- **Tareas completadas** (en el período)
- **Respuesta promedio** en horas — tiempo medio entre un mensaje del cliente y la siguiente respuesta del vendedor
- Gráfico **"Leads nuevos por día"**
- Paneles de distribución: **Leads por etapa**, **Carga por vendedor**, **Principales orígenes**, **Servicios de interés**
- Selector de período: **7 / 30 / 90 días** (la API acepta de 7 a 365)
- "Actualizado hace un momento" + botón de refresco; se actualiza por WebSocket y refresco periódico.

### 2.6 Plantillas (respuestas guardadas)
**Nombre en el producto:** `Plantillas`.
**Confianza: CONFIRMADO** (ítem de navegación + `TemplatesPage.tsx`, `routers/templates.py`, tabla `message_templates`). **Gestión: solo admin. Uso: todos.**

- Plantillas con **variables `{{...}}`** que se resuelven con datos del lead (`{{nombre}}`, `{{servicio}}`, …) al insertarlas desde el compositor.
- **Categorías de plantillas** (catálogo administrable).
- **Adjuntos**: hasta 10 imágenes, videos, audios o documentos de 25 MB cada uno por plantilla. Se envían en secuencia junto con el texto.
- **Vista previa de confirmación en dos paneles** antes de enviar: permite editar el texto ya personalizado, **detecta variables sin resolver**, enumera el orden real de envío y **simula las burbujas** que va a recibir el contacto (imágenes ampliables, audio/video reproducible, documentos abribles).
- **Respuestas rápidas personales**: atajo `/` en el compositor, **favoritos por usuario**, **usadas recientemente**, reutilizar los últimos mensajes enviados, y **guardar un mensaje como plantilla personal** (no visible para el resto del equipo).
- **Dos tipos de plantilla:**
  - **Internas del CRM** — texto libre; requieren ventana de 24 h abierta.
  - **Oficiales de Meta** — guardan nombre exacto registrado en Meta, idioma, categoría, estado de aprobación y el mapeo de `{{1}}`, `{{2}}`… a variables del CRM. Son las únicas enviables con la ventana cerrada. **Ojo:** solo funcionan si la instancia usa integración WHATSAPP-BUSINESS (Meta Cloud API); con vinculación por QR el CRM las administra pero **bloquea el envío y explica por qué**. Ver §3 y §9.
- **Mensajes interactivos**: una plantilla interna puede enviarse como texto, **mensaje con botones** (respuesta / URL / llamada / copiar código; máx. 3 de respuesta) o **mensaje de lista** (varias secciones, hasta 10 opciones). El editor previsualiza la tarjeta y el desplegable de WhatsApp; el backend revalida los límites.

### 2.7 Archivos — biblioteca de medios
**Nombre en el producto:** `Archivos`.
**Confianza: PROBABLE** (código completo `MediaLibraryPage.tsx`, `routers/media_library.py`, `media_library_service.py`; no aparece abierto en ninguna captura). **Solo admin.**

- Repositorio central de imágenes, videos, audios y documentos reutilizables, con búsqueda, filtros, vista previa y **carga múltiple por selector o drag-and-drop**.
- Un adjunto cargado desde una plantilla entra automáticamente a la biblioteca; desde el editor se puede reusar un archivo existente **sin duplicar el archivo físico**.
- Los archivos referenciados por plantillas **no se pueden borrar** hasta quitar la referencia.
- Almacenamiento configurable: disco local o **MinIO / S3-compatible**.

### 2.8 Catálogos
**Nombre en el producto:** `Catálogos`, con tres pestañas: **Servicios · Etiquetas · Categorías de plantillas**.
**Confianza: PROBABLE** (`CatalogsPage.tsx` + paneles y tests; solo admin).

- **Servicios**: catálogo de servicios de interés (en este cliente: HIFU 12D, Hollywood Peel, etc.) que se asigna al lead y alimenta el filtro y el gráfico "Servicios de interés".
- **Etiquetas**: creación por admin; **cualquier usuario autenticado puede asignar o quitar** etiquetas a un lead. En la captura 3 se ve la etiqueta **"HIFU 12D"** aplicada a una conversación.
- **Categorías de plantillas**.

### 2.9 Automatizaciones — motor + constructor visual de flujos
**Nombre en el producto:** `Automatizaciones`. Cada unidad es un **"Flujo"** (en la captura: *"HIFU 12D — Flujo #4 · publicado v10"*). El modo simple se llama **"regla"**.
**Confianza: CONFIRMADO** (captura 5 + `VisualFlowBuilder.tsx`, `components/flow/FlowCanvas.tsx`, `routers/automations.py`, `automation_service.py`, tablas `automation_rules`, `automation_flow_versions`, `automation_executions`, `automation_round_robin_state`). **Solo admin.**

Dos modos de construcción (`builder_mode`): **simple** (disparador → condiciones → lista de acciones) y **visual** (lienzo React Flow).

**Disparadores (etiquetas exactas):**
| Disparador | Cuándo corre |
|---|---|
| Lead nuevo | Se registra un contacto por primera vez |
| Conversación nueva | Un mensaje del cliente abre una conversación que estaba cerrada |
| Cambio de etapa | Una persona o el agente mueve el lead |
| Mensaje recibido | Llega un mensaje nuevo del cliente |
| Vendedor sin responder | El último mensaje es del cliente y vence el tiempo configurado |
| Cliente sin responder | El último mensaje es del vendedor y vence el tiempo configurado |
| Tarea vencida | Una tarea pendiente llega a su fecha límite |
| Inicio manual (vendedor) | El vendedor lo dispara con "Iniciar flujo" dentro del chat |

**Bloques del lienzo (panel "ARRASTRA AL LIENZO"):** Condición (Rama Sí/No) · Acción · Invocar flujo · Pausa · Pregunta (botones) · Round robin · Fin. Más el nodo Disparador.

**Acciones (etiquetas exactas):** Crear tarea · Asignar vendedor · Agregar etiqueta · Quitar etiqueta · Cambiar etapa · Notificar internamente · Enviar plantilla WhatsApp · Enviar mensaje directo · Cambiar/quitar servicio de interés · Cambiar estado de conversación · Enviar audio · Enviar solo adjunto · Enviar multimedia + caption · Reaccionar al último mensaje del cliente.

**Condiciones:** Etapa es · Origen contiene · Servicio contiene · Mensaje contiene · Mensaje es igual a · Mensaje no contiene · **Descripción del archivo contiene** (sobre el análisis IA del adjunto) · Vendedor es · Tiene etiqueta · Ventana WhatsApp abierta · Está en horario laboral.

**Bloque Pausa** — continúa cuando ocurre la primera de: Temporizador · Hasta recibir mensaje · Excepto horas laborales · **Hasta que se reproduce lo enviado** · **Hasta que mande una foto o archivo**.

**Bloque Pregunta (botones)** — una rama por botón, más tres salidas fijas: *Otra respuesta*, *Sin respuesta* y *Mandó una foto*.

**Bloque Round robin** — "Reparte los leads por turnos entre N salidas" (hasta 10 salidas), con contador persistido que sobrevive a las ejecuciones y avanza atómicamente aunque corran en paralelo.

**Controles de la barra superior (captura 5):** deshacer/rehacer, **Condiciones**, **Máx/hora**, **Visible para vendedores**, **Ordenar**, **Versiones**, **Probar**, importar/exportar JSON, **Guardar borrador**, **Publicar**.

**Operación y seguridad del motor:**
- **Versionado real**: borrador vs. publicado, una fila por versión; una ejecución con esperas **termina con la versión con la que arrancó** aunque el flujo se republique. Restaurar una versión anterior.
- **Máx/hora** (`max_executions_per_hour`): si se superan N ejecuciones en la última hora, las siguientes **se reagendan en vez de correr** — freno explícito contra un bug o condición mal armada que arriesgue el número por spam.
- **Simulación** (`POST /{rule_id}/simulate`) e **importación de flujos desde JSON**.
- **Historial de ejecuciones** con estados: programada / corriendo / **pausada** / completada / fallida / omitida, con reintento, cancelación, pausa y reanudación por ejecución.
- **Pausar el piloto automático de un lead puntual** desde el botón del bot en la cabecera del chat, sin cerrar el chat: los disparadores de sistema dejan de programar ejecuciones, pero el vendedor sigue conversando normal. Un flujo iniciado a mano ignora esa pausa a propósito.
- **Invocar flujo**: un flujo puede llamar a otro para el mismo lead (composición).
- Si una ejecución falla porque la ventana de 24 h estaba cerrada, se marca con un código específico y **solo un admin puede reintentarla ignorando la ventana**.

### 2.10 IA — Sugerencias y análisis
Ver §4 (sección dedicada). **Confianza: CONFIRMADO.**

### 2.11 Ficha del lead
**Nombre en el producto:** panel **"FICHA DEL LEAD"**, con el bloque **"DATOS DEL LEAD"**.
**Confianza: CONFIRMADO** (captura 3 + `LeadInfo.tsx`, `LeadFormDialog.tsx`, modelo `Lead`).

Campos verificados en el modelo: nombre, teléfono, **estado** (etapa), servicio de interés, **vendedor asignado**, origen, notas, motivo de pérdida, fecha de recontacto, **contador de no-show**, **próxima cita**, toques de seguimiento, fecha del último toque, y flag **"con especialista"** (chat derivado a un humano especialista, independiente de la etapa).

El panel lateral reúne además: etiquetas, tareas / próxima acción, **notas internas**, **actividad del lead** (historial de cambios), automatizaciones del lead, mensajes programados, y **tarjeta del anuncio de origen** si el lead vino de un anuncio Click-to-WhatsApp.

⚠️ **Terminología:** el producto dice **"lead"**, nunca "paciente" ni "cliente" como entidad. Ver §6.

### 2.12 Notas internas y menciones
**Nombre en el producto:** el compositor tiene un toggle **"Mensaje de WhatsApp" ⇄ "Cambiar a nota interna"**.
**Confianza: CONFIRMADO** (captura 1 + `InternalNoteComposer.tsx`, `routers/internal_notes.py`).

- Las notas aparecen en la línea de tiempo con estilo diferenciado y **nunca se envían por WhatsApp**.
- Escribir `@` abre el listado de usuarios activos para **mencionar**.
- Las menciones generan aviso dentro del CRM y, si se permite, **notificación del navegador**; quedan pendientes si el usuario está desconectado y se reentregan al conectarse.
- Solo el autor o un admin pueden editar o eliminar una nota. Todo queda en la actividad del lead.
- **Centro de notificaciones** (campana): historial persistente con contador de pendientes, filtros todas/no leídas, paginación, marcar una o todas.

### 2.13 Mensajes programados
**Confianza: PROBABLE** (`routers/scheduled_messages.py`, `scheduled_message_service.py`, tabla `scheduled_messages`, `ScheduledMessageCard.tsx`).

Programar un texto para una fecha y hora futuras desde el panel del lead; cancelable mientras siga programado. Al vencer, el worker **comprueba la ventana de 24 h** antes de enviar. Estados visibles: programado / enviándose / enviado / falló.

### 2.14 Usuarios, roles y seguridad de acceso
**Nombre en el producto:** `Configuración → Usuarios`; y el escudo **"Acceso y seguridad"**.
**Confianza: CONFIRMADO** (captura 2 muestra la pestaña Usuarios + `routers/users.py`, `auth_service.py`, `session_service.py`, `UsersPanel.tsx`, `AccountSecurityDialog.tsx`).

- **Exactamente dos roles: `admin` y `vendedor`.** No hay más granularidad.
  - **Admin**: todo, incluidos Dashboard, Automatizaciones, Plantillas, Archivos, Catálogos, Configuración y alta de usuarios.
  - **Vendedor**: Chats, Kanban, Tareas, Reportes. No ve Dashboard, ni Plantillas (gestión), ni Automatizaciones, ni Configuración.
- El primer admin se siembra por variables de entorno al arrancar; desde ahí el admin da de alta al resto.
- Login con **"Recordar este dispositivo"**. Sesión con renovación por actividad **30 días**, máximo absoluto **90 días**, revocable **por dispositivo**.
- **PIN de 4 dígitos** por usuario: solo funciona junto con el token secreto de ese navegador, se bloquea temporalmente tras 5 intentos fallidos, y **nunca reemplaza la contraseña** para registrar un dispositivo nuevo.
- Restablecer contraseña o desactivar un usuario **revoca todas sus sesiones y dispositivos**.
- Los secretos guardados en la app (tokens, API keys) se cifran con **AES-GCM** y quedan enmascarados en la API.

### 2.15 Configuración
**Nombre en el producto:** `Configuración`, con pestañas **Claves · WhatsApp · Usuarios**.
**Confianza: CONFIRMADO** (captura 2). **Solo admin.**

- **Claves**: credenciales de los servicios externos (n8n, Evolution API, ElevenLabs) editables desde la app; lo guardado en la UI tiene prioridad sobre el archivo de entorno. Además, ajustes de negocio: **código de país por defecto**, **"Asignar leads de WhatsApp por turnos (round robin)"** y **"Cerrar la conversación tras N horas sin mensajes"**.
- **WhatsApp**: ver §3.
- **Usuarios**: alta, edición, rol y activación/desactivación.

### 2.16 Reportes de problemas
**Nombre en el producto:** `Reportes` (ícono de bicho). **Confianza: PROBABLE** (`IssueReportsPage.tsx`, `routers/issue_reports.py`, tablas `issue_reports*`; visible como ícono en la barra de las capturas).

**Ojo, no es un módulo de reportes analíticos.** Es un sistema interno de reporte de incidencias: cualquier usuario abre un reporte con adjuntos desde el ícono de bicho, con estados (nuevo / en revisión / falta info / resuelto), prioridad (baja / normal / alta / crítica), comentarios e historial de eventos. **No usar la palabra "Reportes" en la web comercial con sentido de analítica.**

### 2.17 Aplicación instalable y notificaciones push
**Confianza: PROBABLE** (`vite-plugin-pwa` configurado, `manifest.webmanifest`, iconos, `public/push-sw.js`, `routers/push.py`, `push_service.py` con VAPID, `PwaUpdatePrompt.tsx`, `MobileNavBar.tsx`).

- **PWA instalable** con service worker y aviso de actualización.
- **Diseño responsive con barra de navegación inferior en móvil** (las principales entran en la barra; el resto detrás de "Más").
- **Notificaciones Web Push** con VAPID, además de las notificaciones del navegador para menciones.

### 2.18 Módulos que NO existen en este producto
No encontré, en ningún punto del código: historia clínica / historial médico, fotos antes-después, paquetes de sesiones, facturación, pagos, comisiones, agenda de citas con calendario, ni gestión de pacientes. **Todo eso pertenece al otro producto** (`/Users/alangeronimo/dermicapro`), que no es el de las capturas. Ver §9.

Matices verificados que sí existen y pueden confundirse con lo anterior:
- El lead tiene un campo **`proxima_cita`** y un **`contador_noshow`**, y hay un tipo de tarea **"Cita"** y un botón **"marcar no-show"**. Es seguimiento comercial de citas, **no una agenda**.
- El CRM entiende los **pedidos y solicitudes de pago de WhatsApp Flow / WhatsApp Business** que llegan por el chat (tarjeta de pedido y modal de detalle con cantidad, subtotal, moneda y estado de pago) — `FlowOrderDetailDialog.tsx`, migración `b6e2d9a41f73_productos_y_pagos_de_whatsapp`. Es **lectura del pedido que arma WhatsApp**, no un módulo de facturación propio.

---

## 3. Integración con WhatsApp (crítico para el copy)

**Confianza: CONFIRMADO** — captura 2 + `backend/routers/whatsapp.py`, `backend/services/evolution_service.py`, `frontend/src/components/WhatsappPanel.tsx`.

### Cómo funciona exactamente

El CRM **no habla directo con Meta**. Habla con **Evolution API**, un gateway de WhatsApp autoalojado, configurado con tres datos: URL, API key y **nombre de instancia** (en la captura, la instancia se llama `dermicapro`).

La vinculación por defecto es **como dispositivo, escaneando un QR**, exactamente igual que WhatsApp Web:
- El panel pide el QR a Evolution y **lo refresca solo cada ~20 s** para que no expire en pantalla; también ofrece **código de emparejamiento** como alternativa al QR.
- Al quedar vinculado muestra **"WhatsApp vinculado"** y el texto literal:
  > *"Vinculado como dispositivo (tu teléfono sigue siendo el principal). Desvincular no borra ningún chat."*
- **"Desvincular"** corta la recepción de mensajes nuevos hasta volver a escanear; con confirmación explícita y **sin borrar los chats guardados**.

### Respuesta a la objeción "¿tengo que cambiar mi número?"

**No.** Se usa el mismo número de WhatsApp que ya tiene el negocio, vinculando el CRM como un dispositivo más. El teléfono sigue siendo el principal, y lo que el equipo escribe **desde el teléfono también aparece en el CRM** — hay un webhook (`/api/webhooks/outgoing`) que reconcilia los mensajes salientes "externos" (escritos desde el celular u otra herramienta) y hasta cierra las tareas de respuesta correspondientes. También sincroniza la lectura: si alguien lee el chat desde WhatsApp Web, el CRM lo refleja.

Además, **el historial anterior no se pierde**: los mensajes previos a la instalación se leen directamente de WhatsApp y se muestran en el hilo (solo lectura).

### Multi-usuario sobre un mismo número
**Sí, y es el caso de uso central.** Un solo número / una sola instancia, y N usuarios del CRM (admin + vendedores) atendiendo la misma bandeja, con: leads asignados a un vendedor (`vendedor_id`), pestaña "Mis leads", filtro por vendedor, reparto automático round-robin de leads nuevos, notas internas con menciones, y tiempo real por WebSocket para que no se pisen.

### Multi-instancia
**NO, hoy no.** La instancia es **una sola, global**, guardada como un único valor de configuración (`evolution_instance` en `app_settings`). La tabla `whatsapp_identities` sí lleva una columna `instance` (preparación técnica y desambiguación de identidades), pero **no hay UI ni lógica para operar dos números en paralelo**. Un despliegue = un número de WhatsApp.

### API oficial de Meta: soportada, pero condicionada
El código **detecta** el tipo de integración de la instancia de Evolution:
- `WHATSAPP-BAILEYS` → vinculación por QR (lo que está en producción hoy). El envío de **plantillas oficiales de Meta está bloqueado**, con el motivo explicado en pantalla.
- `WHATSAPP-BUSINESS` (Meta Cloud API) → habilita el envío de plantillas oficiales vía `message/sendTemplate`.

**Implicación comercial directa:** con vinculación por QR **no se puede reabrir una conversación fuera de la ventana de 24 h**, porque eso requiere plantilla oficial aprobada por Meta. El producto lo administra y lo explica, pero no lo puede enviar. **No prometer "recuperá conversaciones frías con plantillas" sin aclarar que requiere API oficial de Meta.**

### La pieza que hay que decir en voz alta: dependencia de n8n
La **ingesta de mensajes entrantes no la hace el CRM**: la hace un workflow externo de **n8n**, que recibe los eventos de Evolution API e **inserta las filas en PostgreSQL** y llama a los webhooks del CRM. El CRM tiene un `chat_watcher` que hace polling cada 60 s como respaldo por si el webhook falla. Varias funciones dependen de que ese workflow mapee campos concretos (`wa_message_id`, `contextInfo.stanzaId`, etc.). Hay documentos de plan para migrar la ingesta a **RabbitMQ** (`docs/rabbitmq-ingesta-n8n-plan.md`) — es **plan, no está construido**.

Esto significa que **hoy el producto no se instala solo**: requiere Evolution API + n8n + PostgreSQL desplegados y un workflow de n8n configurado. Ver §9.

---

## 4. Capacidades de IA

**Confianza: CONFIRMADO** para lo que hace; el motor de generación es externo.

### 4.1 Sugerencias de respuesta — asistida, nunca automática
**Nombres en pantalla (exactos):** panel lateral **"Sugerencias" / "SUGERENCIAS IA"**; encabezado **"Sugerencias con IA — Cuando lo necesites, la IA analiza la conversación y te propone respuestas para este lead."**; botones **"Orientá a la IA (opcional)"** y **"Generá sugerencias"** ("Tarda unos segundos"). Al regenerar: **"Generá otras"**.

- **Es a demanda y humano-en-el-medio.** El código lo dice explícitamente: *"Única vía que llama a la IA: CTA 'Generá sugerencias'"*. La IA **nunca envía sola**: propone, el vendedor elige, edita si quiere y envía.
- **"Orientá a la IA"**: el vendedor escribe una indicación libre ("dar precio", "no dar precio", "está interesado en Hollywood Peel") que el workflow inyecta en el prompt **como sección de máxima prioridad**, por encima de las reglas generales.
- **Sobre qué datos**: la conversación del lead. La respuesta que devuelve el modelo tiene estructura fija: `analisis` (lectura de la conversación), `confianza`, `tipo_objecion`, **`senal_compra`** (booleano), `alerta`, y una lista de **sugerencias** donde cada una trae `tactica`, `canal`, `texto`, `adjuntos` sugeridos y **`porque`** (la justificación de por qué proponerla). Opcionalmente puede devolver una **etapa** para el lead, que se aplica al Kanban registrando en el historial la **confianza y el motivo** de la decisión del agente.
- **Caché con detección de obsolescencia**: la sugerencia generada se guarda en el lead; al abrir el chat se muestra gratis, y si el cliente escribió después, se marca como **desactualizada** en lugar de regenerar sola (control de costo).

### 4.2 Análisis IA de multimedia
**Nombre en pantalla:** desplegable **"Análisis IA"** debajo de la burbuja de una foto, video, audio o documento (visible en la captura 1).

- Para cada adjunto se guarda un enriquecimiento con IA: **descripción** de imagen/video, **transcripción** de audio, **OCR** de documento — con el modelo usado y la fecha. Va **separado del texto del mensaje**, plegado por defecto, y se puede regenerar sin pisar el caption.
- **Y esto es lo potente:** ese análisis es **accionable dentro de los flujos**. La condición **"Descripción del archivo contiene"** permite ramificar un flujo según lo que el archivo *contiene* — por ejemplo, distinguir una **foto de rostro** de un **comprobante de pago**, algo imposible con reglas de texto. El comentario en el código lo dice tal cual.

### 4.3 Voz sintética (texto a voz)
**Confianza: PROBABLE** (`routers/tts.py`, `tts_service.py`, `AudioSuggestionDialog.tsx`, integración **ElevenLabs** configurable desde la app con voz, modelo, estabilidad, estilo, velocidad y speaker boost).

Convierte un texto (típicamente una sugerencia) en una **nota de voz** que se manda por WhatsApp. Hay además una acción de flujo **"Enviar audio"**.

### 4.4 Agente analista que enriquece el lead
**Confianza: PROBABLE** (webhooks `/api/webhooks/lead-stage`, `/lead-touch`, `/analysis` + comentarios explícitos en `webhooks.py`).

Un agente en n8n escribe **nombre, teléfono, notas y servicio de interés** del lead directamente, y avisa al CRM para que los paneles abiertos se refresquen. También puede decidir la etapa del lead con razonamiento.

### 4.5 Lo que hay que decir con precisión
**El modelo de IA no vive dentro del producto.** Toda la generación ocurre en un **workflow externo de n8n** al que el CRM le pega por webhook (`services/n8n_service.py`, con 3 reintentos). El CRM aporta: los datos, la orquestación, el caché, la estructura de la respuesta, la UI y — lo más valioso — el **enganche del análisis con el motor de flujos**. No hay proveedor de LLM configurado dentro de la app. En la web: hablar de "IA que analiza y sugiere", **no** de "nuestro modelo".

---

## 5. Modelo de datos en alto nivel

**Confianza: CONFIRMADO** (`backend/db/models.py`, 28 tablas).

**Entidad central: `Lead`** (identidad estable con UUID propio del CRM).

```
Lead  ──1:N──  WhatsAppIdentity   (alias @s.whatsapp.net / @lid del mismo contacto)
      ──1:N──  WspMessage         (mensajes; tipo, adjunto, análisis IA, estado de entrega,
      │                            reacciones, cita/quoted, editado, borrado lógico)
      │            └──1:1── MessageOutbox   (cola durable de envío)
      ──1:N──  ScheduledMessage
      ──1:N──  LeadTask           (tareas / próxima acción)
      ──1:N──  LeadNote           ──1:N── LeadNoteMention ──> User
      ──1:N──  LeadActivity       (auditoría: quién cambió qué, valor anterior y nuevo)
      ──N:M──  LeadTag            (vía LeadTagAssignment)
      ──N:1──  User               (vendedor asignado)
      ──1:N──  AutomationExecution
```

Catálogos y configuración: `LeadService` (servicios), `LeadTag` (etiquetas), `TemplateCategory`, `MessageTemplate` ──1:N── `TemplateAttachment` ──N:1── `MediaAsset` (biblioteca de archivos), `TemplateUserState` (favoritos y uso por usuario), `AppSetting` (claves cifradas).

Automatización: `AutomationRule` (una regla simple **o** un flujo visual; guarda borrador y publicado) ──1:N── `AutomationFlowVersion` (una fila por versión publicada) ; `AutomationRoundRobinState` (turno por bloque) ; `AutomationExecution` (con estado, reintentos, pausa y `flow_state` para retomar donde quedó).

Identidad y acceso: `User` (rol admin | vendedor) ──1:N── `AuthSession`, `TrustedDevice`, `PushSubscription`, `UserNotification`.

Soporte: `IssueReport` ──1:N── `IssueReportAttachment` / `IssueReportComment` / `IssueReportEvent`.

**Tres decisiones de diseño que valen como argumento técnico:**
1. **El lead tiene identidad propia (UUID), independiente de WhatsApp.** Los identificadores de WhatsApp (JID telefónico y **LID privado**) viven aparte, en `whatsapp_identities`. Es lo que evita que el mismo contacto se parta en dos leads cuando WhatsApp cambia de forma de direccionarlo — un problema real y muy visible en herramientas más simples.
2. **Los mensajes salientes pasan por una outbox durable**: la petición HTTP responde sin esperar a WhatsApp, un worker envía en segundo plano **conservando el orden por chat**, con hasta 3 intentos antes de marcar el mensaje como fallido, y el trabajo sobrevive a un reinicio del backend.
3. **Borrado lógico** de mensajes: el rastro queda para auditoría del CRM aunque el contenido deje de servirse.

---

## 6. Terminología del producto (glosario obligatorio para la web)

La web tiene que hablar exactamente igual que el producto. Estas son las palabras literales de la UI:

| Concepto | El producto dice | NO decir |
|---|---|---|
| La persona que escribe | **Lead** (la lista se titula "Leads"; el panel, "FICHA DEL LEAD" / "DATOS DEL LEAD") | paciente, cliente, contacto |
| El usuario que atiende | **Vendedor** (rol `vendedor`); "Mis leads" | asesor, agente, operador |
| El usuario con todo | **Admin** | dueño, manager, supervisor |
| Columna del embudo | **Etapa** (Nuevo, En diagnóstico, Calificado, Oferta presentada, En objeción, Agendado, Cliente activo, Postventa, En seguimiento, En nutrición, Perdido, Descalificado, Baja) | estado del cliente, fase, status |
| La vista del embudo | **Kanban** | pipeline, board, tablero |
| Marca de clasificación | **Etiqueta** | tag, label |
| Automatización | El módulo es **Automatizaciones**; la unidad es un **Flujo** ("Flujo #4 · publicado v10"); el modo simple, **regla** | workflow, secuencia, bot, campaña |
| Respuesta guardada | **Plantilla** (internas del CRM vs. **oficiales de Meta**) | snippet, canned response, mensaje rápido |
| Biblioteca de medios | **Archivos** | media library, galería |
| Catálogos administrables | **Catálogos** → Servicios / Etiquetas / Categorías de plantillas | configuración de listas |
| Recordatorio de seguimiento | **Tarea**; en la ficha, **"Próxima acción"** | recordatorio, to-do, actividad |
| Mensaje que no sale del CRM | **Nota interna** ("Cambiar a nota interna") | comentario, nota privada |
| Plazo de WhatsApp | **Ventana de atención**; en pantalla, **"Quedan Xh Ym para responder"** | ventana de 24h de Meta, SLA |
| IA | **Sugerencias IA** / **Sugerencias con IA**; **Análisis IA** (en adjuntos); **"Orientá a la IA"**, **"Generá sugerencias"** | copiloto, asistente virtual, chatbot |
| Conectar WhatsApp | **Vincular** / **Desvincular**; "WhatsApp vinculado"; **Instancia** | conectar cuenta, integrar, sincronizar |
| Métricas | **Dashboard CRM** — "Atención, seguimiento y distribución de leads" | analytics, reportes, BI |
| Incidencias internas | **Reportes** (¡es reporte de problemas, no analítica!) | informes |
| Reparto de leads | **Round robin** — "Reparte los leads por turnos" | asignación automática, distribución |

**Voz del producto:** español rioplatense en los CTA de IA ("Orientá", "Generá") pero neutro/peruano en el resto ("Completá", "Escribe un mensaje…"). Es tuteo/voseo informal, cercano, con emoji en los mensajes del negocio. La web debería sostener ese registro cercano y directo, sin corporativismo.

---

## 7. Multi-tenancy: honestidad total

**Confianza: CONFIRMADO — hoy el producto es SINGLE-TENANT. Instancia única, un cliente por despliegue.**

Evidencia dura:
- **Cero ocurrencias** de `tenant`, `organization`, `org_id`, `workspace` o `subdomain` en todo el código de backend (modelos, routers, servicios) y frontend. No es que esté a medias: **no existe**.
- Existe `docs/multi-tenant-saas-plan.md`, cuya primera línea dice literalmente: *"Estado: propuesta para revisión. **No se ha tocado código de producto todavía.**"*
- Ese mismo documento enumera el punto de partida: datos en un pool único sin dueño; configuración global (una sola instancia de Evolution, un solo n8n, un solo ElevenLabs, una fila por clave en `app_settings`); usuarios con roles pero **todos ven los mismos datos**; el WebSocket hace **broadcast a todos los clientes conectados**; y los workers (chat_watcher, automatizaciones, recordatorios, outbox, programados) **recorren toda la base sin noción de organización**.
- Hay una rama `feature/multi-tenant` **en el otro repositorio** (el sistema de clínica), no en este.

**Qué sí está listo como ladrillo:** el `Lead` ya tiene **identidad interna UUID** (no la PK basada en el número de WhatsApp), que era el prerrequisito estructural más caro. Y el flujo de vinculación por QR es exactamente el onboarding que necesitaría un SaaS.

**Qué falta según el propio plan:** tabla `organizations`, `organization_id` en ~14 tablas de negocio, aislamiento en cada consulta, configuración de Evolution/n8n por organización, WebSocket segmentado por organización, y workers conscientes del tenant.

### Implicación comercial (no negociable)
**Hoy no se puede vender como SaaS multi-cliente autoservicio.** El modelo vendible hoy es:
- **Instalación dedicada por cliente** (un despliegue, una base, un número de WhatsApp) — implantación asistida, precio de setup + mensualidad de operación. Esto es perfectamente vendible y es lo que ya funciona en producción.
- La web puede vender "tu CRM", "tu WhatsApp", "tu equipo" — **no** "creá tu cuenta y empezá gratis", **no** "registrate en 2 minutos", **no** onboarding self-service. No debería haber un botón "Sign up" que prometa una cuenta instantánea.

---

## 8. Los 8 argumentos de venta más fuertes

Ordenados por potencia comercial. Cada uno con la evidencia que lo respalda.

**1. No cambiás de número, ni perdés tu historial, ni dejás de usar tu teléfono.**
Se vincula el WhatsApp que ya usás escaneando un QR, como WhatsApp Web; el teléfono sigue siendo el principal, lo que se escribe desde el celular también aparece en el CRM, y el historial anterior se ve en el hilo.
*Evidencia:* captura 2 (texto literal "Vinculado como dispositivo (tu teléfono sigue siendo el principal). Desvincular no borra ningún chat."), `WhatsappPanel.tsx`, webhook `/api/webhooks/outgoing` que reconcilia mensajes escritos desde el teléfono, `services/whatsapp_history.py`.
*Por qué es el #1:* elimina de un plumazo la objeción que mata la mayoría de las ventas de CRM-sobre-WhatsApp.

**2. Todo el equipo sobre un mismo número, sin pisarse.**
Bandeja compartida con asignación de vendedor, "Mis leads", filtro por vendedor, reparto automático por turnos, notas internas con menciones @, y actualización en tiempo real.
*Evidencia:* `ChatList.tsx` (pestañas Todos / No leídos / Mis leads), `lead_assignment.py` (round robin autocorrectivo), `routers/internal_notes.py`, `ws_manager.py`, captura 1.

**3. Constructor visual de flujos: dibujás la conversación y el sistema la ejecuta.**
Lienzo de arrastrar y soltar con Condición, Acción, Pregunta con botones, Pausa condicional, Invocar flujo, Round robin y Fin; 14 tipos de acción; 11 tipos de condición; versionado con borrador/publicado/restaurar; simulador "Probar"; importación desde JSON.
*Evidencia:* captura 5 ("HIFU 12D · Flujo #4 · publicado v10"), `VisualFlowBuilder.tsx`, `domain/automationCatalog.ts`, `routers/automations.py`, tablas `automation_*`.

**4. La IA lee las fotos y los audios del cliente — y los flujos pueden decidir con eso.**
Cada adjunto se describe, transcribe o pasa por OCR, y existe la condición de flujo **"Descripción del archivo contiene"**, que permite distinguir, por ejemplo, una foto de rostro de un comprobante de pago, y ramificar la conversación.
*Evidencia:* `WspMessage.analysis` en `db/models.py`, `FlowConditionType.MEDIA_ANALYSIS_CONTAINS` en `domain_types.py` (con el comentario que da ese ejemplo exacto), "Análisis IA" en la captura 1.
*Por qué pega:* es la capacidad que casi ninguna herramienta del mercado tiene y que es dificilísima de replicar con reglas de texto.

**5. Sugerencias de respuesta con la última palabra siempre humana.**
La IA analiza la conversación y propone respuestas con su justificación; el vendedor puede orientarla con una instrucción libre ("no dar precio") antes de generar. Nunca envía sola.
*Evidencia:* captura 3, `SuggestionPanel.tsx`, `SuggestionInstructionBox.tsx`, comentario en `App.tsx` ("Única vía que llama a la IA: CTA 'Generá sugerencias'"), esquema `SuggestionResponse` con `porque`, `senal_compra`, `tipo_objecion`, `confianza`.

**6. El contador de 24 horas que evita que se te caigan las conversaciones.**
Cuenta regresiva por chat que cambia de color, candado en la lista para las ventanas cerradas, y bloqueo real de los envíos que WhatsApp rechazaría — validado en el backend, no solo en la pantalla.
*Evidencia:* capturas 1, 2 y 3 ("Quedan 20h 29m para responder"), `CustomerServiceWindowStatus.tsx`, revalidación en cada ruta de envío en `routers/chats.py`.

**7. Dashboard que mide lo único que mueve la aguja: velocidad de respuesta y seguimiento.**
Leads totales y nuevos, **esperando respuesta**, **tareas vencidas**, tareas completadas, **respuesta promedio en horas**, tendencia diaria, y distribución por etapa, vendedor, origen y servicio, con rangos de 7/30/90 días.
*Evidencia:* captura 4 (2.527 leads totales, 3,2 h de respuesta promedio en un caso real), `dashboard_service.py`.

**8. Ingeniería de operación seria para algo que corre sobre WhatsApp.**
Freno de ejecuciones por hora para no arriesgar el número, cola de envío durable con orden garantizado y reintentos, versionado de flujos donde una ejecución en curso termina con la versión con la que arrancó, fusión de leads duplicados, resolución de identidades LID de WhatsApp, secretos cifrados con AES-GCM, sesiones revocables por dispositivo con PIN, despliegue blue-green sin corte, backups verificados, y stack de observabilidad (Prometheus, Grafana, Loki, Alertmanager).
*Evidencia:* `max_executions_per_hour`, `message_outbox.py`, `automation_flow_versions`, `lead_merge.py`, `whatsapp_identity_service.py`, `secret_cipher.py`, `session_service.py`, `scripts/deploy-bluegreen.sh`, `monitoring/`, 78 archivos de test en el backend.
*Cómo usarlo:* no como bullet técnico, sino como prueba de que el producto no es un prototipo. Traducir a: "pensado para no quemar tu número y para no perder un solo mensaje".

---

## 9. Vacíos y riesgos — qué NO prometer

### 9.1 Vacíos frente a competidores (Kommo, Chatwoot, ManyChat, Callbell, Respond.io)

| Vacío | Detalle | Impacto |
|---|---|---|
| **No es SaaS multi-tenant** | Ver §7. No hay registro autoservicio ni aislamiento por organización. | Alto — define el modelo de negocio |
| **Un solo canal: WhatsApp** | No hay Instagram DM, Messenger, correo, SMS ni webchat. `whatsapp_identities` solo contempla JID y LID de WhatsApp. | Alto en el segmento que ya vende por Instagram |
| **Un solo número por despliegue** | La instancia de Evolution es un valor global de configuración. | Medio — bloquea clínicas multi-sede |
| **Etapas del embudo no configurables** | Las 13 etapas son un `ENUM` de PostgreSQL con nombres muy específicos del vertical estético/salud (En diagnóstico, En nutrición, Postventa). Cambiarlas requiere migración de base de datos. | Medio-alto — encanta al vertical, complica salir de él |
| **Roles solo admin/vendedor** | Sin supervisor, sin permisos por módulo, sin equipos. | Medio en clientes de más de ~10 personas |
| **Sin API pública ni webhooks salientes documentados para el cliente** | Los webhooks existentes son de entrada, para n8n. | Medio |
| **Sin exportación de datos desde la UI** | No encontré CSV/Excel/PDF en ningún módulo. Los backups son por script del servidor. | Medio — es una pregunta frecuente en demos |
| **Sin campos personalizados en el lead** | Los campos son fijos en el modelo. | Medio |
| **Sin analítica de conversión ni de ingresos** | El dashboard mide actividad y velocidad, no ventas cerradas ni facturación. No hay concepto de valor/monto del negocio. | Medio-alto — es lo primero que pregunta un dueño |
| **Instalación no autoservicio** | Requiere PostgreSQL, Evolution API, **n8n con un workflow configurado**, y opcionalmente MinIO y el stack de monitoreo. Varias funciones dependen de mapeos específicos en n8n. | Alto para el costo de venta |
| **La IA depende de un servicio externo** | Sin n8n configurado, el panel de sugerencias y el análisis de multimedia no funcionan. | Medio |
| **Plantillas oficiales bloqueadas con vinculación por QR** | Ver §3. Con Baileys no se puede reabrir una conversación fuera de las 24 h. | Alto — limita el remarketing |
| **Sin app móvil nativa** | Hay PWA instalable y navegación móvil, que cubre bastante, pero no hay app en las tiendas. | Bajo-medio |

### 9.2 Lo que NO se debe prometer en la web

**Prohibido decir (falso o no verificable):**
- ❌ "Historia clínica", "fotos antes y después", "gestión de pacientes", "paquetes de sesiones", "facturación", "pagos", "comisiones", "agenda con calendario". **Nada de esto existe en este producto** — pertenece al otro sistema de la misma marca. Es el riesgo #1 de este proyecto, porque los `.md` de ese otro repositorio son muy convincentes y describen todas esas funciones con detalle.
- ❌ "Registrate gratis", "probalo en 2 minutos", "creá tu cuenta", cualquier free trial autoservicio. No hay multi-tenancy (§7).
- ❌ "Multicanal", "Instagram", "Messenger", "todos tus canales en un lugar".
- ❌ "API oficial de WhatsApp Business" a secas. Es soportada pero **no es lo que corre hoy**; hoy es vinculación por QR. Si se menciona, decir "compatible con API oficial de Meta (opcional)".
- ❌ "Recuperá conversaciones frías / reactivá clientes inactivos con plantillas". Requiere plantilla oficial aprobada + integración WHATSAPP-BUSINESS.
- ❌ "La IA responde sola a tus clientes" / "chatbot con IA". La IA **sugiere**; el que responde solo es el **motor de flujos**, que es determinista (reglas y ramas), no generativo. Son dos cosas distintas y conviene no mezclarlas.
- ❌ "Nuestro modelo de IA" / "IA propietaria". El modelo es externo (workflow de n8n).
- ❌ "Exportá tus datos", "integrá con tu ERP", "conectá con Google Calendar", "reportes descargables". No existen.
- ❌ Cifras de rendimiento, SLA, uptime o cantidad de clientes. No hay nada que las respalde.
- ❌ Usar la palabra **"Reportes"** con sentido de analítica: en el producto es el módulo de reporte de incidencias.
- ❌ **Datos reales de las capturas.** Los números del dashboard (2.527 leads, 3,2 h) y cualquier nombre o teléfono de la lista de chats son de un cliente real. Si se muestran capturas en la web, hay que **censurar nombres y teléfonos** y usar datos de ejemplo inventados.

**Zona gris — decir con matiz:**
- ⚠️ "Nueva Cita": en las capturas aparece un ítem de navegación con ese nombre, entre "Tareas" y el ícono de reportes. **No existe en el código que revisé** (ni en `NAV_ITEMS`, ni en ningún commit de ninguna rama). El checkout local es del 27/08 y las capturas del 31/08, así que probablemente sea una función publicada en esos 4 días. **Confianza: NO VERIFICADO.** Hay que preguntarle al equipo de producto qué hace antes de escribir una sola línea sobre agendamiento de citas.
- ⚠️ "Pedidos y pagos de WhatsApp": el CRM **lee y muestra** los pedidos y solicitudes de pago que genera WhatsApp Business. No es un checkout ni una pasarela propia.
- ⚠️ "Atribución de anuncios": el CRM captura de qué anuncio **Click-to-WhatsApp** vino el lead y rehospeda la miniatura para que no expire (`ad_referral_service.py`, `AdReferralCard.tsx`). **Confianza: PROBABLE.** Es un argumento excelente para clínicas que pautan en Meta, pero verificar el alcance real antes de prometer "atribución de campañas".
- ⚠️ Todo lo marcado **PROBABLE** en §2 (Archivos, Catálogos, Mensajes programados, Reportes de problemas, PWA y push, TTS): está en el código de forma completa, pero conviene una demo de confirmación antes de darle protagonismo en la home.

---

## Apéndice — dónde está cada cosa

| Tema | Archivo |
|---|---|
| Producto real (CRM de las capturas) | `/Users/alangeronimo/wsp-suggestions-app` |
| Documentación operativa completa | `/Users/alangeronimo/wsp-suggestions-app/README.md` (547 líneas, muy fiable) |
| Plan multi-tenant (NO construido) | `/Users/alangeronimo/wsp-suggestions-app/docs/multi-tenant-saas-plan.md` |
| Modelo de datos | `/Users/alangeronimo/wsp-suggestions-app/backend/db/models.py` |
| Vocabulario de flujos y automatizaciones | `/Users/alangeronimo/wsp-suggestions-app/frontend/src/domain/automationCatalog.ts` |
| Etapas del embudo y sus etiquetas | `/Users/alangeronimo/wsp-suggestions-app/frontend/src/domain/leadStageMeta.ts` |
| Navegación y permisos por rol | `/Users/alangeronimo/wsp-suggestions-app/frontend/src/domain/navigation.ts` |
| Integración WhatsApp | `/Users/alangeronimo/wsp-suggestions-app/backend/services/evolution_service.py` y `frontend/src/components/WhatsappPanel.tsx` |
| Métricas del dashboard | `/Users/alangeronimo/wsp-suggestions-app/backend/services/dashboard_service.py` |
| IA (llamada al workflow externo) | `/Users/alangeronimo/wsp-suggestions-app/backend/services/n8n_service.py` |
| **Producto DISTINTO (gestión de clínica) — no usar para esta web** | `/Users/alangeronimo/dermicapro` |
