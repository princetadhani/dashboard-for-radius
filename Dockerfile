# syntax=docker/dockerfile:1.7

# ---------- Stage 1: builder ----------
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ openssl

WORKDIR /build

# Frontend (repo root) deps
COPY package.json package-lock.json ./
RUN npm ci

# Backend deps
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci

# Full source
COPY . .

# Backend: generate Prisma client + tsc build
RUN cd backend \
 && npx prisma generate \
 && npm run build

# Frontend: build with empty NEXT_PUBLIC_BACKEND_URL so all fetch/socket calls
# resolve same-origin against whatever host serves the page. The app reads it
# with `??`, so empty string is preserved (not replaced by the localhost fallback).
ENV NEXT_PUBLIC_BACKEND_URL=""
RUN npm run build

# Prune dev deps from both trees
RUN npm prune --omit=dev \
 && cd backend && npm prune --omit=dev


# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runtime

RUN apk add --no-cache nginx supervisor openssl tini \
 && mkdir -p /run/nginx /var/log/supervisor /app/data

WORKDIR /app

# Frontend runtime artifacts
COPY --from=builder /build/.next ./.next
COPY --from=builder /build/public ./public
COPY --from=builder /build/package.json ./package.json
COPY --from=builder /build/next.config.ts ./next.config.ts
COPY --from=builder /build/node_modules ./node_modules

# Backend runtime artifacts
COPY --from=builder /build/backend/dist ./backend/dist
COPY --from=builder /build/backend/prisma ./backend/prisma
COPY --from=builder /build/backend/package.json ./backend/package.json
COPY --from=builder /build/backend/node_modules ./backend/node_modules

# Process & proxy config
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisord.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1/api/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
