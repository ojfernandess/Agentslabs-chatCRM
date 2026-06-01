FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace=apps/web --workspace=packages/shared

# Build shared package
FROM deps AS build-shared
COPY packages/shared/ packages/shared/
COPY tsconfig.base.json ./
RUN npm run build -w packages/shared

# Build frontend
FROM build-shared AS build
COPY apps/web/ apps/web/
ARG VITE_PUBLIC_ASSETS_VERSION=
ARG APP_VERSION=0.1.0
ENV VITE_PUBLIC_ASSETS_VERSION=$VITE_PUBLIC_ASSETS_VERSION
ENV VITE_APP_VERSION=$APP_VERSION
RUN npm run build -w apps/web

# Serve with nginx
FROM nginx:alpine AS production
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
