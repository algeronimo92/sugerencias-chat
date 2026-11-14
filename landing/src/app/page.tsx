import { ChatMock } from "@/components/chat-mock";
import { FlujoMock } from "@/components/flujo-mock";
import { FormularioSolicitud } from "@/components/formulario-solicitud";
import { SeccionPaquetes } from "@/components/paquetes";
import { Seccion, Cejilla, Boton, Tarjeta } from "@/components/secciones";
import {
  IconoChat, IconoReloj, IconoIA, IconoKanban, IconoTarea,
  IconoPlantilla, IconoGrafico, IconoCalendario, IconoNota, IconoEquipo,
  IconoEscudo, IconoBusqueda, IconoTelefono,
} from "@/components/iconos";
import { CTA_TEXTO, CTA_SUBTEXTO } from "@/textos";

export default function Home() {
  return (
    <main id="inicio" className="flex-1">
      {/* -------------------------------------------------------------- HERO */}
      <Seccion className="!pt-14 sm:!pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-caption text-text-muted">
              <span className="h-2 w-2 rounded-full bg-success-solid" />
              Para clínicas, spas y centros médicos
            </p>
            <h1 className="text-display-2">
              <span className="block">Se usa como WhatsApp.</span>
              <span className="block text-accent-strong">Vende como un CRM.</span>
            </h1>
            <p className="text-lead mt-6 max-w-xl text-text-muted">
              Tu equipo ya vende por WhatsApp. CliniVentas ordena esas conversaciones
              en un CRM de verdad: sin cambiar de número, sin migrar chats y sin
              pedirle a tu recepcionista que aprenda un programa nuevo.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Boton href="#acceso">{CTA_TEXTO}</Boton>
              <Boton href="#producto" variante="secundario">Ver cómo funciona</Boton>
            </div>
            <p className="mt-4 text-caption text-text-subtle">{CTA_SUBTEXTO}</p>
          </div>
          <ChatMock />
        </div>
      </Seccion>

      {/* ----------------------------------------------------------- PROBLEMA */}
      <Seccion className="border-y border-border bg-surface">
        <div className="columna-lectura text-center">
          <Cejilla>El problema</Cejilla>
          <h2 className="text-h1">
            El celular del negocio lo tiene una sola persona
          </h2>
          <p className="text-lead mt-5 text-text-muted">
            Y con él se va toda la información del negocio.
          </p>
        </div>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Se pierden mensajes", "Entran 40 consultas al día. Alguien contesta 25. Nadie sabe cuáles quedaron sin responder."],
            ["No hay seguimiento", "El que preguntó el precio y no volvió a escribir simplemente desaparece. Nadie lo llama."],
            ["La agenda vive aparte", "Las citas están en un cuaderno o en otro calendario. Confirmarlas es volver a escribir todo a mano."],
            ["No hay números", "Al cierre de mes nadie sabe cuántos consultaron, cuántos agendaron ni de dónde vinieron."],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border border-border bg-bg p-6">
              <h3 className="text-h4 mb-2">{t}</h3>
              <p className="text-body-sm text-text-muted">{d}</p>
            </li>
          ))}
        </ul>
      </Seccion>

      {/* ---------------------------------------------------------- PRODUCTO */}
      <Seccion id="producto">
        <div className="columna-lectura text-center">
          <Cejilla>La bandeja compartida</Cejilla>
          <h2 className="text-h1">Tu mismo número, ahora con equipo</h2>
          <p className="text-lead mt-5 text-text-muted">
            CliniVentas se conecta a tu número de WhatsApp Business y convive con
            la aplicación de tu celular. Tu teléfono sigue funcionando igual y no
            se borra ni un solo chat.
          </p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Tarjeta titulo="No cambias de número" icono={<IconoTelefono />}>
            El número que ya está en tus volantes, tu Instagram y tu ficha de Google
            sigue siendo el mismo. Lo conectas desde tu propia aplicación WhatsApp
            Business, con un código, en un par de minutos.
          </Tarjeta>
          <Tarjeta titulo="Varios atienden a la vez" icono={<IconoEquipo />}>
            Recepción, la doctora y quien lleve el Instagram trabajan sobre el mismo
            número sin pelearse el celular. Cada conversación tiene responsable.
          </Tarjeta>
          <Tarjeta titulo="También desde tu celular" icono={<IconoChat />}>
            Celular y CRM conviven sobre el mismo número. Si respondes desde tu
            teléfono a las 9 de la noche, esa conversación aparece igual en el CRM.
            No hay dos historiales.
          </Tarjeta>
          <Tarjeta titulo="Notas internas" icono={<IconoNota />}>
            Deja contexto dentro del chat —«vino por la campaña», «pidió
            financiamiento»— que tu equipo ve y el paciente nunca.
          </Tarjeta>
          <Tarjeta titulo="Busca en todo el historial" icono={<IconoBusqueda />}>
            Encuentra cualquier conversación aunque la escribas sin tildes. Incluye
            los chats anteriores a la instalación.
          </Tarjeta>
          <Tarjeta titulo="Contador de 24 horas" icono={<IconoReloj />}>
            WhatsApp solo deja responder libremente durante 24 horas desde el último
            mensaje del paciente. Verás el tiempo que te queda en cada chat.
          </Tarjeta>
        </div>
      </Seccion>

      {/* ---------------------------------------------------- AUTOMATIZACION */}
      <Seccion id="automatizacion" className="border-y border-border bg-surface">
        <div className="columna-lectura text-center">
          <Cejilla>Automatizaciones</Cejilla>
          <h2 className="text-h1">
            El seguimiento que nadie alcanza a hacer, hecho solo
          </h2>
          <p className="text-lead mt-5 text-text-muted">
            Arrastras bloques al lienzo y dibujas el recorrido: preguntar con
            botones, esperar la respuesta, repartir el lead entre vendedores,
            crear la tarea. Lo guardas como borrador y lo publicas cuando esté.
          </p>
        </div>

        <div className="mt-12">
          <FlujoMock />
        </div>

        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Ramas de verdad", "Cada botón abre su propio camino, y una condición decide qué pasa según lo que el paciente contestó."],
            ["Reparto automático", "El round robin entrega los leads nuevos por turnos entre tu equipo. Se acabó el «yo pensé que lo atendías tú»."],
            ["Con versiones", "Guarda borrador, publica cuando esté listo y vuelve a la versión anterior si algo salió mal."],
            ["Pruébalo antes", "El simulador recorre el flujo completo sin escribirle a un paciente real, y un límite de envíos por hora cuida tu número."],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border border-border bg-bg p-6">
              <h3 className="text-h4 mb-2">{t}</h3>
              <p className="text-body-sm text-text-muted">{d}</p>
            </li>
          ))}
        </ul>
      </Seccion>

      {/* --------------------------------------------------------- MAS MODULOS */}
      <Seccion>
        <div className="columna-lectura text-center">
          <Cejilla>Todo lo demás</Cejilla>
          <h2 className="text-h1">Un solo lugar, de la consulta a la cita</h2>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Tarjeta titulo="Embudo por etapas" icono={<IconoKanban />}>
            Cada lead avanza de «Nuevo» a «Agendado» en un tablero. Si se pierde,
            queda registrado el motivo.
          </Tarjeta>
          <Tarjeta titulo="Tareas y recordatorios" icono={<IconoTarea />}>
            «Llamar el jueves», «confirmar la cita». Con prioridad y aviso, y se
            cierran solas cuando alguien responde.
          </Tarjeta>
          <Tarjeta titulo="Agenda de citas" icono={<IconoCalendario />}>
            Agenda desde la misma conversación, sin cambiar de pantalla ni copiar
            datos a otro calendario.
          </Tarjeta>
          <Tarjeta titulo="Plantillas" icono={<IconoPlantilla />}>
            Las respuestas de siempre —precios, indicaciones, ubicación— listas y
            con el nombre del paciente ya puesto.
          </Tarjeta>
          <Tarjeta titulo="Sugerencias con IA" icono={<IconoIA />}>
            Lee la conversación y propone la respuesta. Tú decides si la envías,
            la editas o la descartas.
          </Tarjeta>
          <Tarjeta titulo="Panel de control" icono={<IconoGrafico />}>
            Cuántos entraron, cuántos esperan respuesta y cuánto tardas en
            contestar. Por vendedor, etapa y origen.
          </Tarjeta>
        </div>
      </Seccion>

      {/* --------------------------------------------------------- PAQUETES */}
      <SeccionPaquetes />

      {/* -------------------------------------------------------- FUNDADOR */}
      <Seccion>
        <div className="columna-lectura">
          <Cejilla>Quiénes somos</Cejilla>
          <h2 className="text-h1">Lo construimos para nuestra propia clínica</h2>
          <div className="prosa mt-6 space-y-4 text-lead text-text-muted">
            <p>
              CliniVentas no nació en una oficina de software. Nació porque en
              nuestro propio centro estético se nos escapaban pacientes todos los
              días: entraban decenas de consultas por WhatsApp, el celular lo tenía
              una sola persona y al final del mes nadie sabía cuántas se habían
              convertido en cita.
            </p>
            <p>
              Probamos los CRM de siempre. El equipo no los abría. Eran lentos,
              estaban en inglés y pedían aprender una forma de trabajar que nadie
              tenía tiempo de aprender. Así que hicimos lo contrario: en vez de
              sacar al equipo de WhatsApp, metimos el CRM dentro de WhatsApp.
            </p>
            <p className="rounded-xl border-l-[3px] border-accent bg-accent-soft px-6 py-5 text-body text-text">
              <strong className="font-semibold">Somos nuevos y no lo vamos a esconder.</strong>{" "}
              Hoy CliniVentas funciona todos los días en nuestro propio centro, y
              estamos abriendo los primeros cupos a otras clínicas. Eso significa que
              vas a hablar directamente con quien construye el producto y que tus
              pedidos entran a la lista de verdad. Si prefieres un proveedor con mil
              clientes, todavía no somos nosotros.
            </p>
          </div>
        </div>
      </Seccion>

      {/* ------------------------------------------------------------- FAQ */}
      <Seccion id="preguntas" className="border-y border-border bg-surface">
        <div className="columna-lectura text-center">
          <Cejilla>Preguntas</Cejilla>
          <h2 className="text-h1">Lo que todos preguntan primero</h2>
        </div>
        <div className="columna-lectura mt-12 divide-y divide-border border-y border-border">
          {[
            ["¿Tengo que cambiar mi número de WhatsApp?",
             "No. CliniVentas se conecta a tu número actual de WhatsApp Business a través de la plataforma oficial de Meta, en la modalidad que Meta llama coexistencia: tu celular y el CRM trabajan sobre el mismo número a la vez. Si algún día te desconectas, lo haces desde tu propia aplicación y no se borra ningún chat."],
            ["¿Puedo seguir usando WhatsApp Business en mi celular?",
             "Sí, y es la idea. La aplicación del celular y el CRM conviven: lo que escribes desde el teléfono aparece en el CRM, y lo que tu equipo envía desde el CRM aparece en el teléfono. Al conectar, tú decides desde tu propio celular si compartes el historial de los últimos seis meses para que el CRM no empiece vacío. Eso sí: el teléfono debe seguir activo; si pasa unas dos semanas sin conectarse, WhatsApp corta la conexión hasta que la vuelvas a activar."],
            ["¿Mi recepcionista va a saber usarlo?",
             "Esa fue la idea desde el primer día. La pantalla principal es una lista de conversaciones con burbujas, palomitas y buscador: lo mismo que ya usa en su celular. La mayoría empieza a atender el mismo día, sin capacitación."],
            ["¿Varias personas pueden atender el mismo número a la vez?",
             "Sí, y es el uso más común. Recepción, la doctora y quien lleve las redes trabajan sobre el mismo número al mismo tiempo, cada uno con su usuario, y cada conversación queda asignada a alguien."],
            ["¿Qué pasa con lo que respondo desde mi celular?",
             "Entra igual al CRM. WhatsApp envía una copia de cada mensaje que mandas desde la aplicación, así que no terminas con dos historiales distintos: lo que escribes desde el teléfono y lo que escribe tu equipo desde la computadora viven en la misma conversación. Lo que no pasa al CRM son los grupos, los estados y las llamadas, que siguen solo en tu celular."],
            ["¿Qué es eso de la ventana de 24 horas?",
             "Es una regla de WhatsApp, no nuestra: puedes responder libremente durante las 24 horas siguientes al último mensaje del paciente. CliniVentas te muestra un contador en cada chat para que veas cuánto te queda y no se te enfríe nadie. Pasado ese plazo hay que esperar a que el paciente escriba de nuevo."],
            ["¿Y si quiero irme? ¿Me llevo mis datos?",
             "Sí. No hay permanencia ni penalidad. Descargas en Excel un respaldo completo de tus leads, citas, tareas y catálogo cuando quieras, en cualquier paquete. Desconectas el CRM desde tu propia aplicación WhatsApp Business y tus chats siguen intactos en tu teléfono, porque nunca dejaron de estar ahí."],
            ["¿Están seguros los datos de mis pacientes?",
             "Cada negocio trabaja sobre su propia base, con acceso por usuario y permisos por rol. Te decimos con transparencia lo que hay: tomamos en serio la seguridad, pero todavía no tenemos certificaciones formales de cumplimiento y no vamos a decir que sí para cerrar una venta."],
            ["¿La inteligencia artificial le responde sola a mis pacientes?",
             "No. La IA solo trabaja cuando alguien de tu equipo se lo pide: lee la conversación abierta y propone una o varias respuestas. Una persona decide si la envía, la edita o la descarta. El paciente nunca habla con la IA ni recibe un mensaje que no haya aprobado alguien de tu equipo."],
            ["¿Qué ve la IA y quién la provee?",
             "Ve la conversación sobre la que pides la sugerencia y los archivos que el paciente envió, cuando pides describirlos o transcribirlos. Nada más: ni tu base completa ni los datos de otros pacientes. Usamos proveedores externos a través de sus API empresariales y los listamos con nombre y país en nuestra política de tratamiento de datos."],
            ["¿Se entrenan modelos de IA con mis conversaciones?",
             "No. Ni nosotros ni nuestros proveedores. Contratamos sus API en la modalidad en la que el contenido no se usa para entrenar ni mejorar sus modelos, y las condiciones de WhatsApp Business lo prohíben expresamente. El proveedor conserva la solicitud un tiempo limitado para detectar abusos y después la elimina."],
            ["¿Me ayuda a optimizar mis anuncios de Meta?",
             "Sí. Cuando un paciente llega desde un anuncio de Facebook o Instagram que abre WhatsApp y termina agendando o comprando, CliniVentas se lo avisa a Meta a través de su API de conversiones. Así Meta aprende qué anuncios traen pacientes que de verdad agendan, y no solo clics. A Meta le llega el tipo de evento, la fecha, el importe si hubo venta y el identificador del clic que Meta mismo generó: nunca el contenido de la conversación, el teléfono del paciente ni el tratamiento que consultó o compró. Viene apagado: se enciende solo si tú lo autorizas."],
            ["¿Puedo usar CliniVentas sin IA?",
             "Sí. Si prefieres que tu equipo trabaje sin sugerencias ni análisis de archivos, lo desactivamos en tu cuenta. El resto del producto funciona exactamente igual."],
            ["¿Sirve si no soy una clínica?",
             "Sí. Está pensado para cualquier negocio que atienda clientes con cita y venda por WhatsApp: spas, centros estéticos, consultorios dentales, veterinarias, nutricionistas, fisioterapia o estudios de tatuajes."],
            ["¿Cuánto tarda la puesta en marcha?",
             "Conectas tu número desde la aplicación WhatsApp Business de tu celular, confirmas con un código y la bandeja empieza a funcionar; la sincronización del historial tarda unos minutos. Nosotros te acompañamos a dejar listos tus etapas, plantillas y primeras automatizaciones."],
            ["¿Funciona desde el celular?",
             "Sí, la interfaz se adapta al teléfono. Aun así, la mayoría de los equipos terminan atendiendo desde la computadora de recepción, porque tener todo el historial y la ficha del paciente en una pantalla grande es mucho más rápido."],
          ].map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-display text-[17px] font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
                {q}
                <span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border-strong text-text-muted transition-transform duration-[var(--duration-rapida)] ease-suave group-open:rotate-45">
                  <svg viewBox="0 0 12 12" aria-hidden="true" className="h-2.5 w-2.5">
                    <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
              </summary>
              <p className="mt-3 max-w-[62ch] text-body-sm text-text-muted">{a}</p>
            </details>
          ))}
        </div>
      </Seccion>

      {/* ------------------------------------------------------------ ACCESO */}
      <Seccion id="acceso">
        <div className="patron-conversacion overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-lg">
          {/* items-start: el formulario crece cuando aparecen las preguntas del
              paquete, y centrado empujaría el texto de la izquierda. */}
          <div className="grid gap-10 p-5 sm:p-12 lg:grid-cols-[1.1fr_1fr] lg:items-start lg:gap-14">
            <div>
              <h2 className="text-h1">Deja de perder pacientes en el chat</h2>
              <p className="text-lead mt-5 text-text-muted">
                Cuéntanos de tu negocio y del paquete que te interesa. Te enviamos la
                cotización por WhatsApp y te acompañamos en la puesta en marcha para
                que tu equipo esté atendiendo el mismo día.
              </p>
              <p className="mt-4 text-body-sm text-text-muted">
                ¿No sabes cuál elegir? Marca «Aún no lo sé» y te sugerimos uno según
                tu equipo.{" "}
                <a href="#comparar" className="font-medium text-accent-strong underline underline-offset-2">
                  Ver qué incluye cada paquete
                </a>
              </p>
              <ul className="mt-7 space-y-3 text-body-sm">
                {[
                  ["No cambias de número", <IconoTelefono key="t" />],
                  ["Sin permanencia, cancelas cuando quieras", <IconoEscudo key="e" />],
                  ["Garantía de 30 días", <IconoReloj key="r" />],
                ].map(([t, ic]) => (
                  <li key={String(t)} className="flex items-center gap-3 text-text-muted">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-strong">
                      {ic as React.ReactNode}
                    </span>
                    {t as string}
                  </li>
                ))}
              </ul>
            </div>

            <FormularioSolicitud />
          </div>
        </div>
      </Seccion>
    </main>
  );
}
