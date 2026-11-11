# La landing es 100 % estática (next.config.ts: output "export"): Node solo
# hace falta para compilar. Lo que queda corriendo es un nginx con la carpeta
# `out/` adentro.

# ---- build ----
FROM node:22.23.5-alpine3.24 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Next manda telemetría anónima en cada build salvo que se le diga que no.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- prod ----
FROM nginx:1.30.6-alpine3.24 AS prod
COPY --from=build /app/out /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
