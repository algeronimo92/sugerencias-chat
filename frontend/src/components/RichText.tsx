import { parseRichText } from '../utils/message'

interface Props {
  text: string
}

/** Texto de un mensaje con el formato de WhatsApp ya interpretado
 * (*negrita*, _cursiva_, ~tachado~, `código`) y los links navegables. */
export function RichText({ text }: Props) {
  return (
    <>
      {parseRichText(text).map((segment, i) => {
        switch (segment.type) {
          case 'link':
            return (
              <a
                key={i}
                href={segment.text}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-sky-600 dark:text-wa-accent hover:text-sky-800 dark:hover:text-sky-300 break-all not-italic"
              >
                {segment.text}
              </a>
            )
          case 'bold':
            return (
              <strong key={i} className="font-semibold">
                {segment.text}
              </strong>
            )
          case 'italic':
            return (
              <em key={i} className="italic">
                {segment.text}
              </em>
            )
          case 'strike':
            return (
              <span key={i} className="line-through">
                {segment.text}
              </span>
            )
          case 'code':
            return (
              <code
                key={i}
                className="font-mono text-[0.85em] bg-black/10 dark:bg-white/15 rounded px-1 py-0.5 not-italic"
              >
                {segment.text}
              </code>
            )
          default:
            return <span key={i}>{segment.text}</span>
        }
      })}
    </>
  )
}
