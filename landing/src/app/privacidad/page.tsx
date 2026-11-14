import type { Metadata } from "next";
import Link from "next/link";
import { PaginaLegal, Apartado, Nota, Tabla } from "@/components/legal";
import { EMPRESA, MARCO, SUBENCARGADOS_WEB } from "@/datos-legales";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description:
    "Qué datos recoge CliniVentas a través de esta web, para qué los usa, cuánto los conserva y cómo ejercer tus derechos de acceso, rectificación, cancelación y oposición.",
  alternates: { canonical: "/privacidad" },
};

export default function Privacidad() {
  return (
    <PaginaLegal
      titulo="Política de privacidad"
      entradilla="Qué datos tuyos tratamos cuando visitas esta web o nos pides acceso al producto, para qué los usamos y qué puedes exigirnos en cualquier momento."
    >
      <Apartado n={1} titulo="Quiénes somos y qué cubre este documento">
        <p>
          El responsable del tratamiento es <strong>{EMPRESA.razonSocial}</strong>,
          que opera comercialmente como {EMPRESA.nombreComercialRegistrado} y
          ofrece este producto bajo la marca «{EMPRESA.nombreComercial}». RUC{" "}
          {EMPRESA.ruc}, inscrita en la partida registral N.º{" "}
          {EMPRESA.partidaRegistral} de los Registros Públicos, con domicilio en{" "}
          {EMPRESA.domicilio}. Puedes escribirnos a{" "}
          <a href={`mailto:${EMPRESA.correoPrivacidad}`}>{EMPRESA.correoPrivacidad}</a>.
        </p>
        <p>
          Esta política cubre <strong>los datos de quienes visitan este sitio web
          o nos piden acceso al producto</strong>. No cubre los datos de los
          pacientes que nuestros clientes guardan dentro del CRM: de eso trata la{" "}
          <Link href="/tratamiento-de-datos">Política de tratamiento de datos personales</Link>,
          donde explicamos que ahí no somos responsables sino encargados, y qué
          significa esa diferencia.
        </p>
      </Apartado>

      <Apartado n={2} titulo="Qué datos recogemos">
        <p>
          <strong>Los que nos entregas tú.</strong> El formulario de cotización no
          envía nada a nuestros servidores: arma un mensaje y abre tu WhatsApp para
          que lo envíes tú. Si no lo envías, no recibimos nada. Si lo envías, nos
          llega con tu número de WhatsApp y con lo que hayas completado:
        </p>
        <ul>
          <li>Tu nombre y tu rol en el negocio.</li>
          <li>
            Sobre tu negocio: el tipo, el nombre, la ciudad, cuántas sedes tiene y,
            si quieres, su Instagram o web. Según el tipo, cuántos especialistas
            atienden, si venden paquetes de sesiones y si cobran un adelanto.
          </li>
          <li>
            Cómo trabajan hoy: cuántas personas atienden WhatsApp, cuántas
            consultas reciben, si ya usan un CRM y cuál, y dónde llevan la agenda.
          </li>
          <li>
            El paquete que te interesa y, según el paquete, qué quieren resolver
            primero, si pautan en Facebook o Instagram (con la inversión aproximada
            y quién la maneja) y qué sistema de ventas usan.
          </li>
          <li>Cuándo quieren empezar y lo que escribas en el comentario libre.</li>
        </ul>
        <p>
          No hay campos ocultos y no pedimos nada más. El mensaje viaja por
          WhatsApp, un servicio de Meta que usas con tu propia cuenta. Si además
          nos escribes por correo o por WhatsApp, tratamos lo que decidas
          contarnos en esa conversación.
        </p>
        <p>
          <strong>Los que genera tu visita.</strong> El servidor que sirve esta web
          registra, como cualquier servidor, la dirección IP desde la que se
          conecta, la fecha y hora, la página solicitada y el navegador. Sirve
          para operar el sitio y detectar abusos, no para perfilarte.
        </p>
      </Apartado>

      <Apartado n={3} titulo="Cookies y lo que se guarda en tu navegador">
        <p>
          <strong>Esta web no usa cookies.</strong> No hay analítica, ni píxeles
          de publicidad, ni botones de redes sociales que te sigan de un sitio a
          otro. No compartimos tu navegación con terceros porque no la medimos.
        </p>
        <p>
          Lo único que guardamos en tu equipo es tu preferencia de tema (claro u
          oscuro), en el almacenamiento local del navegador y bajo la clave{" "}
          <code>tema</code>. Ese valor no viaja a ningún servidor: existe solo
          para que la página no te cambie de color en cada visita. Puedes borrarlo
          limpiando los datos del sitio en tu navegador.
        </p>
        <Nota>
          <p>
            Si en el futuro añadimos analítica, lo diremos aquí y te pediremos
            consentimiento antes de activarla, no después.
          </p>
        </Nota>
      </Apartado>

      <Apartado n={4} titulo="Para qué usamos tus datos">
        <ul>
          <li><strong>Responder a tu solicitud</strong> de acceso o de información y darte de alta si decides contratar.</li>
          <li><strong>Ponernos en contacto contigo</strong> por correo o por WhatsApp para la demostración y la puesta en marcha.</li>
          <li><strong>Gestionar la relación comercial</strong>: facturación, soporte y avisos de servicio.</li>
          <li><strong>Enviarte novedades del producto</strong>, solo si lo has aceptado por separado y siempre con un enlace para darte de baja.</li>
          <li><strong>Cumplir obligaciones legales</strong>, contables y tributarias.</li>
        </ul>
        <p>
          No vendemos, alquilamos ni cedemos tus datos a terceros para que te
          hagan publicidad. Tampoco tomamos decisiones automatizadas que
          produzcan efectos jurídicos sobre ti.
        </p>
      </Apartado>

      <Apartado n={5} titulo="Con qué legitimación los tratamos">
        <p>
          Tratamos tus datos con tu <strong>consentimiento</strong>, que das al
          enviarnos el mensaje del formulario, y —cuando ya eres cliente— porque son necesarios
          para <strong>ejecutar el contrato</strong> que nos une y para cumplir
          las obligaciones legales que se derivan de él. Todo ello conforme a la{" "}
          {MARCO.ley} y su reglamento, el {MARCO.reglamento}.
        </p>
        <p>
          El consentimiento es revocable en cualquier momento y sin explicar por
          qué. Revocarlo no afecta a la licitud del tratamiento anterior.
        </p>
      </Apartado>

      <Apartado n={6} titulo="Cuánto tiempo los conservamos">
        <Tabla
          cabeceras={["Dato", "Plazo de conservación"]}
          filas={[
            ["Solicitud de acceso que no acaba en contrato", "Hasta 12 meses desde el último contacto, salvo que pidas antes la supresión."],
            ["Datos de cliente activo", "Mientras dure la relación contractual."],
            ["Datos de cliente tras la baja", "El plazo de prescripción de las obligaciones legales, contables y tributarias que nos apliquen."],
            ["Registros del servidor web", "Un máximo de 12 meses."],
            ["Suscripción a novedades", "Hasta que te des de baja."],
          ]}
        />
        <p>
          Cumplido el plazo, los datos se suprimen o se anonimizan de forma que
          no se pueda volver a asociarlos contigo.
        </p>
      </Apartado>

      <Apartado n={7} titulo="Con quién los compartimos">
        <p>
          Solo con los proveedores que necesitamos para operar, que actúan como
          encargados nuestros, bajo contrato y con instrucciones por escrito:
        </p>
        <Tabla
          cabeceras={["Proveedor", "Para qué", "Dónde trata los datos"]}
          filas={SUBENCARGADOS_WEB.map((s) => [s.proveedor, s.servicio, s.ubicacion])}
        />
        <p>
          Además, podemos comunicar datos a la autoridad competente cuando una
          norma nos obligue. Fuera de esos dos supuestos, no sale nada.
        </p>
      </Apartado>

      <Apartado n={8} titulo="Transferencias fuera del país">
        <p>
          Algunos de esos proveedores tratan la información desde servidores
          situados fuera de {EMPRESA.pais}. Cuando eso ocurre, exigimos
          contractualmente un nivel de protección equivalente al que impone
          nuestra normativa y aplicamos las garantías que la propia ley prevé
          para el flujo transfronterizo de datos personales.
        </p>
      </Apartado>

      <Apartado n={9} titulo="Tus derechos">
        <p>Sobre tus datos personales puedes ejercer, gratuitamente:</p>
        <ul>
          <li><strong>Acceso</strong>: saber qué datos tuyos tenemos y de dónde salieron.</li>
          <li><strong>Rectificación</strong>: corregir los que estén mal o incompletos.</li>
          <li><strong>Cancelación o supresión</strong>: que los borremos cuando ya no sean necesarios o retires el consentimiento.</li>
          <li><strong>Oposición</strong>: pedir que dejemos de tratarlos por un motivo legítimo.</li>
          <li><strong>Información</strong>: preguntarnos cualquier cosa sobre este tratamiento.</li>
        </ul>
        <p>
          Escríbenos a <a href={`mailto:${EMPRESA.correoPrivacidad}`}>{EMPRESA.correoPrivacidad}</a>{" "}
          desde el correo con el que nos contactaste, o a nuestro domicilio,
          indicando qué derecho ejerces. Podemos pedirte que acredites tu
          identidad antes de responder —es una protección para ti, no un trámite
          para retrasarlo— y te contestaremos dentro de los plazos que fija la
          normativa aplicable.
        </p>
        <p>
          Si crees que no te hemos atendido como debíamos, puedes reclamar ante
          la {MARCO.autoridad}.
        </p>
      </Apartado>

      <Apartado n={10} titulo="Seguridad">
        <p>
          Aplicamos medidas técnicas y organizativas para proteger tus datos:
          cifrado del tráfico en tránsito, control de acceso por usuario, cifrado
          de las credenciales que guardamos, copias de seguridad verificadas y
          registro de la actividad relevante. Ningún sistema es infalible; si se
          produjera una brecha que pueda afectarte, te lo comunicaremos y lo
          notificaremos a la autoridad cuando la norma lo exija.
        </p>
      </Apartado>

      <Apartado n={11} titulo="Menores de edad">
        <p>
          Ni esta web ni el producto están dirigidos a menores de edad, y no
          recogemos sus datos a sabiendas a través de este sitio. Si un menor
          aparece como paciente dentro del CRM de una clínica, el consentimiento
          de quien ejerza la patria potestad corresponde recabarlo a esa clínica,
          como se explica en la{" "}
          <Link href="/tratamiento-de-datos">política de tratamiento de datos</Link>.
        </p>
      </Apartado>

      <Apartado n={12} titulo="Cambios en esta política">
        <p>
          Si cambiamos algo, actualizaremos la fecha del encabezado. Cuando el
          cambio afecte de forma sustancial a cómo tratamos tus datos, te
          avisaremos por correo antes de que entre en vigor, no después.
        </p>
      </Apartado>

      <Apartado n={13} titulo="Contacto">
        <p>
          Para cualquier cuestión sobre privacidad, sobre este documento o para
          ejercer tus derechos:{" "}
          <a href={`mailto:${EMPRESA.correoPrivacidad}`}>{EMPRESA.correoPrivacidad}</a>,
          o por escrito a {EMPRESA.domicilio}.
        </p>
      </Apartado>
    </PaginaLegal>
  );
}
