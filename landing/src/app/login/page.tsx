import type { Metadata } from "next";
import { FormularioLogin } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Entrar",
  description: "Accede al panel de tu clínica en CliniVentas.",
  alternates: { canonical: "/login" },
  /* Una pantalla de acceso no aporta nada en un buscador, y salir en los
     resultados solo facilita que alguien monte una copia para phishing. */
  robots: { index: false, follow: false },
};

export default function Login() {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16 sm:py-24">
      <FormularioLogin />
    </main>
  );
}
