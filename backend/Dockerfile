# syntax=docker/dockerfile:1
# Multi-stage NestJS + Prisma image (cloud & on-prem).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
COPY prisma ./prisma
# Full install for compile + prisma generate (lockfile lives at monorepo root).
RUN npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npx tsc -p tsconfig.build.json

# Production node_modules: runtime deps + prisma CLI (migrate) + tsx (optional seed).
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json ./
COPY prisma ./prisma
RUN npm install --omit=dev \
  && npm install tsx --no-save \
  && npx prisma generate

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S bonpos && adduser -S bonpos -G bonpos

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh && chown -R bonpos:bonpos /app

USER bonpos
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
