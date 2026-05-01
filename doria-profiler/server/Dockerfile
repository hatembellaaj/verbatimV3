# Image proxy Anthropic — Node 20 alpine, écoute sur 3001
# La clé API est lue depuis ANTHROPIC_API_KEY au runtime (jamais bakée dans l'image).

FROM node:20-alpine
WORKDIR /app

# Install deps en couche séparée pour profiter du cache Docker
COPY package*.json ./
RUN npm install --omit=dev --silent

COPY index.mjs ./

ENV PORT=3001
EXPOSE 3001

CMD ["node", "index.mjs"]
