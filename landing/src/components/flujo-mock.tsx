/**
 * Maqueta del constructor de flujos de CliniVentas, reconstruida en HTML+SVG.
 * Reproduce la interfaz real del producto (barra de flujo con borrador /
 * publicar / versiones, paleta "arrastra al lienzo" y lienzo con el grafo
 * ramificado) con un flujo ficticio. Ver docs/direccion-arte.md, seccion 7.
 *
 * El grafo va en UN solo <svg> con viewBox: asi los nodos y las aristas no
 * se pueden desalinear al cambiar de ancho, que es justo lo que pasaria
 * posicionando cajas en porcentajes sobre una capa de lineas aparte.
 * El lienzo real se navega en horizontal; aqui se hace lo mismo con
 * overflow-x en pantallas estrechas en vez de encoger el texto hasta que
 * deja de leerse.
 */

/* Geometria del lienzo. Columnas de 138 con calle de 40; tres carriles. */
const COL = [10, 188, 366, 544, 722, 900];
const CARRIL = { alto: 66, medio: 176, bajo: 286 };
const ANCHO_NODO = 138;
const ALTO_NODO = 58;
const ALTO_NODO_RAMA = 88; /* el que lleva chips de salida */

type Tono = "accent" | "info" | "warning" | "neutral";

const TONOS: Record<Tono, { barra: string; etiqueta: string }> = {
  accent: { barra: "var(--accent)", etiqueta: "var(--accent-strong)" },
  info: { barra: "var(--info)", etiqueta: "var(--info-strong)" },
  warning: { barra: "var(--warning-solid)", etiqueta: "var(--warning)" },
  neutral: { barra: "var(--text-subtle)", etiqueta: "var(--text-subtle)" },
};

/** y del centro de un nodo colocado en un carril. */
function cima(carril: number, alto: number) {
  return carril - alto / 2;
}

