# Image API DORIA — Node 20 alpine, écoute sur 3001
# La clé Anthropic est lue depuis ANTHROPIC_API_KEY au runtime.
# Postgres est joint via les vars DATABASE_URL ou DB_HOST/DB_USER/DB_PASSWORD/DB_NAME.

FROM node:20-alpine
WORKDIR /app

# Install deps en couche séparée pour profiter du cache Docker
COPY package*.json ./
RUN npm install --omit=dev --silent

# Code applicatif (index + routes + module DB + migrations SQL)
COPY index.mjs ./
COPY routes ./routes
COPY db ./db

ENV PORT=3001
EXPOSE 3001

CMD ["node", "index.mjs"]
