/**
 * Los paquetes de CliniVentas y que trae cada uno.
 *
 * Las tarjetas, la tabla comparativa y el formulario leen de aqui. El reparto
 * salio de un debate de producto (2026-11-14): lo que hace que el CRM sirva
 * (WhatsApp, embudo, citas completas, panel completo) va en todos, y se sube
 * de paquete por tamano de equipo, por automatizar y por anuncios. Nunca se
 * cobra por leads, mensajes ni conversaciones.
 *
 * Nada de lo listado puede ser una promesa: si una funcion todavia no existe
 * en el CRM, no va aqui.
 */

export type IdPaquete = "basico" | "esencial" | "profesional";

export interface Paquete {
  id: IdPaquete;
  nombre: string;
  para: string;
  personas: string;
  /** Lo mismo en corto, para la opción del formulario. */
  personasCorto: string;
  destacado?: boolean;
  /** Lo que lo distingue del anterior, en tres o cuatro lineas. */
  claves: string[];
}

export const PAQUETES: Paquete[] = [
  {
    id: "basico",
    nombre: "Básico",
    para: "Consultorios y profesionales que atienden con un equipo chico.",
    personas: "Hasta 3 personas atendiendo",
    personasCorto: "Hasta 3 personas",
    claves: [
      "Bandeja compartida con tu mismo número",
      "Embudo, tareas y agenda de citas con Google Calendar",
      "Panel de control completo",
      "3 seguimientos automáticos simples",
    ],
  },
  {
    id: "esencial",
    nombre: "Esencial",
    para: "Clínicas y centros estéticos con equipo de ventas.",
    personas: "Hasta 10 personas atendiendo",
    personasCorto: "Hasta 10 personas",
    destacado: true,
    claves: [
      "Todo lo de Básico",
      "Constructor visual de automatizaciones",
      "Sugerencias y análisis de leads con IA",
      "Reparto automático y reportes en Excel",
    ],
  },
  {
    id: "profesional",
    nombre: "Profesional",
    para: "Negocios que invierten en anuncios y quieren escalar.",
    personas: "Sin límite de personas atendiendo",
    personasCorto: "Sin límite de personas",
    claves: [
      "Todo lo de Esencial",
      "Le avisa a Meta qué anuncios traen citas",
      "Precios sincronizados con tu sistema",
      "Mayor cupo de IA",
    ],
  },
];

/** Una celda de la tabla: incluido, no incluido, o un texto corto. */
export type Celda = boolean | string;

export interface Funcion {
  nombre: string;
  detalle?: string;
  en: Record<IdPaquete, Celda>;
}

export interface GrupoFunciones {
  titulo: string;
  funciones: Funcion[];
}

const TODOS = { basico: true, esencial: true, profesional: true } as const;
const DESDE_ESENCIAL = { basico: false, esencial: true, profesional: true } as const;
const SOLO_PROFESIONAL = { basico: false, esencial: false, profesional: true } as const;

export const FUNCIONES: GrupoFunciones[] = [
  {
    titulo: "Equipo",
    funciones: [
      {
        nombre: "Personas que atienden",
        en: { basico: "Hasta 3", esencial: "Hasta 10", profesional: "Sin límite" },
      },
      {
        nombre: "Cuentas de solo lectura",
        detalle: "Para la dueña, el contador o la agencia: ven el panel, no los chats.",
        en: { basico: "Incluidas", esencial: "Incluidas", profesional: "Incluidas" },
      },
      { nombre: "Reparto automático de leads por turnos", en: DESDE_ESENCIAL },
    ],
  },
  {
    titulo: "WhatsApp",
    funciones: [
      { nombre: "Bandeja compartida con tu mismo número", en: TODOS },
      { nombre: "Plantillas oficiales de Meta y respuestas rápidas", en: TODOS },
      { nombre: "Notas internas, menciones y mensajes programados", en: TODOS },
      { nombre: "Contador de la ventana de 24 horas", en: TODOS },
    ],
  },
  {
    titulo: "Ventas y citas",
    funciones: [
      { nombre: "Embudo por etapas, etiquetas y tareas", en: TODOS },
      { nombre: "Agenda de citas con Google Calendar", en: TODOS },
      { nombre: "Aviso de la cita al paciente por WhatsApp", en: TODOS },
      { nombre: "Catálogo de servicios y paquetes con precio", en: TODOS },
      { nombre: "Campos propios en la ficha del paciente", en: DESDE_ESENCIAL },
      { nombre: "Número aparte para los avisos de cita", en: DESDE_ESENCIAL },
    ],
  },
  {
    titulo: "Automatización e IA",
    funciones: [
      {
        nombre: "Seguimientos automáticos",
        en: { basico: "3 reglas simples", esencial: "Flujos visuales", profesional: "Flujos visuales" },
      },
      {
        nombre: "Sugerencias de respuesta con IA",
        detalle: "Propone la respuesta; una persona decide si la envía.",
        en: { basico: false, esencial: true, profesional: "Mayor cupo" },
      },
      { nombre: "Base de conocimiento para la IA", en: DESDE_ESENCIAL },
      { nombre: "Análisis de leads con IA", en: { basico: false, esencial: true, profesional: "Mayor cupo" } },
    ],
  },
  {
    titulo: "Números y anuncios",
    funciones: [
      { nombre: "Panel de control completo", en: TODOS },
      { nombre: "De qué anuncio llegó cada paciente", en: TODOS },
      { nombre: "Respaldo completo de tus datos en Excel", en: TODOS },
      {
        nombre: "Reportes en Excel",
        detalle: "Separaciones y adelantos, resultados por vendedora y leads del período.",
        en: DESDE_ESENCIAL,
      },
      {
        nombre: "Eventos de conversión a Meta",
        detalle: "Meta aprende qué anuncios traen pacientes que agendan, no solo clics.",
        en: SOLO_PROFESIONAL,
      },
      { nombre: "Precios sincronizados con tu sistema de ventas", en: SOLO_PROFESIONAL },
    ],
  },
];

/**
 * Sugerencia para quien no sabe qué paquete elegir. La frontera principal es
 * cuántas personas atienden; pautar en Meta empuja a Profesional porque es lo
 * único que ese paquete agrega para un equipo mediano.
 */
export function paqueteSugerido(personas: string, pauta: string): IdPaquete | null {
  if (!personas) return null;
  if (personas === "mas-de-10") return "profesional";
  if (pauta === "si") return personas === "1-3" ? "esencial" : "profesional";
  return personas === "1-3" ? "basico" : "esencial";
}
