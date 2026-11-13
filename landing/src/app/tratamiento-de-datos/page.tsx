import type { Metadata } from "next";
import Link from "next/link";
import { PaginaLegal, Apartado, Nota, Tabla } from "@/components/legal";
import {
  EMPRESA, MARCO, SUBENCARGADOS_CRM, RETENCION_PROVEEDORES_IA,
} from "@/datos-legales";

export const metadata: Metadata = {
  title: "Política de tratamiento de datos personales",
  description:
    "Cómo trata CliniVentas los datos de los pacientes que las clínicas guardan en el CRM: qué papel tiene cada parte, qué pasa con los datos de salud, qué hace la inteligencia artificial, qué se comparte con Meta para los anuncios, quién accede, cómo se piden la eliminación y el ejercicio de derechos.",
  alternates: { canonical: "/tratamiento-de-datos" },
};

/*
 * Esta pagina es la que se declara como "Politica de privacidad" en el panel
 * de desarrollador de Meta (WhatsApp Business Platform). Lo que Meta exige
 * de ella (Meta Platform Terms, apartado 4; WhatsApp Business Messaging
 * Policy, apartado 3):
 *   - URL publica, sin login ni bloqueo geografico, la misma del panel.
 *   - Que diga QUE datos se tratan, COMO y PARA QUE.
 *   - Que explique COMO pedir la eliminacion de los datos (apartado 14,
 *     ancla fija #eliminacion, que es la "URL de eliminacion de datos").
 *   - Que no contradiga las condiciones de Meta ni prometa usos que estas
 *     prohiben (p. ej. entrenar modelos con datos de la plataforma, WhatsApp
 *     Business Terms 4.7).
 * Lo que se dice de la coexistencia (apartado 5) sale de la doc oficial de
 * Meta "Onboard WhatsApp Business app users" (Embedded Signup): 6 meses de
 * historial, adjuntos solo de 14 dias, sin grupos, eco de los mensajes del
 * celular, desconexion por ~14 dias de inactividad del telefono.
 * Lo de los eventos de conversion (apartado 8) sale de la doc de la
 * Conversions API for Business Messaging y de las Business Tools Terms
 * (vigentes 3 nov 2025): sin datos de salud, Meta conserva hasta 2 anos.
 * Si se cambia algo de lo que aqui se afirma sobre la IA o sobre WhatsApp,
 * revisar tambien las preguntas frecuentes de la portada (src/app/page.tsx).
 */

const PREGUNTAS = [
  [
    "¿La inteligencia artificial habla con mis pacientes?",
    "No. La IA no envía mensajes ni conversa con nadie. Redacta una propuesta de respuesta que solo ve el equipo de la clínica, y una persona decide si la envía, la cambia o la descarta. Lo que el paciente recibe lo escribió, o aprobó, una persona.",
  ],
  [
    "¿Qué información se envía a los proveedores de IA?",
    "La conversación del paciente que el vendedor tiene abierta cuando pide una sugerencia, y los archivos que el paciente envió cuando se pide describirlos o transcribirlos. No se envía la base de datos completa, ni los datos de otros pacientes, ni la información de facturación de la clínica.",
  ],
  [
    "¿Se entrenan modelos de IA con esas conversaciones?",
    "No. Ni nosotros ni los proveedores que usamos. Contratamos sus API en la modalidad empresarial, en la que el contenido no se usa para entrenar ni mejorar sus modelos, y las condiciones de la plataforma de WhatsApp prohíben expresamente ese uso.",
  ],
  [
    "¿Cuánto tiempo guarda el proveedor de IA lo que le enviamos?",
    `Lo necesario para procesar la solicitud y, como máximo, ${RETENCION_PROVEEDORES_IA} para detectar abusos, tras lo cual lo elimina. El resultado (la sugerencia o la descripción) se guarda en el CRM de la clínica, como cualquier otro dato de la conversación, y se borra con ella.`,
  ],
  [
    "¿Puede la IA tomar decisiones sobre un paciente?",
    "No toma decisiones con efectos sobre el paciente. Puede proponer una etapa del embudo comercial o una etiqueta, pero eso solo ordena el trabajo interno de la clínica, queda registrado con su motivo y el equipo puede corregirlo en un clic. No decide precios, diagnósticos, tratamientos ni si se atiende o no a alguien.",
  ],
  [
    "¿Puedo usar CliniVentas sin IA?",
    "Sí. La clínica puede pedir que desactivemos las sugerencias y el análisis de archivos en su cuenta. El resto del producto funciona igual.",
  ],
  [
    "¿Qué recibe Meta con los eventos de conversión?",
    "Solo que una conversación que empezó en un anuncio de Meta terminó en un contacto válido, una cita o una compra, con la fecha y el identificador del clic que Meta mismo generó. Nunca recibe el contenido de los mensajes, el nombre o el teléfono del paciente, ni el tratamiento consultado. La clínica puede pedir que la desactivemos.",
  ],
  [
    "¿La clínica puede seguir usando WhatsApp en su celular?",
    "Sí. Con la coexistencia de Meta, la aplicación WhatsApp Business del celular y el CRM trabajan sobre el mismo número a la vez. Lo que la clínica escribe desde el teléfono se refleja en el CRM y viceversa. La clínica autoriza la conexión y el envío del historial desde su propio teléfono, y puede desconectarla desde la aplicación cuando quiera sin perder ningún chat.",
  ],
  [
    "Soy paciente y quiero que borren mis datos. ¿A quién se lo pido?",
    "A la clínica con la que hablaste: es la responsable de tus datos y puede borrarte desde el propio CRM. Si no logras contactarla, escríbenos y te indicamos cómo seguir. El procedimiento completo está en el apartado 14.",
  ],
] as const;

