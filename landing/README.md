# Landing de CliniVentas (cliniventas.com)

La página pública del producto: portada, `/login` (resuelve a qué clínica
pertenece un correo y manda a su subdominio; no autentica), `/privacidad` y
`/tratamiento-de-datos`.

Es un proyecto aparte del frontend del CRM (`../frontend`): Next.js con
`output: "export"`, es decir, `next build` escribe HTML/CSS/JS plano en `out/`
y no hay servidor de Node en producción. No comparte código ni dependencias
con el CRM.

Antes de tocar código de Next, leer [AGENTS.md](AGENTS.md): esta versión
cambia APIs respecto de las anteriores.

## Desarrollo

```bash
npm ci
npm run dev      # http://localhost:3000
npm run lint
npm run build    # escribe out/
```

## Dónde está cada cosa

| Ruta | Qué es |
|---|---|
| `src/app/` | Las páginas (una carpeta por ruta) y `not-found.tsx`, que genera `404.html` |
| `src/components/` | Secciones de la portada, navegación, formulario de `/login` |
| `src/textos.ts` · `src/datos-legales.ts` | Los textos de la portada y los datos de las páginas legales |
| `src/inquilinos.ts` | Qué correo pertenece a qué clínica. **Dar de alta una clínica en el CRM no la agrega acá:** hay que sumar su entrada para que `/login` la reconozca |
| `docs/` | Dirección de arte, estrategia de mensaje e inventario de producto |
| `nginx.conf` · `Dockerfile` | Cómo se sirve en producción |

## Producción

Corre en el mismo servidor que el CRM, como un contenedor aparte detrás del
mismo Traefik. El detalle (despliegue, enrutado, DNS) está en el
[README de la raíz](../README.md#6-landing-cliniventascom).

```bash
# La imagen de producción, en http://127.0.0.1:8090
docker compose -f ../compose.landing.yml up -d --build
../scripts/landing-smoke.sh http://127.0.0.1:8090
```

`nginx.conf` hace a mano lo que Next haría con un servidor propio: servir
`/privacidad` desde `privacidad.html`, quitar el `.html` y la barra final de la
URL, mandar `www` al dominio sin `www`, la página 404 propia y la caché (el
HTML nunca se cachea; lo de `/_next/static/` lleva hash y se cachea un año).
Si se agrega una ruta o cambia una regla, `scripts/landing-smoke.sh` es lo
que comprueba que sigue respondiendo bien; CI y el despliegue lo corren.

Las fuentes de `public/fonts/` no llevan hash en el nombre y se cachean un
año: para reemplazar una hay que cambiarle el nombre.
