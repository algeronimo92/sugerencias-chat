import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react'

import { PwaUpdatePrompt } from './PwaUpdatePrompt'
import { AppToaster } from '../shared/ui/Toaster'
import { queryClient } from '../shared/queryClient'

export function DataProviders({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

export function CrmProviders({ children }: { children: ReactNode }) {
  return (
    <DataProviders>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation} strict>
          {children}
          <AppToaster />
          <PwaUpdatePrompt />
        </LazyMotion>
      </MotionConfig>
    </DataProviders>
  )
}

export function AccountActionProviders({ children }: { children: ReactNode }) {
  return (
    <DataProviders>
      {children}
      <AppToaster />
    </DataProviders>
  )
}
