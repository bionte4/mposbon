# syntax=docker/dockerfile:1
# Multi-stage Vue SPA → static assets served by nginx.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

# Bake public API URL at build time (browser-visible). Prefer relative /api/v1
# when the SPA is served behind the compose gateway nginx.
ARG VITE_API_URL=/api/v1
ARG VITE_DEPLOYMENT_MODE=cloud
ARG VITE_DEFAULT_TENANT_SLUG=onprem-store
ENV VITE_API_URL=$VITE_API_URL \
    VITE_DEPLOYMENT_MODE=$VITE_DEPLOYMENT_MODE \
    VITE_DEFAULT_TENANT_SLUG=$VITE_DEFAULT_TENANT_SLUG

RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN chown -R nginx:nginx /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1
