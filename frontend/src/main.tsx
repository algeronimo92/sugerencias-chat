import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadBrand } from './shared/branding'

// El panel de plataforma tiene su propia marca; el CRM toma la del negocio
// del dominio, también en la pantalla de acceso.
if (!window.location.pathname.startsWith('/platform')) void loadBrand()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
