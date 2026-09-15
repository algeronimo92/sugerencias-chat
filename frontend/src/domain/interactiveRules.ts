import type { TemplateInteractiveButton } from '../types'

export const INTERACTIVE_REPLY_PROMPT = 'Responde con el número de la opción que deseas.'

const BUTTON_FALLBACK_DETAIL: Record<Exclude<TemplateInteractiveButton['type'], 'reply'>, (button: TemplateInteractiveButton) => string> = {
  url: button => button.url ?? '',
  call: button => button.phoneNumber ?? '',
  copy: button => button.copyCode ?? '',
}

export function buttonFallbackLine(button: TemplateInteractiveButton, index: number): string {
  if (button.type === 'reply') return `${index + 1}. ${button.displayText}`
  return `• ${button.displayText}: ${BUTTON_FALLBACK_DETAIL[button.type](button)}`
}

export function exceedsLimit(value: string, limit: number | undefined): limit is number {
  return limit !== undefined && value.length > limit
}
