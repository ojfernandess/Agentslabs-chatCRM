FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
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

COPY apps/api/ apps/api/

RUN npm run build -w apps/api

# Production image
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl wget

ENV NODE_ENV=production

# Raiz + node_modules aninhados do workspace (npm coloca ex. date-fns em apps/api/node_modules)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=api-build /app/apps/api/dist ./apps/api/dist
COPY --from=build-shared /app/packages/shared/dist ./packages/shared/dist
COPY --from=prisma-gen /app/node_modules/.prisma ./node_modules/.prisma

# Copy source files
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/package.json ./apps/api/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY package.json ./

EXPOSE 3000

# 127.0.0.1 (não "localhost"): em alguns hosts localhost→::1 e o servidor pode só ouvir IPv4 → healthcheck falha.
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["sh", "-c", "set -e && npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma && if [ \"${RUN_DB_SEED:-false}\" = \"true\" ]; then npx tsx apps/api/prisma/seed.ts; fi && exec node apps/api/dist/server.js"]
