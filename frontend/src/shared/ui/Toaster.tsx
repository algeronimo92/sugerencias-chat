import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'

export function AppToaster() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setTheme(root.classList.contains('dark') ? 'dark' : 'light'))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return (
    <Toaster
      theme={theme}
      position="top-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: 'font-sans !rounded-xl !border-wa-border !shadow-xl dark:!border-wa-border-dark dark:!bg-wa-head-dark dark:!text-wa-text-dark',
          description: '!text-wa-muted dark:!text-wa-muted-dark',
          actionButton: '!bg-wa-primary !text-white',
          cancelButton: '!bg-wa-field !text-wa-muted dark:!bg-wa-field-dark dark:!text-wa-muted-dark',
        },
      }}
    />
  )
}
