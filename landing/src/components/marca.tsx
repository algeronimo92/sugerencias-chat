/**
 * Simbolo de marca. Es el MISMO icono de la app (DermicaPro CRM,
 * `frontend/public/icon-512.png`): burbuja con tres puntos y cola abajo a la
 * izquierda. La geometria esta medida pixel a pixel de ese PNG y reescalada
 * a la retícula de 24 de los iconos del sistema — cuerpo 5.5..18.5 x 7..15.5,
 * puntos de radio 1 centrados en 8.72 / 12 / 15.28.
 *
 * Lo unico que NO se copia es el verde: el original usa el #008069 de
 * WhatsApp y aqui la teja va en `--accent` (#4f7c6b), que es el verde de la
 * paleta. Ver docs/direccion-arte.md, seccion 7.5.
 *
 * Los puntos son huecos (`fill-rule: evenodd`), no circulos pintados del
 * color del fondo: asi el simbolo funciona sobre la teja, sobre la barra
 * verde del producto o sobre cualquier otro fondo sin tocarlo.
 */

const D =
  // Cuerpo con cola: la esquina inferior izquierda lleva menos radio (1.55)
  // para que la cola salga de la curva en vez de cortarla.
  "M8 7H16A2.5 2.5 0 0 1 18.5 9.5V13A2.5 2.5 0 0 1 16 15.5H10.1L7.05 18.4V15.5" +
  "A1.55 1.55 0 0 1 5.5 13.95V9.5A2.5 2.5 0 0 1 8 7Z" +
  // Los tres puntos, como subtrazos: con evenodd quedan calados.
  "M7.72 11.15a1 1 0 1 0 2 0 1 1 0 1 0-2 0" +
  "M11 11.15a1 1 0 1 0 2 0 1 1 0 1 0-2 0" +
  "M14.28 11.15a1 1 0 1 0 2 0 1 1 0 1 0-2 0";

export function MarcaSimbolo({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d={D} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** Teja de acento con el simbolo dentro: la firma en la nav y en el pie. */
export function MarcaTeja({ className = "h-8 w-8" }: { className?: string }) {
  return (
    /* El simbolo ya trae su propio margen dentro de la caja de 24 (la burbuja
       ocupa el 54%), igual que el icono de la app sobre su teja. Por eso va a
       sangre y la teja NO le anade relleno: si se le pone, la burbuja encoge
       y el logo se lee como un icono suelto flotando en un cuadrado. */
    <span className={`grid shrink-0 place-items-center rounded-lg bg-accent text-accent-contrast ${className}`}>
      <MarcaSimbolo className="h-full w-full" />
    </span>
  );
}
