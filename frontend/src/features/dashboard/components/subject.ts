/** A quién se está mirando en el dashboard: a quien lo abrió, al equipo o a
 *  una persona del equipo que eligió un admin. Los textos cambian con eso:
 *  "Lo que separé", "Lo que separó el equipo" o "Lo que separó Grecia". */
export type DashboardSubject =
  | { kind: 'me' }
  | { kind: 'team' }
  | { kind: 'seller'; name: string }

/** Lo propio de alguien (yo o una vendedora), frente al total del equipo. */
export function isPersonal(subject: DashboardSubject): boolean {
  return subject.kind !== 'team'
}

export function who(subject: DashboardSubject, texts: { me: string; team: string; seller: (name: string) => string }): string {
  if (subject.kind === 'me') return texts.me
  if (subject.kind === 'team') return texts.team
  return texts.seller(subject.name)
}
