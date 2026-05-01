# Image production — multi-stage : build Vite → service par nginx (port 80)
# Usage : docker build --build-arg VITE_ANTHROPIC_API_KEY=sk-... -t doria-profiler .
# (la clé est figée dans le bundle JS au build, comme tout VITE_ env var)

# ─── Stage 1 : build ─────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Args passés au build pour les VITE_ env vars
ARG VITE_ANTHROPIC_API_KEY=""
ENV VITE_ANTHROPIC_API_KEY=$VITE_ANTHROPIC_API_KEY

COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN npm run build

# ─── Stage 2 : serveur ───────────────────────────────────────────────────────
FROM nginx:alpine

# Configuration nginx pour SPA (fallback index.html)
RUN echo 'server { \
    listen 80; \
    server_name _; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    gzip on; \
    gzip_types text/plain text/css application/javascript application/json image/svg+xml; \
}' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
