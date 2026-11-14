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

export type IdPaquete = "esencial" | "profesional" | "crecimiento";

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
    id: "esencial",
    nombre: "Esencial",
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
    id: "profesional",
    nombre: "Profesional",
    para: "Clínicas y centros estéticos con equipo de ventas.",
    personas: "Hasta 10 personas atendiendo",
    personasCorto: "Hasta 10 personas",
    destacado: true,
    claves: [
      "Todo lo de Esencial",
      "Constructor visual de automatizaciones",
      "Sugerencias y análisis de leads con IA",
      "Reparto automático y reportes en Excel",
    ],
  },
  {
    id: "crecimiento",
    nombre: "Crecimiento",
    para: "Negocios que invierten en anuncios y quieren escalar.",
    personas: "Sin límite de personas atendiendo",
    personasCorto: "Sin límite de personas",
    claves: [
      "Todo lo de Profesional",
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

const TODOS = { esencial: true, profesional: true, crecimiento: true } as const;
const DESDE_PROFESIONAL = { esencial: false, profesional: true, crecimiento: true } as const;
const SOLO_CRECIMIENTO = { esencial: false, profesional: false, crecimiento: true } as const;

export const FUNCIONES: GrupoFunciones[] = [
  {
    titulo: "Equipo",
    funciones: [
      {
        nombre: "Personas que atienden",
        en: { esencial: "Hasta 3", profesional: "Hasta 10", crecimiento: "Sin límite" },
      },
      {
        nombre: "Cuentas de solo lectura",
        detalle: "Para la dueña, el contador o la agencia: ven el panel, no los chats.",
        en: { esencial: "Incluidas", profesional: "Incluidas", crecimiento: "Incluidas" },
      },
      { nombre: "Reparto automático de leads por turnos", en: DESDE_PROFESIONAL },
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
      { nombre: "Campos propios en la ficha del paciente", en: DESDE_PROFESIONAL },
      { nombre: "Número aparte para los avisos de cita", en: DESDE_PROFESIONAL },
    ],
  },
  {
    titulo: "Automatización e IA",
    funciones: [
      {
        nombre: "Seguimientos automáticos",
        en: { esencial: "3 reglas simples", profesional: "Flujos visuales", crecimiento: "Flujos visuales" },
      },
      {
        nombre: "Sugerencias de respuesta con IA",
        detalle: "Propone la respuesta; una persona decide si la envía.",
        en: { esencial: false, profesional: true, crecimiento: "Mayor cupo" },
      },
      { nombre: "Base de conocimiento para la IA", en: DESDE_PROFESIONAL },
      { nombre: "Análisis de leads con IA", en: { esencial: false, profesional: true, crecimiento: "Mayor cupo" } },
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
        en: DESDE_PROFESIONAL,
      },
      {
        nombre: "Eventos de conversión a Meta",
        detalle: "Meta aprende qué anuncios traen pacientes que agendan, no solo clics.",
        en: SOLO_CRECIMIENTO,
      },
      { nombre: "Precios sincronizados con tu sistema de ventas", en: SOLO_CRECIMIENTO },
    ],
  },
];

/**
 * Sugerencia para quien no sabe qué paquete elegir. La frontera principal es
 * cuántas personas atienden; pautar en Meta empuja a Crecimiento porque es lo
 * único que ese paquete agrega para un equipo mediano.
 */
export function paqueteSugerido(personas: string, pauta: string): IdPaquete | null {
  if (!personas) return null;
  if (personas === "mas-de-10") return "crecimiento";
  if (pauta === "si") return personas === "1-3" ? "profesional" : "crecimiento";
  return personas === "1-3" ? "esencial" : "profesional";
}
