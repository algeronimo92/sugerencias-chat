# ---- base ----
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

# ---- dev ----
FROM base AS dev
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- build (used by prod stage) ----
FROM base AS build
RUN npm ci
COPY . .
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
# Identificador del build que la app escribe en consola (ver vite.config.ts).
# Vacío, cae a la hora del build; el deploy puede pasar el SHA del commit.
ARG VITE_BUILD_ID=""
ENV VITE_BUILD_ID=$VITE_BUILD_ID
RUN npm run build

# ---- prod ----
FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