/** Curva tipo lienzo: sale en horizontal y entra en horizontal. */
function arista(x1: number, y1: number, x2: number, y2: number) {
  const d = Math.max(46, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`;
}

function Nodo({
  x, carril, tipo, lineas, tono, chips,
}: {
  x: number;
  carril: number;
  tipo: string;
  lineas: string[];
  tono: Tono;
  chips?: { texto: string; fondo?: string; tinta?: string }[];
}) {
  const alto = chips ? ALTO_NODO_RAMA : ALTO_NODO;
  const y = cima(carril, alto);
  const { barra, etiqueta } = TONOS[tono];
  /* Sin chips el texto se centra en la caja: con una sola linea de titulo
     quedaria colgando de la parte de arriba. Con chips la posicion es fija,
     porque las salidas mandan y tienen que quedar pegadas al borde. */
  const base = chips ? y + 20 : y + (alto - (12 + lineas.length * 13)) / 2 + 9;

  return (
    <g>
      <rect
        x={x} y={y} width={ANCHO_NODO} height={alto} rx="9"
        fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="1"
      />
      <rect x={x + 7} y={y + 11} width="3.5" height={alto - 22} rx="1.75" fill={barra} />
      <text
        x={x + 17} y={base} fontSize="8" fontWeight="700"
        letterSpacing="0.07em" fill={etiqueta}
      >
        {tipo.toUpperCase()}
      </text>
      {lineas.map((linea, i) => (
        <text
          key={linea} x={x + 17} y={base + 14 + i * 13}
          fontSize="11" fontWeight="600" fill="var(--text)"
        >
          {linea}
        </text>
      ))}
      {chips?.map((chip, i) => (
        <g key={chip.texto}>
          <rect
            x={x + 15} y={y + 45 + i * 20} width={ANCHO_NODO - 30} height="17" rx="8.5"
            fill={chip.fondo ?? "var(--surface-alt)"} stroke="var(--border)" strokeWidth="0.8"
          />
          <text
            x={x + 24} y={y + 57 + i * 20} fontSize="9" fontWeight="600"
            fill={chip.tinta ?? "var(--text-muted)"}
          >
            {chip.texto}
          </text>
        </g>
      ))}
    </g>
  );
}

/* Los siete bloques del panel, con el mismo vocabulario que el producto. */
const BLOQUES: { nombre: string; que: string; tono: Tono; icono: string }[] = [
  { nombre: "Condición", que: "Rama Sí/No", tono: "warning", icono: "M3 9h4l3-5 3 10 3-5h3" },
  { nombre: "Acción", que: "Ejecuta una operación", tono: "info", icono: "M4 5h12M4 9h12M4 13h7" },
  { nombre: "Invocar flujo", que: "Inicia otro flujo", tono: "accent", icono: "M4 4h5v5H4zM11 11h5v5h-5zM9 6.5h4V13" },
  { nombre: "Pausa", que: "Espera una condición", tono: "neutral", icono: "M10 4a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM10 7v3l2 1.4" },
  { nombre: "Pregunta (botones)", que: "Una rama por respuesta", tono: "warning", icono: "M4 5h12v6H9l-3 3v-3H4z" },
  { nombre: "Round robin", que: "Reparte por turnos", tono: "accent", icono: "M5 8a5 5 0 0 1 9-2M15 11a5 5 0 0 1-9 2M14 3v3h-3M6 16v-3h3" },
  { nombre: "Fin", que: "Termina esta ruta", tono: "neutral", icono: "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM7.4 10l1.9 1.9 3.4-3.6" },
];

/**
 * `display` viaja SIEMPRE en className, nunca en la base: si la base trae
 * `inline-flex` y encima se pasa `hidden sm:inline-flex`, gana el que Tailwind
 * emita el ultimo en la hoja (no el orden del atributo) y el boton no se
 * oculta nunca. Por eso el valor por defecto es `inline-flex`.
 */
function BotonBarra({
  children, principal = false, className = "inline-flex",
}: { children: React.ReactNode; principal?: boolean; className?: string }) {
  return (
    <span
      className={`items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-micro font-semibold ${
        principal
          ? "bg-accent text-accent-contrast"
          : "border border-border-strong bg-surface text-text-muted"
      } ${className}`}
    >
      {children}
    </span>
  );
}

export function FlujoMock() {
  return (
    <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-lg">
      {/* Barra del flujo: nombre, version publicada y ciclo borrador/publicar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold tracking-tight">
            Hollywood Peel
          </p>
          <p className="mt-0.5 text-micro text-text-subtle">
            Flujo #4 · publicado v10
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-surface-alt px-2.5 py-1.5 text-micro text-text-muted lg:inline-flex">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5">
              <circle cx="10" cy="10" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 6.4V10l2.4 1.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Máx/hora <strong className="font-semibold text-text">60</strong>
          </span>
          <span className="hidden items-center gap-1.5 rounded-lg border border-border bg-accent-soft px-2.5 py-1.5 text-micro font-medium text-accent-strong xl:inline-flex">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5">
              <path d="m4.5 10.5 3.4 3.4L15.5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Visible para vendedores
          </span>
          <BotonBarra className="hidden sm:inline-flex">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5">
              <path d="M7 4.5v11l8.5-5.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            Probar
          </BotonBarra>
          <BotonBarra className="hidden md:inline-flex">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5">
              <path d="M10 4.2a5.8 5.8 0 1 1-5.6 7.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M2.6 8.6 4.6 11.8 7.6 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Versiones
          </BotonBarra>
          <BotonBarra>Guardar borrador</BotonBarra>
          <BotonBarra principal>Publicar</BotonBarra>
        </div>
      </div>

      {/* En movil no cabe el panel lateral, pero los bloques son lo que hay
          que ensenar: se muestran como fila de fichas encima del lienzo. */}
      <div className="border-b border-border bg-surface-alt px-4 py-3 md:hidden">
        <p className="mb-2 text-micro font-semibold tracking-[0.09em] text-text-subtle uppercase">
          Arrastra al lienzo
        </p>
        <div className="flex flex-wrap gap-1.5">
          {BLOQUES.map((b) => (
            <span
              key={b.nombre}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-micro font-medium"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONOS[b.tono].barra }} />
              {b.nombre}
            </span>
          ))}
        </div>
      </div>

      <div className="flex">
        {/* Paleta: los bloques que se arrastran al lienzo */}
        <aside className="hidden w-[186px] shrink-0 flex-col gap-1 border-r border-border bg-surface-alt px-3 py-3.5 md:flex">
          <p className="mb-1 text-micro font-semibold tracking-[0.09em] text-text-subtle uppercase">
            Arrastra al lienzo
          </p>
          {BLOQUES.map((b) => (
            <div
              key={b.nombre}
              className="flex items-start gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 shadow-xs"
            >
              <svg
                viewBox="0 0 20 20" aria-hidden="true"
                className="mt-px h-3.5 w-3.5 shrink-0"
                style={{ color: TONOS[b.tono].etiqueta }}
              >
                <path d={b.icono} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="min-w-0">
                <span className="block text-micro leading-tight font-semibold">{b.nombre}</span>
                <span className="block text-[10px] leading-tight text-text-subtle">{b.que}</span>
              </span>
            </div>
          ))}
        </aside>

        {/* Lienzo */}
        <div className="patron-conversacion flex min-w-0 flex-1 items-center overflow-x-auto bg-bg py-4">
          <svg
            viewBox="0 0 1070 350"
            // En el celular el lienzo se dibuja más grande y se desliza: a
            // 760 px el texto de los nodos quedaba en unos 6 px, ilegible.
            className="h-auto w-full min-w-[1000px] md:min-w-[760px]"
            role="img"
            aria-label="Lienzo del constructor: entra un lead nuevo, se le envía la plantilla de bienvenida y una pregunta con botones abre dos ramas. «Ver precios» envía la lista y espera respuesta hasta 24 horas; «Agendar cita» reparte el lead entre los vendedores y crea la tarea de llamada. Al final, una condición pregunta si respondió y ramifica en Sí y No."
          >
            {/* Aristas primero: los nodos se pintan encima */}
            <g fill="none" stroke="var(--border-strong)" strokeWidth="1.4">
              <path d={arista(COL[0] + ANCHO_NODO, CARRIL.medio, COL[1], CARRIL.medio)} />
              <path d={arista(COL[1] + ANCHO_NODO, CARRIL.medio, COL[2], CARRIL.medio)} />
              {/* Las dos ramas de la pregunta salen de cada chip, no del centro */}
              <path d={arista(COL[2] + ANCHO_NODO, CARRIL.medio - 9, COL[3], CARRIL.alto)} />
              <path d={arista(COL[2] + ANCHO_NODO, CARRIL.medio + 11, COL[3], CARRIL.bajo)} />
              <path d={arista(COL[3] + ANCHO_NODO, CARRIL.alto, COL[4], CARRIL.alto)} />
              <path d={arista(COL[3] + ANCHO_NODO, CARRIL.bajo, COL[4], CARRIL.bajo)} />
              <path d={arista(COL[4] + ANCHO_NODO, CARRIL.alto, COL[5], CARRIL.alto)} />
              <path d={arista(COL[4] + ANCHO_NODO, CARRIL.bajo, COL[5], CARRIL.bajo)} />
              {/* Sí / No siguen fuera del encuadre: el lienzo es mas grande */}
              <path
                d={`M ${COL[5] + ANCHO_NODO} ${CARRIL.alto - 9} C ${COL[5] + ANCHO_NODO + 20} ${CARRIL.alto - 9}, ${COL[5] + ANCHO_NODO + 14} ${CARRIL.alto - 26}, ${COL[5] + ANCHO_NODO + 34} ${CARRIL.alto - 26}`}
                strokeDasharray="4 4"
              />
              <path
                d={`M ${COL[5] + ANCHO_NODO} ${CARRIL.alto + 11} C ${COL[5] + ANCHO_NODO + 20} ${CARRIL.alto + 11}, ${COL[5] + ANCHO_NODO + 14} ${CARRIL.alto + 28}, ${COL[5] + ANCHO_NODO + 34} ${CARRIL.alto + 28}`}
                strokeDasharray="4 4"
              />
            </g>

            {/* Puntos de conexion */}
            <g fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="1.2">
              <circle cx={COL[0] + ANCHO_NODO} cy={CARRIL.medio} r="2.6" />
              <circle cx={COL[2] + ANCHO_NODO} cy={CARRIL.medio - 9} r="2.6" />
              <circle cx={COL[2] + ANCHO_NODO} cy={CARRIL.medio + 11} r="2.6" />
              <circle cx={COL[5] + ANCHO_NODO} cy={CARRIL.alto - 9} r="2.6" />
              <circle cx={COL[5] + ANCHO_NODO} cy={CARRIL.alto + 11} r="2.6" />
            </g>

            <Nodo x={COL[0]} carril={CARRIL.medio} tono="accent"
              tipo="Disparador" lineas={["Entra un lead", "nuevo"]} />
            <Nodo x={COL[1]} carril={CARRIL.medio} tono="info"
              tipo="Acción" lineas={["Enviar plantilla", "de bienvenida"]} />
            <Nodo x={COL[2]} carril={CARRIL.medio} tono="warning"
              tipo="Pregunta" lineas={["¿Qué te interesa?"]}
              chips={[{ texto: "Ver precios" }, { texto: "Agendar cita" }]} />
            <Nodo x={COL[3]} carril={CARRIL.alto} tono="info"
              tipo="Acción" lineas={["Enviar lista de", "precios"]} />
            <Nodo x={COL[3]} carril={CARRIL.bajo} tono="accent"
              tipo="Round robin" lineas={["Repartir entre", "vendedores"]} />
            <Nodo x={COL[4]} carril={CARRIL.alto} tono="neutral"
              tipo="Pausa" lineas={["Esperar respuesta", "hasta 24 h"]} />
            <Nodo x={COL[4]} carril={CARRIL.bajo} tono="info"
              tipo="Acción" lineas={["Crear tarea:", "llamar mañana"]} />
            <Nodo x={COL[5]} carril={CARRIL.alto} tono="warning"
              tipo="Condición" lineas={["¿Respondió?"]}
              chips={[
                { texto: "Sí", fondo: "var(--success-soft)", tinta: "var(--accent-strong)" },
                { texto: "No", fondo: "var(--danger-soft)", tinta: "var(--danger)" },
              ]} />
            <Nodo x={COL[5]} carril={CARRIL.bajo} tono="neutral"
              tipo="Fin" lineas={["Termina esta ruta"]} />
          </svg>
        </div>
      </div>

      <p className="flex items-center justify-center gap-1.5 border-t border-border bg-surface px-4 py-2 text-micro text-text-subtle md:hidden">
        Desliza el lienzo para ver el flujo completo
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5">
          <path d="M3.5 10h13m0 0-4-4m4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </p>
    </div>
  );
}
