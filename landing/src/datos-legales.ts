/**
 * DATOS QUE HAY QUE RELLENAR ANTES DE PUBLICAR.
 *
 * Las dos paginas legales (/privacidad y /tratamiento-de-datos) leen de aqui,
 * asi que se corrige en un solo sitio. Todo lo que siga entre corchetes sale
 * impreso tal cual en la web: si ves `[RAZON SOCIAL]` en la pagina publicada,
 * es que este archivo no se ha completado.
 *
 * El texto esta redactado para PERU (Ley N.o 29733 de Proteccion de Datos
 * Personales y su reglamento, D.S. 016-2024-JUS, que derogo al
 * D.S. 003-2013-JUS y rige desde fines de marzo de 2025). Si el titular de la web esta
 * en otro pais, hay que revisar las referencias legales de ambas paginas:
 * Colombia (Ley 1581 de 2012), Mexico (LFPDPPP), Chile (Ley 19.628), etc.
 */

export const EMPRESA = {
  nombreComercial: "CliniVentas",
  razonSocial: "CENTRO AVANZADO DE REJUVENECIMIENTO FACIAL Y TECNOESTETICA S.A.C.",
  /* La ficha RUC registra "DérmicaPro" como nombre comercial. CliniVentas es
     la marca del producto, no otra empresa: por eso se citan las dos, para
     que un cliente reconozca quien le factura. */
  nombreComercialRegistrado: "DérmicaPro",
  ruc: "20615564819",
  partidaRegistral: "11630932",
  domicilio:
    "Av. Víctor Larco Herrera 877, Urb. Vista Alegre, distrito de Víctor Larco Herrera, Trujillo, La Libertad, Perú",
  /* Un solo buzon para todo lo legal. El dia que exista uno general
     (hola@), se anade aqui y se cita en el ultimo apartado. */
  correoPrivacidad: "privacidad@cliniventas.com",
  pais: "Perú",
};

/** Ley y autoridad de control que se citan en el texto. */
export const MARCO = {
  ley: "Ley N.º 29733, Ley de Protección de Datos Personales",
  reglamento: "Decreto Supremo N.º 016-2024-JUS",
  autoridad:
    "Autoridad Nacional de Protección de Datos Personales del Ministerio de Justicia y Derechos Humanos",
};

/** Fecha de la ultima revision del texto legal. Actualizar al tocarlo. */
export const ACTUALIZADO = "14 de noviembre de 2026";

/**
 * Terceros que tratan datos por cuenta nuestra. Van en DOS listas porque no
 * intervienen en lo mismo: por la web no pasan datos de contacto (el
 * formulario de cotizacion solo abre WhatsApp con el mensaje armado), mientras
 * que por el CRM pasan las conversaciones de pacientes. Meterlos en una sola
 * tabla daria a entender que OpenAI ve los datos de quien rellena el
 * formulario de la landing, y no es asi.
 *
 * Si manana se cambia de proveedor, se actualiza aqui y las tablas de las dos
 * paginas cambian solas.
 */

/** Lo que toca a esta web y al correo de la empresa. */
export const SUBENCARGADOS_WEB = [
  {
    proveedor: "Hostinger International Ltd",
    servicio: "Alojamiento de esta web y del correo corporativo",
    ubicacion: "Brasil",
  },
];

/**
 * Plazo que los proveedores de IA conservan las solicitudes para detectar
 * abusos antes de borrarlas. OpenAI lo publica: hasta 30 dias
 * (developers.openai.com/api/docs/guides/your-data). Verificar el de Google
 * para la API de Gemini de pago antes de publicar y, si difiere, poner aqui el
 * mayor de los dos: el texto promete "como maximo" este plazo.
 */
export const RETENCION_PROVEEDORES_IA = "30 días";

/** Lo que toca a los datos de pacientes dentro del CRM. */
export const SUBENCARGADOS_CRM = [
  {
    proveedor: "Hostinger International Ltd",
    servicio: "Alojamiento de la aplicación y de la base de datos",
    ubicacion: "Brasil",
  },
  {
    proveedor: "Google LLC (API de Gemini)",
    servicio: "Descripción de imágenes, transcripción de audios y análisis de la conversación para las sugerencias",
    ubicacion: "Estados Unidos",
  },
  {
    proveedor: "OpenAI, L.L.C. (API de OpenAI)",
    servicio: "Análisis de la conversación y redacción de las respuestas sugeridas",
    ubicacion: "Estados Unidos",
  },
  {
    proveedor: "WhatsApp LLC / Meta Platforms, Inc.",
    servicio: "Transporte de los mensajes de WhatsApp (WhatsApp Business Platform)",
    ubicacion: "Estados Unidos y otros",
  },
];
