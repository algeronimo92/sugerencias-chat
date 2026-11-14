"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { EVENTO_PAQUETE } from "@/components/boton-paquete";
import { Selector, type OpcionSelector } from "@/components/selector";
import { PAQUETES, paqueteSugerido, type IdPaquete } from "@/paquetes";
import { WHATSAPP_VENTAS } from "@/textos";

/**
 * Formulario de cotización: arma un mensaje y abre WhatsApp para enviarlo.
 *
 * La landing es HTML estático, sin servidor que reciba un POST. En vez de
 * mandar los datos a un servicio de formularios (otro tercero con datos de
 * contacto), la consulta sale del WhatsApp del propio visitante y entra a la
 * bandeja del CRM como cualquier lead. Por eso no se le pide su número: llega
 * con el mensaje. Nada se guarda en esta página.
 *
 * Las preguntas buscan llegar a la primera llamada sabiendo quién es: qué
 * tipo de negocio tiene (cambia lo que se pregunta: paquetes de sesiones en
 * estética, especialistas en salud), cómo trabaja hoy (si ya tiene un CRM,
 * cómo agenda) y qué paquete quiere (a Esencial le importa qué
 * automatizar; a Profesional, sus anuncios).
 */

type Eleccion = IdPaquete | "no-se";

const CLASE_CAMPO =
  "w-full rounded-lg border border-border-field bg-surface px-3.5 py-2.5 text-body-sm placeholder:text-text-subtle focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
const CLASE_ETIQUETA = "mb-1.5 block text-caption font-medium";
const CLASE_OPCION =
  "flex cursor-pointer items-center gap-2 rounded-lg border border-border-field bg-surface px-3 py-2.5 text-body-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring";

const TIPOS = [
  ["estetica", "Centro estético"],
  ["spa", "Spa"],
  ["dental", "Clínica dental"],
  ["medico", "Centro médico"],
  ["consultorio", "Consultorio"],
  ["otro", "Otro"],
] as const;
type Tipo = (typeof TIPOS)[number][0] | "";
const ES_ESTETICA: Tipo[] = ["estetica", "spa"];
const ES_SALUD: Tipo[] = ["dental", "medico", "consultorio"];

const ROLES = ["Dueña o dueño", "Administración", "Recepción o ventas", "Marketing"];
const SEDES = ["1", "2 o 3", "4 o más"];
const PERSONAS = [["1-3", "1 a 3"], ["4-10", "4 a 10"], ["mas-de-10", "Más de 10"]] as const;
const CONSULTAS = ["Menos de 20", "20 a 50", "50 a 100", "Más de 100"];
const ATENCION_HOY = [
  "Un solo celular con WhatsApp Business",
  "WhatsApp Web en varias computadoras",
  "Desde otro CRM o plataforma",
];
const AGENDA_HOY = ["Cuaderno o Excel", "Google Calendar", "Un sistema de agenda", "No llevamos agenda"];
const ESPECIALISTAS = ["1", "2 a 5", "6 o más"];
const PRIORIDADES = [
  "Seguimiento automático a quien no responde",
  "Respuestas sugeridas con IA",
  "Repartir los leads entre el equipo",
  "Reportes para pagar comisiones",
];
const INVERSION = ["Menos de 300 USD", "300 a 1.000 USD", "1.000 a 3.000 USD", "Más de 3.000 USD"];
const QUIEN_PAUTA = ["Yo", "Alguien del equipo", "Una agencia"];
const CUANDO = ["Esta semana", "Este mes", "En los próximos meses", "Solo estoy averiguando"];

const NOMBRE: Record<Eleccion, string> = {
  basico: "Básico", esencial: "Esencial", profesional: "Profesional", "no-se": "Aún no lo sé",
};

/** Un bloque del formulario. Un grupo con título y no un fieldset: la
 * leyenda de un fieldset se dibuja sobre el borde superior, y flotarla para
 * evitarlo aplastaba contra el costado lo que venía después. */
function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <p id={id} className="text-eyebrow text-accent-strong uppercase">{titulo}</p>
      {children}
    </div>
  );
}

function Lista({ id, etiqueta, valores, requerido = false, valor, cambiar }: {
  id: string; etiqueta: string; valores: readonly OpcionSelector[]; requerido?: boolean;
  valor?: string; cambiar?: (valor: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ETIQUETA}>{etiqueta}</label>
      <Selector id={id} name={id} opciones={valores} requerido={requerido} valor={valor} cambiar={cambiar} />
    </div>
  );
}

