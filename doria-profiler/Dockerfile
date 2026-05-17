# Image production — multi-stage : build Vite → service par nginx (port 80)
# Usage : docker build -t doria-profiler .
# La clé Anthropic n'est PLUS bakée dans le bundle ; elle vit côté proxy (service `api`).
# Nginx route /api/ → http://api:3001/api/ et tout le reste → SPA index.html.

# ─── Stage 1 : build ─────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --silent

COPY . .
RUN npm run build

# ─── Stage 2 : serveur ───────────────────────────────────────────────────────
FROM nginx:alpine

# Configuration nginx : SPA + reverse-proxy /api/ vers le service api (proxy Node)
RUN printf '%s\n' \
    'server {' \
    '    listen 80;' \
    '    server_name _;' \
    '    root /usr/share/nginx/html;' \
    '    index index.html;' \
    '    client_max_body_size 10m;' \
    '' \
    '    # Resolver Docker interne — force la re-résolution DNS des upstreams' \
    '    # quand les containers api/embed sont recréés (sinon nginx garde l'\''ancienne IP).' \
    '    resolver 127.0.0.11 valid=10s ipv6=off;' \
    '' \
    '    # Service embeddings local (Solon FR) — doit être AVANT location /api/' \
    '    # proxy_pass littéral avec trailing slash → nginx strippe automatiquement' \
    '    # le préfixe /api/embed/. (Le service embed est rarement recréé donc le' \
    '    # cache DNS n'\''est pas un problème ici, contrairement à api.)' \
    '    location /api/embed/ {' \
    '        proxy_pass http://embed:8000/;' \
    '        proxy_http_version 1.1;' \
    '        proxy_set_header Host $host;' \
    '        proxy_read_timeout 180s;' \
    '        proxy_send_timeout 180s;' \
    '        client_max_body_size 20m;' \
    '    }' \
    '' \
    '    # Proxy vers le service Node (Anthropic + DB)' \
    '    location /api/ {' \
    '        set $api_upstream http://api:3001;' \
    '        proxy_pass $api_upstream$request_uri;' \
    '        proxy_http_version 1.1;' \
    '        proxy_set_header Host $host;' \
    '        proxy_set_header X-Real-IP $remote_addr;' \
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
    '        proxy_read_timeout 180s;' \
    '        proxy_send_timeout 180s;' \
    '    }' \
    '' \
    '    # SPA fallback' \
    '    location / {' \
    '        try_files $uri $uri/ /index.html;' \
    '    }' \
    '' \
    '    gzip on;' \
    '    gzip_types text/plain text/css application/javascript application/json image/svg+xml;' \
    '}' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
