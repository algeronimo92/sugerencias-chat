"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { useId, useRef, useState } from "react";

/**
 * Selector desplegable con el mismo diseño que el del CRM
 * (frontend/src/shared/ui/Input.tsx): Radix Select, flecha que gira al
 * abrir, lista en una tarjeta y un check en la opción elegida. La landing
 * no comparte código con el CRM, así que se replica con sus colores.
 *
 * Dentro de un <form>, Radix dibuja un <select> nativo oculto con el mismo
 * `name`: FormData lo lee y `required` bloquea el envío igual que antes.
 * Pero el aviso del navegador ("selecciona un elemento") se ancla a ese
 * select oculto y no se ve: quien tocaba "Enviar" no sabía qué le faltaba.
 * Por eso el selector atrapa el `invalid`, se marca en rojo con su propio
 * mensaje y, si es el primero que falta, recibe el foco.
 * El valor vacío muestra el texto de ayuda; ninguna opción puede ser "".
 */

export type OpcionSelector = string | readonly [valor: string, etiqueta: string];

function separar(opcion: OpcionSelector): [string, string] {
  return typeof opcion === "string" ? [opcion, opcion] : [opcion[0], opcion[1]];
}

function Flecha({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={`h-4 w-4 ${className}`}>
      <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Selector({
  id, name, opciones, requerido = false, valor, cambiar, ayuda = "Elige una opción",
}: {
  id: string;
  name: string;
  opciones: readonly OpcionSelector[];
  requerido?: boolean;
  /** Si se pasa, el selector es controlado; si no, guarda su propio valor. */
  valor?: string;
  cambiar?: (valor: string) => void;
  ayuda?: string;
}) {
  const [interno, setInterno] = useState("");
  const [falta, setFalta] = useState(false);
  const boton = useRef<HTMLButtonElement>(null);
  const idError = useId();
  const actual = valor ?? interno;

  function invalido(evento: React.FormEvent<HTMLDivElement>) {
    if (!(evento.target instanceof HTMLSelectElement)) return;
    evento.preventDefault();
    setFalta(true);
    // El navegador lleva el foco al primer campo que falta; si es este, el
    // foco va al botón visible y no al select oculto.
    if (evento.target.form?.querySelector(":invalid") === evento.target) boton.current?.focus();
  }

  return (
    <div onInvalidCapture={invalido}>
    <SelectPrimitive.Root
      name={name}
      required={requerido}
      value={actual}
      onValueChange={(nuevo) => {
        setInterno(nuevo);
        setFalta(false);
        cambiar?.(nuevo);
      }}
    >
      <SelectPrimitive.Trigger
        id={id}
        ref={boton}
        aria-invalid={falta || undefined}
        aria-describedby={falta ? idError : undefined}
        className="group relative flex min-h-11 w-full min-w-0 cursor-pointer items-center rounded-lg border border-border-field bg-surface py-2.5 pr-10 pl-3.5 text-left text-body-sm shadow-xs transition-[border-color,box-shadow] duration-[var(--duration-rapida)] ease-suave hover:border-border-strong focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-invalid:border-danger data-[placeholder]:text-text-subtle"
      >
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={ayuda} />
        </span>
        <SelectPrimitive.Icon asChild>
          <Flecha className="pointer-events-none absolute right-3 text-text-muted transition-transform duration-150 group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={5}
          collisionPadding={8}
          className="selector-contenido z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface-raised text-text shadow-lg"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-7 items-center justify-center text-text-muted">
            <Flecha className="rotate-180" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {opciones.map((opcion) => {
              const [valorOpcion, etiqueta] = separar(opcion);
              return (
                <SelectPrimitive.Item
                  key={valorOpcion}
                  value={valorOpcion}
                  className="relative flex cursor-default items-center rounded-md py-2 pr-9 pl-3 text-body-sm outline-none select-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-text"
                >
                  <SelectPrimitive.ItemText>{etiqueta}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex items-center text-accent-strong">
                    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4">
                      <path d="m3.4 8.3 2.9 2.9 6.3-6.4" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-7 items-center justify-center text-text-muted">
            <Flecha />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
    {falta && (
      <p id={idError} className="mt-1.5 text-caption text-danger">Elige una opción para continuar.</p>
    )}
    </div>
  );
}