function SiNo({ nombre, pregunta, valor, cambiar }: {
  nombre: string; pregunta: string; valor: string; cambiar: (v: string) => void;
}) {
  return (
    <fieldset>
      <legend className={CLASE_ETIQUETA}>{pregunta}</legend>
      <div className="flex gap-2">
        {[["si", "Sí"], ["no", "No"]].map(([id, texto]) => (
          <label key={id} className={`${CLASE_OPCION} flex-1 justify-center`}>
            <input type="radio" name={nombre} value={id} checked={valor === id}
              onChange={() => cambiar(id)} className="accent-[var(--color-accent)]" />
            {texto}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function FormularioSolicitud() {
  const [paquete, setPaquete] = useState<Eleccion | "">("");
  const [tipo, setTipo] = useState<Tipo>("");
  const [personas, setPersonas] = useState("");
  const [tieneCrm, setTieneCrm] = useState("");
  const [paquetesSesiones, setPaquetesSesiones] = useState("");
  const [adelanto, setAdelanto] = useState("");
  const [pauta, setPauta] = useState("");
  const [prioridades, setPrioridades] = useState<string[]>([]);

  // Una tarjeta de paquete deja su elección marcada aquí.
  useEffect(() => {
    function elegido(evento: Event) {
      setPaquete((evento as CustomEvent<IdPaquete>).detail);
    }
    window.addEventListener(EVENTO_PAQUETE, elegido);
    return () => window.removeEventListener(EVENTO_PAQUETE, elegido);
  }, []);

  const sugerido = paquete === "no-se" ? paqueteSugerido(personas, pauta) : null;
  const preguntaPauta = paquete === "profesional" || paquete === "no-se";
  const listo = WHATSAPP_VENTAS !== "";

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const valor = (campo: string) => String(datos.get(campo) ?? "").trim();
    const siNo = (v: string) => (v === "si" ? "Sí" : v === "no" ? "No" : "");
    const tipoTexto = tipo === "otro" ? valor("tipo_otro") || "Otro" : TIPOS.find(([id]) => id === tipo)?.[1] ?? "";
    const personasTexto = PERSONAS.find(([id]) => id === personas)?.[1] ?? "";

    // CORTE separa bloques del mensaje; un dato opcional sin completar es ""
    // y se descarta, para que no deje líneas en blanco sueltas.
    const CORTE = "\u0000";
    const detalles = [
      `*Paquete:* ${paquete ? NOMBRE[paquete] : "Aún no lo sé"}`,
      sugerido && `Paquete sugerido por la web: ${NOMBRE[sugerido]}`,
      CORTE,
      `*Negocio:* ${valor("negocio")} (${tipoTexto}), ${valor("ciudad")}`,
      `Sedes: ${valor("sedes")}`,
      valor("redes") && `Instagram o web: ${valor("redes")}`,
      `Contacto: ${valor("nombre")}, ${valor("rol")}`,
      valor("especialistas") && `Especialistas que atienden: ${valor("especialistas")}`,
      paquetesSesiones && `Venden paquetes de sesiones: ${siNo(paquetesSesiones)}`,
      adelanto && `Cobran adelanto al separar la cita: ${siNo(adelanto)}`,
      CORTE,
      `*Cómo trabajan hoy*`,
      `Personas que atienden WhatsApp: ${personasTexto}`,
      valor("consultas") && `Consultas por día: ${valor("consultas")}`,
      valor("atencion") && `Atienden WhatsApp con: ${valor("atencion")}`,
      `Ya usan un CRM: ${siNo(tieneCrm)}${valor("crm_cual") ? ` (${valor("crm_cual")})` : ""}`,
      valor("agenda") && `Agenda: ${valor("agenda")}`,
      valor("sistema") && `Sistema de ventas o caja: ${valor("sistema")}`,
      prioridades.length > 0 && `Quieren resolver primero: ${prioridades.join(", ")}`,
      pauta && `Pautan en Facebook o Instagram: ${siNo(pauta)}`,
      valor("inversion") && `Inversión mensual en anuncios: ${valor("inversion")}`,
      valor("quien") && `Maneja la pauta: ${valor("quien")}`,
      valor("cuando") && `Quieren empezar: ${valor("cuando")}`,
      valor("comentario") && CORTE,
      valor("comentario"),
    ]
      .filter((linea): linea is string => typeof linea === "string" && linea !== "")
      .map((linea) => (linea === CORTE ? "" : linea));
    const mensaje = ["Hola, quiero cotizar CliniVentas.", "", ...detalles].join("\n");

    const url = `https://wa.me/${WHATSAPP_VENTAS}?text=${encodeURIComponent(mensaje)}`;
    // En el celular abre la aplicación; en la computadora, WhatsApp Web o la
    // de escritorio. Si el navegador bloquea la pestaña, se va en la misma.
    if (!window.open(url, "_blank", "noopener")) window.location.assign(url);
  }

  return (
    <form onSubmit={enviar} className="space-y-5 rounded-xl border border-border bg-bg p-5 sm:p-7">
      <Grupo titulo="El paquete">
        {/* Una fila igual por opción: en dos columnas, "Aún no lo sé" se
            partía en dos líneas y dejaba una caja más alta que las demás. */}
        <div className="grid gap-2">
          {[
            ...PAQUETES.map((p) => ({ id: p.id as Eleccion, detalle: p.personasCorto })),
            { id: "no-se" as Eleccion, detalle: "Te sugerimos uno" },
          ].map(({ id, detalle }) => (
            <label key={id} className={CLASE_OPCION}>
              <input type="radio" name="paquete" value={id} required
                checked={paquete === id} onChange={() => setPaquete(id)}
                className="accent-[var(--color-accent)]" />
              <span className="font-medium">{NOMBRE[id]}</span>
              <span className="ml-auto text-caption text-text-subtle">{detalle}</span>
            </label>
          ))}
        </div>
      </Grupo>

      <Grupo titulo="Tu negocio">
        <Lista id="tipo" etiqueta="Tipo de negocio" valores={TIPOS} requerido valor={tipo}
          cambiar={(v) => { setTipo(v as Tipo); setPaquetesSesiones(""); setAdelanto(""); }} />
        {tipo === "otro" && (
          <div>
            <label htmlFor="tipo_otro" className={CLASE_ETIQUETA}>¿Qué tipo de negocio es?</label>
            <input id="tipo_otro" name="tipo_otro" type="text" required placeholder="Veterinaria, nutrición, estudio de tatuajes…" className={CLASE_CAMPO} />
          </div>
        )}
        {[
          { id: "negocio", etiqueta: "Nombre del negocio", ph: "Centro Estético Aura", ac: "organization" },
          { id: "ciudad", etiqueta: "Ciudad", ph: "Trujillo, Perú", ac: "address-level2" },
        ].map((c) => (
          <div key={c.id}>
            <label htmlFor={c.id} className={CLASE_ETIQUETA}>{c.etiqueta}</label>
            <input id={c.id} name={c.id} type="text" required autoComplete={c.ac} placeholder={c.ph} className={CLASE_CAMPO} />
          </div>
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <Lista id="sedes" etiqueta="¿Cuántas sedes tienen?" valores={SEDES} requerido />
          <div>
            <label htmlFor="redes" className={CLASE_ETIQUETA}>
              Instagram o web <span className="font-normal text-text-subtle">(opcional)</span>
            </label>
            <input id="redes" name="redes" type="text" placeholder="@centroaura" className={CLASE_CAMPO} />
          </div>
        </div>

        {ES_SALUD.includes(tipo) && (
          <Lista id="especialistas" etiqueta="¿Cuántos especialistas atienden?" valores={ESPECIALISTAS} />
        )}
        {ES_ESTETICA.includes(tipo) && (
          <SiNo nombre="paquetes_sesiones" pregunta="¿Venden paquetes de varias sesiones?"
            valor={paquetesSesiones} cambiar={setPaquetesSesiones} />
        )}
        {tipo !== "" && tipo !== "otro" && (
          <SiNo nombre="adelanto" pregunta="¿Cobran un adelanto para separar la cita?" valor={adelanto} cambiar={setAdelanto} />
        )}
      </Grupo>

      <Grupo titulo="Cómo trabajan hoy">
        <div className="grid gap-4 sm:grid-cols-2">
          <Lista id="personas" etiqueta="¿Cuántos atienden WhatsApp?" valores={PERSONAS} requerido
            valor={personas} cambiar={setPersonas} />
          <Lista id="consultas" etiqueta="Consultas que reciben al día" valores={CONSULTAS} />
        </div>
        {paquete === "basico" && personas !== "" && personas !== "1-3" && (
          <p className="rounded-lg bg-warning-soft px-3.5 py-2.5 text-caption text-warning" role="status">
            Básico es para hasta 3 personas. Con tu equipo te conviene Esencial.
          </p>
        )}
        <Lista id="atencion" etiqueta="¿Cómo atienden WhatsApp?" valores={ATENCION_HOY} />
        <fieldset>
          <legend className={CLASE_ETIQUETA}>¿Ya usan un CRM?</legend>
          <div className="flex gap-2">
            {[["si", "Sí"], ["no", "No"]].map(([id, texto]) => (
              <label key={id} className={`${CLASE_OPCION} flex-1 justify-center`}>
                <input type="radio" name="crm" value={id} required checked={tieneCrm === id}
                  onChange={() => setTieneCrm(id)} className="accent-[var(--color-accent)]" />
                {texto}
              </label>
            ))}
          </div>
        </fieldset>
        {tieneCrm === "si" && (
          <div>
            <label htmlFor="crm_cual" className={CLASE_ETIQUETA}>¿Cuál, y qué no les gusta de él?</label>
            <input id="crm_cual" name="crm_cual" type="text" placeholder="Nombre del CRM y lo que les falta" className={CLASE_CAMPO} />
          </div>
        )}
        <Lista id="agenda" etiqueta="¿Dónde llevan la agenda de citas?" valores={AGENDA_HOY} />
        {paquete === "profesional" && (
          <div>
            <label htmlFor="sistema" className={CLASE_ETIQUETA}>
              Sistema de ventas o caja <span className="font-normal text-text-subtle">(opcional)</span>
            </label>
            <input id="sistema" name="sistema" type="text" placeholder="Nombre del sistema" className={CLASE_CAMPO} />
          </div>
        )}
      </Grupo>

      {(paquete === "esencial" || preguntaPauta) && (
        <Grupo titulo="Lo que necesitan">
          {paquete === "esencial" && (
            <fieldset>
              <legend className={CLASE_ETIQUETA}>¿Qué quieren resolver primero?</legend>
              <div className="space-y-2">
                {PRIORIDADES.map((p) => (
                  <label key={p} className="flex items-start gap-2.5 text-body-sm text-text-muted">
                    <input type="checkbox" checked={prioridades.includes(p)}
                      onChange={(e) => setPrioridades((actual) => e.target.checked ? [...actual, p] : actual.filter((x) => x !== p))}
                      className="mt-1 accent-[var(--color-accent)]" />
                    {p}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {preguntaPauta && (
            <SiNo nombre="pauta" pregunta="¿Pautan en Facebook o Instagram?" valor={pauta} cambiar={setPauta} />
          )}
          {preguntaPauta && pauta === "si" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Lista id="inversion" etiqueta="Inversión mensual" valores={INVERSION} />
              <Lista id="quien" etiqueta="¿Quién la maneja?" valores={QUIEN_PAUTA} />
            </div>
          )}
          {sugerido && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent-soft px-3.5 py-3" role="status">
              <p className="text-body-sm">
                Por lo que nos cuentas, te conviene <strong className="font-semibold">{NOMBRE[sugerido]}</strong>.
              </p>
              <button type="button" onClick={() => setPaquete(sugerido)}
                className="rounded-full border border-accent px-3 py-1 text-caption font-semibold text-accent-strong hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                Elegir {NOMBRE[sugerido]}
              </button>
            </div>
          )}
        </Grupo>
      )}

      <Grupo titulo="Sobre ti">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="nombre" className={CLASE_ETIQUETA}>Tu nombre</label>
            <input id="nombre" name="nombre" type="text" required autoComplete="name" placeholder="María Fernández" className={CLASE_CAMPO} />
          </div>
          <Lista id="rol" etiqueta="Tu rol en el negocio" valores={ROLES} requerido />
        </div>
        <Lista id="cuando" etiqueta="¿Cuándo quieren empezar?" valores={CUANDO} />
        <div>
          <label htmlFor="comentario" className={CLASE_ETIQUETA}>
            ¿Algo más que debamos saber? <span className="font-normal text-text-subtle">(opcional)</span>
          </label>
          <textarea id="comentario" name="comentario" rows={3} className={CLASE_CAMPO}
            placeholder="Qué te preocupa, qué te gustaría ver en la demostración…" />
        </div>
      </Grupo>

      <div>
        <button type="submit" disabled={!listo}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-body-sm font-semibold text-accent-contrast transition-colors duration-[var(--duration-rapida)] ease-suave hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60">
          {listo ? "Pedir cotización por WhatsApp" : "Formulario en preparación"}
        </button>
        <p className="mt-3 text-center text-micro text-text-subtle">
          Se abre WhatsApp con tu mensaje listo y tú decides si lo envías. Te
          respondemos en menos de 24 horas hábiles.
        </p>
      </div>
    </form>
  );
}
