FROM node:20-slim

WORKDIR /app

# Install dependencies first (layer-cached unless package files change)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./

# Store HuggingFace model cache in a predictable path so it can be
# volume-mounted and survive container restarts.
ENV HF_HOME=/app/cache

EXPOSE 5423

CMD ["node", "server.js"]
