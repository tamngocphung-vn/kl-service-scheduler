# syntax=docker/dockerfile:1

# ---- build: compile TypeScript and build the native better-sqlite3 module ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Toolchain in case no prebuilt better-sqlite3 binary matches this platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime: production dependencies + compiled JS only, non-root ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/scheduler.db \
    LOG_LEVEL=info
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
# Readiness includes a database check. Node 22 has fetch built in, so no curl is needed.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Exec form so node receives SIGTERM directly and runs the graceful shutdown in server.ts.
CMD ["node", "dist/server.js"]
