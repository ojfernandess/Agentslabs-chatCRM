FROM node:20-alpine AS deps

WORKDIR /app

# mem0ai instala peers nativos (better-sqlite3); peers omitidos quebram date-fns-tz → date-fns.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

# Instalar API + shared (parte das deps fica em apps/api/node_modules com isolamento do lockfile).
RUN npm ci --workspace=apps/api --workspace=packages/shared

# Build shared first
FROM deps AS build-shared

COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/

RUN npm run build -w packages/shared

# Generate Prisma
FROM build-shared AS prisma-gen

COPY apps/api/prisma/ apps/api/prisma/

RUN npx prisma generate --schema=apps/api/prisma/schema.prisma

# Build API
FROM prisma-gen AS api-build

ARG APP_VERSION=0.1.0
ENV APP_VERSION=$APP_VERSION

COPY apps/api/ apps/api/

RUN npm run build -w apps/api

# Production image
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production
ARG APP_VERSION=0.1.0
ENV APP_VERSION=$APP_VERSION

# Raiz + node_modules aninhados do workspace (npm coloca ex. date-fns em apps/api/node_modules)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-build /app/apps/api/dist ./apps/api/dist
COPY --from=api-build /app/apps/api/public ./apps/api/public
COPY --from=build-shared /app/packages/shared/dist ./packages/shared/dist
COPY --from=prisma-gen /app/node_modules/.prisma ./node_modules/.prisma

# Copy source files
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY package.json ./

EXPOSE 3000

# Node (fetch) evita depender de wget/busybox; HOST=:: no compose aceita IPv4+IPv6 no loopback.
HEALTHCHECK --interval=30s --timeout=15s --start-period=600s --retries=8 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r&&r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["/usr/local/bin/docker-entrypoint.sh"]
