import { ArrowRightLeft, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "../../../shared/ui/Button";

// Mudar el mismo número de un modo al otro no lo hace Meta ni la API: la
// clínica tiene que hacer un paso fuera del CRM (borrar la cuenta en la app, o
// dar de baja el número en Meta). Los pasos salen de la ayuda de proveedores
// (360dialog, Infobip, YCloud); Meta no tiene una guía oficial de esta mudanza.

const MOVE_STEPS = [
  "Si quieres conservar los chats del celular, haz una copia de seguridad en la app.",
  "En la app WhatsApp Business del celular, borra la cuenta (Ajustes › Cuenta › Eliminar cuenta).",
  "Vuelve aquí y continúa: en la ventana de Meta escribe el mismo número y verifica el código que te llega por SMS o llamada.",
];

const MOVE_CONSEQUENCES = [
  "El número deja de funcionar en el celular y en WhatsApp Web: todo se atiende desde el CRM.",
  "Los chats que ya están en el CRM se quedan; los del celular solo si hiciste la copia.",
  "Mientras dura la mudanza el CRM no recibe mensajes.",
  "Volver al celular después es largo: hay que dar de baja el número en Meta y registrarlo de nuevo en la app.",
  "A cambio, se pueden atender llamadas de WhatsApp desde el CRM.",
];

interface MoveProps {
  onContinue: () => void;
  onCancel: () => void;
  disabled?: boolean;
  pending?: boolean;
}

/** Guía para pasar el número que está en la app del celular a solo CRM. Pide
 *  confirmar que ya se borró la cuenta en la app: si no, Meta rechaza el
 *  número porque sigue activo ahí. */
export function MoveToCrmOnly({ onContinue, onCancel, disabled = false, pending = false }: MoveProps) {
  const [confirmed, setConfirmed] = useState(false);
  const checkboxId = useId();
  return (
    <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
      <h3 className="text-sm font-medium text-wa-text dark:text-wa-text-dark">
        Pasar este número a solo CRM
      </h3>
      <div className="space-y-1">
        <p className="text-xs font-medium text-wa-text dark:text-wa-text-dark">Qué cambia</p>
        <ul className="list-disc space-y-1 pl-4 text-[11px] text-wa-muted dark:text-wa-muted-dark">
          {MOVE_CONSEQUENCES.map(item => <li key={item}>{item}</li>)}
        </ul>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-wa-text dark:text-wa-text-dark">Pasos</p>
        <ol className="list-decimal space-y-1 pl-4 text-[11px] text-wa-muted dark:text-wa-muted-dark">
          {MOVE_STEPS.map(item => <li key={item}>{item}</li>)}
        </ol>
      </div>
      <label htmlFor={checkboxId} className="flex items-start gap-2 text-xs text-wa-text dark:text-wa-text-dark">
        <input
          id={checkboxId}
          type="checkbox"
          checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)}
          className="mt-0.5 accent-wa-primary"
        />
        Ya borré la cuenta de WhatsApp Business en el celular.
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={onContinue} disabled={!confirmed || disabled || pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Continuar con Meta
        </Button>
      </div>
    </section>
  );
}

/** Para un número que ya está solo en el CRM: volver a la app del celular no
 *  es un botón (Meta no convierte un número activo en la API), así que se
 *  explica el camino. */
export function BackToPhoneHint() {
  return (
    <details className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-wa-text dark:text-wa-text-dark">
        <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
        ¿Quieres volver a usar este número en el celular?
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-4">
        <li>En el Administrador de WhatsApp de Meta, elimina el número de la cuenta.</li>
        <li>Espera a que Meta lo libere (puede tardar) y regístralo en la app WhatsApp Business del celular.</li>
        <li>Vuelve aquí, pulsa «Conectar otro número» y elige «Seguir usando WhatsApp en tu celular».</li>
      </ol>
      <p className="mt-1">Mientras tanto el CRM no recibe ni envía mensajes de este número.</p>
    </details>
  );
}
