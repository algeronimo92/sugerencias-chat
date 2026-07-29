import { Megaphone } from 'lucide-react'
import type { AdReferral } from '../utils/message'

/** Tarjeta del anuncio del que vino el lead (Click-to-WhatsApp de Meta), como
 * la que WhatsApp muestra sobre el primer mensaje: miniatura + título + un
 * rótulo "Del anuncio". Si trae link, abre el anuncio. */
export function AdReferralCard({ ad }: { ad: AdReferral }) {
  const Wrapper = ad.sourceUrl ? 'a' : 'div'
  return (
    <Wrapper
      {...(ad.sourceUrl ? { href: ad.sourceUrl, target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`mb-1 block overflow-hidden rounded-md border-l-4 border-wa-primary bg-black/5 dark:bg-white/10 ${
        ad.sourceUrl ? 'cursor-pointer hover:bg-black/10 dark:hover:bg-white/15' : ''
      }`}
    >
      <div className="flex items-center gap-1 px-2 pt-1.5 text-[11px] font-semibold text-wa-primary-strong dark:text-wa-primary">
        <Megaphone aria-hidden="true" className="h-3 w-3" />
        Del anuncio
      </div>
      <div className="flex gap-2 px-2 pb-2 pt-1">
        {ad.thumbnailUrl && (
          <img
            src={ad.thumbnailUrl}
            alt=""
            loading="lazy"
            className="h-12 w-12 shrink-0 rounded object-cover"
          />
        )}
        <div className="min-w-0">
          {ad.title && (
            <p className="truncate text-xs font-medium text-wa-text dark:text-wa-text-dark">{ad.title}</p>
          )}
          {ad.body && (
            <p className="line-clamp-2 text-[11px] text-wa-muted dark:text-wa-text-dark/70">{ad.body}</p>
          )}
        </div>
      </div>
    </Wrapper>
  )
}
