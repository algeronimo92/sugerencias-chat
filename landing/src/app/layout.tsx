import type { Metadata } from "next";
import "./globals.css";
import { Cabecera, Pie } from "@/components/navegacion";

const URL_SITIO = "https://cliniventas.com";

export const metadata: Metadata = {
  metadataBase: new URL(URL_SITIO),
  title: {
    default: "CliniVentas — El CRM de WhatsApp para clínicas, spas y centros médicos",
    template: "%s · CliniVentas",
  },
  description:
    "Tu equipo ya vende por WhatsApp. CliniVentas ordena esas conversaciones en un CRM: bandeja compartida sin cambiar de número, seguimiento por etapas, recordatorios y automatizaciones. Se aprende el primer día.",
  keywords: [
    "CRM para clínicas", "CRM WhatsApp", "software para spa", "CRM médico",
    "agenda de citas WhatsApp", "CRM centro estético", "gestión de leads clínica",
    "WhatsApp multiagente", "CRM para consultorios", "seguimiento de pacientes",
    "automatización WhatsApp clínicas", "CRM ventas salud", "software centro médico",
    "bandeja compartida WhatsApp", "CRM estética LATAM",
  ],
  authors: [{ name: "CliniVentas" }],
  openGraph: {
    type: "website",
    locale: "es_PE",
    url: URL_SITIO,
    siteName: "CliniVentas",
    title: "Se usa como WhatsApp. Vende como un CRM.",
    description:
      "El CRM para clínicas, spas y centros médicos que ya venden por WhatsApp. Sin cambiar de número y sin curva de aprendizaje.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Se usa como WhatsApp. Vende como un CRM.",
    description:
      "El CRM para clínicas, spas y centros médicos que ya venden por WhatsApp.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /* suppressHydrationWarning: el script de abajo escribe data-theme en <html>
       antes de hidratar, asi que el atributo del cliente nunca coincide con el
       del servidor. Es la discrepancia buscada —evita el parpadeo de tema— y
       React solo la ignora en ESTE nodo, no en sus hijos. */
    <html lang="es" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('tema');if(t)document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <Cabecera />
        {children}
        <Pie />
      </body>
    </html>
  );
}
