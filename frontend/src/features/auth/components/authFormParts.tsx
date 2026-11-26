export const authFieldClass =
  "h-12 rounded-xl border-wa-border bg-white pl-11 pr-4 text-[15px] shadow-sm placeholder:text-wa-muted/80 hover:border-gray-300 focus:border-wa-primary focus:bg-white focus:ring-4 focus:ring-wa-primary/10 dark:border-wa-border-dark dark:bg-wa-head-dark dark:hover:border-wa-muted/50 dark:focus:border-wa-primary dark:focus:bg-wa-head-dark";

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/80 dark:bg-red-950/35 dark:text-red-300"
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/60">
        <span className="text-xs font-bold" aria-hidden="true">
          !
        </span>
      </span>
      <span>{message}</span>
    </div>
  );
}