export default function TratamientoDeDatos() {
  return (
    <PaginaLegal
      titulo="Política de tratamiento de datos personales"
      entradilla="Por CliniVentas pasan conversaciones de pacientes: nombres, teléfonos, fotos y consultas sobre tratamientos. Este documento explica quién responde de qué, qué hacemos con esa información, qué hace exactamente la inteligencia artificial y qué no hacemos nunca."
    >
      <Apartado n={1} titulo="Dos papeles distintos, y conviene no confundirlos">
        <p>
          Cuando una clínica usa CliniVentas hay dos tratamientos de datos que
          corren en paralelo y que la ley trata de forma diferente:
        </p>
        <Tabla
          cabeceras={["Datos", "Quién decide (responsable)", "Quién ejecuta (encargado)"]}
          filas={[
            ["Los de la clínica como cliente nuestro: contacto, facturación, usuarios", `${EMPRESA.nombreComercial}`, "Nuestros proveedores"],
            ["Los de los pacientes que la clínica guarda en el CRM", "La clínica", `${EMPRESA.nombreComercial}`],
          ]}
        />
        <p>
          Sobre los datos de los pacientes <strong>la clínica es la responsable</strong>:
          decide qué recoge, para qué y durante cuánto tiempo, y es quien tiene
          que informar a sus pacientes y recabar su consentimiento.{" "}
          <strong>Nosotros somos encargados</strong>: los tratamos por cuenta de la
          clínica, siguiendo sus instrucciones, y no los usamos para nada propio.
        </p>
        <p>
          Para los datos de la clínica como cliente nuestro, mira la{" "}
          <Link href="/privacidad">política de privacidad</Link>.
        </p>
      </Apartado>

      <Apartado n={2} titulo="Qué datos de pacientes pasan por el sistema">
        <ul>
          <li><strong>Identificación y contacto</strong>: nombre o alias, número de WhatsApp, foto de perfil si WhatsApp la facilita, y el resto de datos de la ficha que la clínica decida rellenar.</li>
          <li><strong>El contenido de la conversación</strong>: los mensajes de ida y vuelta, con sus fechas y su estado de entrega y lectura.</li>
          <li><strong>Los archivos que el paciente envía</strong>: fotos, audios, vídeos y documentos, incluida la descripción o transcripción que el sistema genera de ellos.</li>
          <li><strong>Lo que genera la inteligencia artificial</strong> a partir de la conversación: el análisis, las respuestas sugeridas y las etiquetas o etapas propuestas (apartado 6).</li>
          <li><strong>Datos de gestión comercial</strong>: etiquetas, etapa del embudo, origen del lead, vendedor asignado, tareas y motivo de pérdida.</li>
          <li><strong>El identificador del clic del anuncio</strong>, cuando el paciente llegó desde un anuncio de Meta que abre WhatsApp. Lo genera Meta y viene adjunto al primer mensaje (apartado 8).</li>
          <li><strong>Citas</strong> agendadas desde la conversación.</li>
          <li><strong>Notas internas</strong> que el equipo escribe sobre el paciente y que el paciente no ve.</li>
        </ul>
        <p>
          Los datos que nos llegan a través de la plataforma de WhatsApp (el
          número, el nombre de perfil y los mensajes) se usan únicamente para
          que la clínica pueda conversar con esa persona y gestionar esa
          conversación. No se usan para rastrearla ni para construir perfiles
          sobre ella fuera de ese contexto.
        </p>
      </Apartado>

      <Apartado n={3} titulo="Datos de salud: la parte delicada">
        <p>
          Una foto de un rostro para valorar un tratamiento, una consulta sobre
          una dolencia o el historial de sesiones de un paciente son{" "}
          <strong>datos sensibles</strong>. La ley les da una protección
          reforzada y exige un consentimiento expreso, distinto del general.
        </p>
        <Nota>
          <p>
            <strong>Esto es responsabilidad de la clínica, no nuestra.</strong> Antes
            de meter a un paciente en el CRM, la clínica tiene que haberle
            informado de que sus datos se tratan en una herramienta de gestión y
            haber obtenido su consentimiento expreso para los datos de salud. La
            herramienta no puede darlo por ella.
          </p>
          <p>
            Nosotros ponemos los medios para protegerlos: control de acceso por
            usuario, registro de la actividad y las medidas del apartado 11.
          </p>
        </Nota>
        <p>
          WhatsApp no es un canal pensado para información clínica. Sus propias
          condiciones indican que no debe usarse para prestar telemedicina ni
          para intercambiar información de salud cuando la normativa exija
          sistemas con requisitos más estrictos. CliniVentas es una herramienta
          de atención y ventas, <strong>no una historia clínica</strong>: lo que
          se trate por este canal debe limitarse a lo necesario para atender la
          consulta y agendar la cita.
        </p>
      </Apartado>

      <Apartado n={4} titulo="Qué hacemos con esos datos — y qué no">
        <p>Los tratamos únicamente para:</p>
        <ul>
          <li>Prestar el servicio contratado: centralizar las conversaciones, ordenarlas por etapas, ejecutar las automatizaciones que la clínica configure, generar las sugerencias que el equipo pida y mostrar sus indicadores.</li>
          <li>Dar soporte cuando la clínica lo pide.</li>
          <li>Mantener la seguridad y la integridad del sistema, incluidas las copias de seguridad.</li>
        </ul>
        <p>Y estos son los límites, dichos sin rodeos:</p>
        <ul>
          <li><strong>No vendemos ni cedemos</strong> los datos de pacientes a nadie.</li>
          <li><strong>No los usamos para publicidad</strong> ni para elaborar perfiles con fines propios.</li>
          <li><strong>No entrenamos modelos de inteligencia artificial</strong> con las conversaciones de tus pacientes, ni permitimos que lo hagan nuestros proveedores (apartado 6).</li>
          <li><strong>No los mezclamos</strong> entre clínicas: cada cuenta ve solo lo suyo.</li>
          <li><strong>No accede nadie de nuestro equipo</strong> al contenido de las conversaciones salvo que la clínica lo pida para resolver una incidencia concreta, y solo durante esa incidencia.</li>
          <li><strong>No tomamos decisiones automatizadas</strong> que produzcan efectos jurídicos sobre un paciente ni le afecten de forma significativa.</li>
        </ul>
      </Apartado>

      <Apartado n={5} titulo="La conexión con WhatsApp: coexistencia con el celular y el papel de Meta">
        <p>
          CliniVentas se conecta de la forma que Meta llama{" "}
          <strong>coexistencia</strong>: la clínica conserva la aplicación
          WhatsApp Business en su celular y, con ese mismo número, conecta el
          CRM a la <strong>API oficial de WhatsApp Business</strong> (la
          plataforma para empresas de Meta). El teléfono y el CRM funcionan a
          la vez, y WhatsApp mantiene sincronizado el historial entre ambos.
          Esto es lo que pasa con los datos en esa conexión:
        </p>
        <ul>
          <li>
            <strong>La clínica autoriza desde su propio teléfono.</strong> La
            conexión se inicia en la aplicación WhatsApp Business: WhatsApp
            muestra un código, la clínica confirma que quiere conectar el número
            a la plataforma y decide, con un botón aparte, si comparte su
            historial de chats con nosotros. Nosotros no podemos activar esa
            conexión ni ese permiso por ella.
          </li>
          <li>
            <strong>Qué se sincroniza al conectar.</strong> Si la clínica lo
            autoriza, los mensajes individuales de los <strong>últimos seis
            meses</strong> y los contactos con número de WhatsApp. Los archivos
            adjuntos antiguos llegan solo de los últimos catorce días; del resto
            queda una marca de que existieron. Los chats de grupo no se
            sincronizan nunca. Si la clínica no autoriza el historial, el CRM
            empieza vacío y solo recibe lo nuevo.
          </li>
          <li>
            <strong>Lo que la clínica escribe desde el celular también llega al
            CRM.</strong> WhatsApp envía una copia de cada mensaje enviado desde
            la aplicación para que la conversación esté completa en los dos
            sitios. Los cambios en la agenda de contactos del teléfono también
            se reflejan.
          </li>
          <li>
            <strong>Lo que no pasa por el CRM.</strong> Grupos, estados, llamadas
            de voz y vídeo, mensajes temporales o de una sola vista, ubicación en
            tiempo real, catálogo y listas de difusión siguen viviendo solo en el
            teléfono (las listas de difusión pasan a ser de solo lectura).
          </li>
          <li>
            <strong>El teléfono tiene que seguir activo.</strong> Si la aplicación
            del celular pasa unas dos semanas sin conectarse, WhatsApp
            desconecta la coexistencia y el CRM deja de recibir mensajes hasta
            volver a conectar.
          </li>
          <li>
            <strong>Desconectar es cosa de la clínica y de un minuto.</strong> Se
            hace desde la propia aplicación WhatsApp Business (Ajustes, Cuenta,
            Plataforma para empresas, Desconectar cuenta). Al desconectar, el
            número sigue funcionando en el celular con todos sus chats; lo que
            ya estaba en el CRM sigue el ciclo de borrado del apartado 12.
          </li>
        </ul>
        <p>
          En esta modalidad Meta recibe y entrega los mensajes como{" "}
          <strong>encargado de la clínica</strong>, bajo las condiciones de la
          WhatsApp Business Platform, la Plataforma de Meta y la política de
          mensajería comercial de WhatsApp. Los mensajes que el CRM envía por la
          API están sujetos a la ventana de 24 horas y a las tarifas de Meta; los
          que la clínica envía desde el celular, no. Las cuentas de WhatsApp
          siguen siendo propiedad de la clínica, dentro de su propio portafolio
          comercial de Meta, y quedan compartidas con nosotros solo mientras
          dure la conexión.
        </p>
        <p>
          Los mensajes viajan por la infraestructura de WhatsApp y quedan
          sujetos también a las condiciones de WhatsApp LLC y Meta Platforms,
          Inc., sobre las que no tenemos control. Y{" "}
          <strong>el contenido no es opaco para nosotros</strong>: la API nos
          entrega los mensajes para que la clínica los vea en el CRM, y sin
          verlos no podríamos prestar el servicio. Decirlo de otra forma sería
          engañarte.
        </p>
        <p>
          Lo que recibimos de la plataforma de WhatsApp lo tratamos solo para
          que la clínica converse con esa persona. No lo compartimos con
          terceros distintos de los subencargados del apartado 10, salvo los
          eventos de conversión del apartado 8; no lo
          vendemos ni lo licenciamos, tampoco en forma anónima o agregada, y
          no lo usamos para perfilar a los usuarios de WhatsApp fuera de la
          conversación.
        </p>
        <p>
          CliniVentas es un producto independiente: no está afiliado, patrocinado
          ni respaldado por WhatsApp LLC ni por Meta Platforms, Inc.
        </p>
      </Apartado>

      <Apartado n={6} titulo="El análisis con inteligencia artificial: qué hace y qué no">
        <p>
          CliniVentas incluye una función de <strong>sugerencias con IA</strong>:
          cuando una persona del equipo lo pide, el sistema lee la conversación
          abierta y le propone qué responder. También puede describir las fotos
          y vídeos, transcribir los audios y extraer el texto de los documentos
          que el paciente envía. Esto es exactamente lo que ocurre con los datos
          en cada caso:
        </p>
        <Tabla
          cabeceras={["Qué se envía", "Cuándo", "Qué vuelve"]}
          filas={[
            ["La conversación del paciente que el vendedor tiene abierta, con la indicación que este escriba (por ejemplo, «no dar precio»)", "Solo cuando el vendedor pulsa «Generar sugerencias»", "Un análisis breve, una o varias respuestas propuestas con su justificación y, opcionalmente, una etapa o etiqueta sugerida"],
            ["El archivo que el paciente envió (foto, vídeo, audio o documento)", "Al recibirlo o cuando el equipo pide analizarlo", "Una descripción, transcripción o texto extraído que se guarda junto al archivo"],
          ]}
        />
        <p>
          Para hacerlo, ese contenido se envía a los <strong>proveedores externos
          de inteligencia artificial</strong> que figuran en la tabla del
          apartado 10, que lo procesan y devuelven el resultado. Son nuestros
          subencargados: tratan los datos por cuenta de la clínica, bajo
          contrato y únicamente para generar ese resultado.
        </p>
        <p>Las reglas que nos imponemos, y que imponemos a esos proveedores:</p>
        <ul>
          <li>
            <strong>La IA nunca habla con el paciente.</strong> No envía mensajes,
            no responde sola y el paciente no interactúa con ella. La sugerencia
            la ve únicamente el equipo de la clínica, y una persona decide si la
            envía tal cual, la edita o la descarta. Si la clínica configura
            automatizaciones que respondan solas, estas usan textos y botones
            que la propia clínica escribió, no texto generado por la IA en el
            momento (apartado 7).
          </li>
          {/* Esta frase obliga a usar los proveedores en una modalidad que
              excluya el entrenamiento (API de pago con el uso de datos
              desactivado), NO las aplicaciones de consumo ni los planes
              gratuitos. Si eso cambia, hay que cambiar esta linea. */}
          <li>
            <strong>No se entrena con los datos.</strong> Usamos los proveedores
            a través de sus API empresariales, en la modalidad en la que el
            contenido enviado <strong>no se emplea para entrenar ni mejorar</strong>{" "}
            sus modelos. No usamos las aplicaciones de consumo ni los niveles
            gratuitos, donde esa garantía no existe. Tampoco nosotros entrenamos
            ni ajustamos modelos con conversaciones de pacientes. Las condiciones
            de la WhatsApp Business Platform prohíben usar sus datos, incluso
            anonimizados o agregados, para crear o mejorar modelos de IA, y las
            cumplimos.
          </li>
          <li>
            <strong>Conservación mínima en el proveedor.</strong> El proveedor
            conserva la solicitud lo necesario para procesarla y, como máximo,{" "}
            {RETENCION_PROVEEDORES_IA} con fines de detección de abusos, tras lo
            cual la elimina. El resultado se guarda en el CRM de la clínica, como
            parte de la conversación, y sigue su mismo ciclo de borrado
            (apartado 12).
          </li>
          <li>
            <strong>Solo lo necesario.</strong> Se envía la conversación o el
            archivo sobre el que se pide la sugerencia, no la base de datos de
            la clínica ni los datos de otros pacientes.
          </li>
          <li>
            <strong>Sin decisiones automatizadas con efectos sobre el paciente.</strong>{" "}
            La IA puede proponer una etapa del embudo o una etiqueta para
            ordenar el trabajo interno. Esa propuesta queda registrada con su
            motivo y el equipo puede deshacerla. La IA no decide precios, no
            hace diagnósticos, no recomienda tratamientos al paciente y no
            determina si se atiende o no a alguien.
          </li>
          <li>
            <strong>Puede equivocarse.</strong> Una sugerencia es un borrador. Es
            responsabilidad del equipo de la clínica revisar que lo que envía
            es correcto, y así lo indicamos en la propia pantalla.
          </li>
          <li>
            <strong>Se puede apagar.</strong> La clínica puede pedirnos que
            desactivemos las sugerencias y el análisis de archivos en su
            cuenta. El resto del producto sigue funcionando igual.
          </li>
        </ul>
        <Nota>
          <p>
            <strong>Para la clínica:</strong> si en tu aviso de privacidad a
            pacientes describes las herramientas que usas, puedes decir que
            empleas «un sistema de gestión de conversaciones con asistencia de
            inteligencia artificial para ayudar al equipo a redactar
            respuestas, siempre revisadas por una persona». Es exactamente lo
            que hace.
          </p>
        </Nota>
      </Apartado>

      <Apartado n={7} titulo="Automatizaciones: siempre hay una persona detrás">
        <p>
          La clínica puede configurar flujos que respondan solos: un saludo,
          un menú con botones, una pregunta de clasificación. Esas respuestas
          las escribe la clínica de antemano y se ejecutan dentro de la ventana
          de 24 horas que WhatsApp permite. Para cumplir la política de
          mensajería de WhatsApp y, sobre todo, para no dejar a nadie hablando
          con una máquina sin salida:
        </p>
        <ul>
          <li>Toda conversación, automatizada o no, aparece en la bandeja compartida, donde el equipo puede intervenir en cualquier momento y tomar el control.</li>
          <li>La clínica debe ofrecer una <strong>vía rápida, clara y directa para hablar con una persona</strong>: una opción en el propio chat, un teléfono o un correo. Un flujo que no la tenga incumple las condiciones de WhatsApp.</li>
          <li>Las automatizaciones solo se activan con personas que escribieron primero a la clínica o que dieron su número y su permiso para recibir mensajes, y se detienen si la persona pide que no le escriban más.</li>
        </ul>
      </Apartado>

      <Apartado n={8} titulo="Eventos de conversión para los anuncios de Meta">
        <p>
          Muchas clínicas captan pacientes con anuncios de Facebook e Instagram
          que abren una conversación de WhatsApp. CliniVentas avisa a Meta de
          que una de esas conversaciones
          terminó en algo concreto (un contacto válido, una cita agendada, una
          venta) para que Meta muestre esos anuncios a personas más parecidas a
          las que sí agendan. Es la <strong>API de conversiones para mensajes de
          negocio</strong> de Meta. La clínica puede pedirnos que la{" "}
          <strong>desactivemos</strong> en su cuenta, y el resto del producto
          sigue funcionando igual.
        </p>
        <Tabla
          cabeceras={["Se envía a Meta", "No se envía nunca"]}
          filas={[
            ["El nombre del evento: contacto recibido, cita agendada o compra, entre los que Meta define", "El contenido de los mensajes, las fotos, los audios ni las notas internas"],
            ["La fecha y hora del evento", "El tratamiento, el motivo de consulta o cualquier dato de salud, ni como nombre de evento ni como detalle"],
            ["El identificador del clic del anuncio que Meta mismo generó y adjuntó al primer mensaje del paciente", "El número de teléfono ni el nombre del paciente"],
            ["El identificador de la cuenta de WhatsApp Business de la clínica", "Datos de pacientes que no llegaron desde un anuncio de Meta"],
            ["Opcionalmente, el importe y la moneda de una venta", ""],
          ]}
        />
        {/* Solo se usa la via del identificador de clic (ctwa_clid). Si algun
            dia se anade el emparejamiento por telefono o correo cifrados
            (hash), hay que cambiar la tabla y avisar a las clinicas: pasaria
            a enviarse un identificador del paciente. Las Condiciones de las
            herramientas comerciales de Meta prohiben compartir datos de salud,
            tambien implicitos en el nombre del evento: por eso los eventos son
            genericos y no llevan el servicio de interes. */}
        <p>
          Las reglas que aplicamos: solo se envían eventos de conversaciones que
          empezaron en un anuncio de Meta, los eventos son genéricos y nunca
          describen un tratamiento ni un estado de salud, y no se envía ningún
          dato que identifique al paciente por sí mismo. El conjunto de datos
          donde Meta recibe los eventos es <strong>propiedad de la clínica</strong>,
          dentro de su portafolio comercial de Meta; nosotros enviamos los
          eventos en su nombre y con su autorización.
        </p>
        <Nota>
          <p>
            <strong>Aquí Meta no es nuestro encargado.</strong> Los eventos los
            recibe bajo sus propias Condiciones de las herramientas comerciales:
            los combina con lo que ya sabe de sus usuarios para medir y
            optimizar la entrega de los anuncios de la clínica, y puede
            conservarlos hasta dos años. Por eso esta función exige que{" "}
            <strong>la clínica informe a sus pacientes</strong>, en su propio
            aviso de privacidad, de que comparte con Meta eventos de conversión
            con fines de medición y publicidad, y tenga base legal para hacerlo.
          </p>
          <p>
            Un paciente puede pedir a la clínica que no envíe eventos sobre su
            conversación, y puede revisar y limitar desde su propia cuenta de
            Facebook o Instagram la actividad que las empresas comparten con
            Meta.
          </p>
        </Nota>
      </Apartado>

      <Apartado n={9} titulo="Quién accede a los datos dentro de la clínica">
        <p>
          Cada persona del equipo entra con su propio usuario. La clínica decide
          quién ve qué, puede revocar el acceso de un dispositivo concreto y
          queda registro de la actividad relevante. Cuando alguien deja el
          equipo, es la clínica quien debe darle de baja: nosotros no sabemos
          quién sigue trabajando ahí.
        </p>
      </Apartado>

      <Apartado n={10} titulo="Subencargados y dónde están">
        <p>
          Para prestar el servicio nos apoyamos en los proveedores de abajo, con
          contrato de encargo y obligación de confidencialidad: tratan los datos
          solo por cuenta nuestra y de la clínica, siguiendo instrucciones, y no
          para fines propios. Avisaremos a la clínica antes de incorporar uno
          nuevo, para que pueda oponerse.
        </p>
        <Tabla
          cabeceras={["Proveedor", "Para qué", "Dónde trata los datos"]}
          filas={SUBENCARGADOS_CRM.map((s) => [s.proveedor, s.servicio, s.ubicacion])}
        />
        <p>
          Cuando el tratamiento ocurre fuera de {EMPRESA.pais}, exigimos por
          contrato un nivel de protección equivalente al de la {MARCO.ley} y
          aplicamos las garantías previstas para el flujo transfronterizo.
        </p>
      </Apartado>

      <Apartado n={11} titulo="Medidas de seguridad">
        <ul>
          <li>Tráfico cifrado en tránsito y credenciales de integración cifradas en reposo.</li>
          <li>Acceso por usuario, con sesiones que la clínica puede revocar por dispositivo.</li>
          <li>Copias de seguridad periódicas y verificadas.</li>
          <li>Separación estricta de los datos de cada cuenta.</li>
          <li>Registro de la actividad y vigilancia del sistema.</li>
          <li>Límite de envíos por hora, para no poner en riesgo el número de la clínica.</li>
          <li>Las credenciales de acceso a la plataforma de WhatsApp no se comparten con nadie fuera de los proveedores que operan el servicio.</li>
        </ul>
        <p>
          Ningún sistema es infalible. Si detectamos una brecha que afecte a
          datos de pacientes, <strong>se lo comunicaremos a la clínica sin dilación
          indebida</strong> con lo que sepamos, para que pueda cumplir sus propias
          obligaciones de notificación, y la notificaremos también a la
          plataforma de WhatsApp cuando sus condiciones lo exijan. Si detectas
          una vulnerabilidad en nuestro servicio, escríbenos a{" "}
          <a href={`mailto:${EMPRESA.correoPrivacidad}`}>{EMPRESA.correoPrivacidad}</a>.
        </p>
      </Apartado>

      <Apartado n={12} titulo="Cuánto se conservan y qué pasa al terminar">
        <p>
          Mientras dure el contrato, los datos se conservan porque son el
          historial de trabajo de la clínica. La clínica puede borrar en
          cualquier momento un lead, una conversación o un archivo desde el
          propio producto; al borrarlos se eliminan también las sugerencias,
          descripciones y transcripciones generadas sobre ellos.
        </p>
        <p>
          Terminado el contrato, la clínica dispone de <strong>30 días naturales</strong>{" "}
          para pedirnos la exportación de su información. Pasado ese plazo,
          suprimimos los datos de pacientes de los sistemas activos y de las
          copias de seguridad conforme al ciclo de rotación de estas, salvo lo
          que una norma nos obligue a conservar.
        </p>
      </Apartado>

      <Apartado n={13} titulo="Cómo ejerce sus derechos un paciente">
        <p>
          El paciente ejerce sus derechos de acceso, rectificación, cancelación y
          oposición <strong>ante la clínica</strong>, que es la responsable de sus
          datos. Si se dirige a nosotros, le indicaremos a quién acudir; no
          podemos resolver sobre datos que no son nuestros.
        </p>
        <p>
          A la clínica sí le damos el soporte necesario para atender esas
          solicitudes: exportación, corrección o borrado de la información. Puede
          pedírnoslo en{" "}
          <a href={`mailto:${EMPRESA.correoPrivacidad}`}>{EMPRESA.correoPrivacidad}</a>.
        </p>
        <p>
          Si el paciente considera que sus derechos no han sido atendidos, puede
          reclamar ante la {MARCO.autoridad}.
        </p>
      </Apartado>

      <Apartado n={14} id="eliminacion" titulo="Cómo solicitar la eliminación de datos">
        <p>
          Cualquier persona cuyos datos pasen por CliniVentas puede pedir que se
          eliminen. El camino depende de quién lo pide:
        </p>
        <p><strong>Si eres paciente o has escrito a una clínica que usa CliniVentas:</strong></p>
        <ol>
          <li>Pídeselo a la clínica, por el mismo WhatsApp o por el medio que prefieras. Ella es la responsable de tus datos y puede eliminar tu ficha y tu conversación directamente desde el CRM.</li>
          <li>Si no consigues contactar con la clínica, escríbenos a <a href={`mailto:${EMPRESA.correoPrivacidad}`}>{EMPRESA.correoPrivacidad}</a> indicando el número de WhatsApp desde el que escribiste y el nombre de la clínica. Trasladaremos tu solicitud a la clínica y te confirmaremos a quién la hemos enviado.</li>
        </ol>
        <p><strong>Si eres una clínica cliente:</strong></p>
        <ol>
          <li>Puedes borrar leads, conversaciones y archivos concretos desde el propio producto, en cualquier momento.</li>
          <li>Para eliminar la cuenta completa, escríbenos a <a href={`mailto:${EMPRESA.correoPrivacidad}`}>{EMPRESA.correoPrivacidad}</a> desde un correo de administrador. Te confirmaremos la recepción, te ofreceremos la exportación previa del apartado 12 y, pasados los 30 días o antes si lo pides, eliminaremos todos los datos de pacientes de tu cuenta.</li>
        </ol>
        <p>
          Cuando borramos datos, borramos también los resultados generados por
          la inteligencia artificial sobre ellos. Lo que quede en copias de
          seguridad se elimina conforme al ciclo de rotación de estas. Te
          confirmaremos por escrito cuando el borrado esté hecho.
        </p>
      </Apartado>

      <Apartado n={15} titulo="Obligaciones de la clínica">
        <p>Al usar CliniVentas, la clínica se compromete a:</p>
        <ol>
          <li>Informar a sus pacientes de que sus datos se tratan en una herramienta de gestión con asistencia de inteligencia artificial, y obtener el consentimiento que corresponda, expreso cuando haya datos de salud.</li>
          <li>Introducir solo los datos necesarios para su finalidad, y no usar el canal para comunicaciones comerciales no consentidas.</li>
          <li>Escribir únicamente a personas que le dieron su número y su permiso, y dejar de hacerlo cuando se lo pidan.</li>
          <li>No usar WhatsApp para prestar telemedicina ni para pedir o enviar información clínica que la normativa exija tratar en sistemas con requisitos más estrictos, ni para pedir números completos de tarjetas, cuentas bancarias o documentos de identidad.</li>
          <li>Revisar las sugerencias de la IA antes de enviarlas y mantener siempre una vía para que el paciente hable con una persona.</li>
          <li>Informar a sus pacientes de que comparte con Meta eventos de conversión para medir y optimizar sus anuncios, y contar con base legal para ello, o pedirnos que desactivemos esa función.</li>
          <li>Gestionar las altas y bajas de su equipo y el nivel de acceso de cada persona.</li>
          <li>Atender los derechos que ejerzan sus pacientes.</li>
          <li>Conectar el número desde la aplicación WhatsApp Business (no la versión personal), mantener ese teléfono activo y decidir de forma informada si comparte el historial al conectar.</li>
          <li>Cumplir las condiciones de uso de WhatsApp y de la WhatsApp Business Platform para el número que vincula.</li>
        </ol>
      </Apartado>

      <Apartado n={16} titulo="Preguntas frecuentes sobre la inteligencia artificial y tus datos">
        <div className="mt-2 divide-y divide-border">
          {PREGUNTAS.map(([pregunta, respuesta]) => (
            <div key={pregunta} className="py-5">
              <h3 className="text-h4">{pregunta}</h3>
              <p className="!mt-2">{respuesta}</p>
            </div>
          ))}
        </div>
      </Apartado>

      <Apartado n={17} titulo="Cambios y contacto">
        <p>
          Actualizaremos la fecha del encabezado cada vez que cambiemos este
          documento, y avisaremos a las clínicas con antelación cuando el cambio
          sea sustancial. Para cualquier cuestión sobre este tratamiento:{" "}
          <a href={`mailto:${EMPRESA.correoPrivacidad}`}>{EMPRESA.correoPrivacidad}</a>{" "}
          o {EMPRESA.domicilio}.
        </p>
      </Apartado>
    </PaginaLegal>
  );
}
