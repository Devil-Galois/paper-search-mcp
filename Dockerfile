FROM node:20-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts/configure.mjs ./scripts/configure.mjs
COPY README.md LICENSE .env.example ./

ENV PAPER_SEARCH_CACHE_DIR=/tmp/paper-search-mcp-cache
CMD ["node", "src/server.js"]
