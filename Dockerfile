# ==========================================
# STAGE 1: Builder
# ==========================================
FROM node:22-slim AS builder

WORKDIR /app

# Copia manifestos de dependências
COPY package*.json tsconfig*.json vite.config.ts ./

# Instala dependências de build
RUN npm ci

# Copia código-fonte
COPY src ./src
COPY tests ./tests

# Compila cliente React SPA (dist/client) e servidor TypeScript (dist/server, dist/shared, dist/core, dist/exporters)
RUN npm run build

# ==========================================
# STAGE 2: Runner
# ==========================================
FROM node:22-slim AS runner

WORKDIR /app

# Instala suporte a OCR (Tesseract + idioma Português)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-por \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000

# Copia manifestos e instala apenas dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev

# Copia os artefatos compilados do builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.js"]
