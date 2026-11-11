import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* La web es 100% estatica (dos rutas, ambas prerenderizadas): no hay
     imagenes optimizadas, ni rutas de API, ni datos de servidor. Con esto
     `next build` escribe una carpeta `out/` de HTML/CSS/JS plano que se
     sube a cualquier servidor sin Node detras.
     Si algun dia hace falta servidor (formulario con backend, ISR), se
     quita esta linea y se vuelve a `next build` + `next start`. */
  output: "export",
};

export default nextConfig;
