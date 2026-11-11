/** Iconos de linea, 24x24, trazo 1.7. Heredan color con currentColor. */
const P = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
      {children}
    </svg>
  );
}

export const IconoChat = () => (
  <Svg><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z" {...P} /></Svg>
);
export const IconoReloj = () => (
  <Svg><circle cx="12" cy="12" r="8.5" {...P} /><path d="M12 7.2V12l3.2 2.2" {...P} /></Svg>
);
export const IconoFlujo = () => (
  <Svg><rect x="3" y="4" width="6" height="5" rx="1.4" {...P} /><rect x="15" y="15" width="6" height="5" rx="1.4" {...P} /><rect x="3" y="15" width="6" height="5" rx="1.4" {...P} /><path d="M9 6.5h4.2A1.8 1.8 0 0 1 15 8.3v9.2M6 9v6" {...P} /></Svg>
);
export const IconoIA = () => (
  <Svg><path d="m12 3.4 1.9 4.7 4.7 1.9-4.7 1.9L12 16.6l-1.9-4.7-4.7-1.9 4.7-1.9z" {...P} /><path d="M18.4 15.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" {...P} /></Svg>
);
export const IconoKanban = () => (
  <Svg><rect x="3.5" y="4" width="17" height="16" rx="1.8" {...P} /><path d="M9.2 4v16M14.8 4v16" {...P} /></Svg>
);
export const IconoTarea = () => (
  <Svg><rect x="4" y="5" width="16" height="15" rx="1.8" {...P} /><path d="M8 3.2v3.4M16 3.2v3.4M8.6 13.4l2.2 2.2 4.4-4.4" {...P} /></Svg>
);
export const IconoPlantilla = () => (
  <Svg><path d="M6 3.5h8.5L19 8v12.5H6z" {...P} /><path d="M14 3.5V8h5M9 12.5h6M9 16h4" {...P} /></Svg>
);
export const IconoGrafico = () => (
  <Svg><path d="M4 20V4M4 20h16" {...P} /><path d="M7.5 16.5v-4M12 16.5v-8M16.5 16.5v-5.5" {...P} /></Svg>
);
export const IconoCalendario = () => (
  <Svg><rect x="3.5" y="5" width="17" height="15" rx="1.8" {...P} /><path d="M3.5 9.5h17M8 3.2v3.6M16 3.2v3.6" {...P} /></Svg>
);
export const IconoNota = () => (
  <Svg><path d="M5 4.5h14v15H5z" {...P} /><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" {...P} /></Svg>
);
export const IconoEquipo = () => (
  <Svg><circle cx="9" cy="8.5" r="3.2" {...P} /><path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" {...P} /><path d="M16 5.8a3.2 3.2 0 0 1 0 5.4M17.5 14.9c1.9.6 3.2 2.3 3.2 4.6" {...P} /></Svg>
);
export const IconoEscudo = () => (
  <Svg><path d="M12 3.2 19 6v6c0 4.2-2.9 7.2-7 8.8-4.1-1.6-7-4.6-7-8.8V6z" {...P} /><path d="m8.9 12 2.1 2.1 4.1-4.2" {...P} /></Svg>
);
export const IconoBusqueda = () => (
  <Svg><circle cx="10.5" cy="10.5" r="6.4" {...P} /><path d="m15.4 15.4 4.1 4.1" {...P} /></Svg>
);
export const IconoTelefono = () => (
  <Svg><rect x="6.5" y="2.8" width="11" height="18.4" rx="2.4" {...P} /><path d="M10.6 5.6h2.8" {...P} /></Svg>
);
