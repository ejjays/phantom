FROM node:24-slim

WORKDIR /app

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN set -ex; \
    export DEBIAN_FRONTEND=noninteractive; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-full \
    ffmpeg \
    curl \
    unzip; \
    curl -fsSL https://deno.land/install.sh | sh; \
    rm -rf /var/lib/apt/lists/*

ENV DENO_INSTALL="/root/.deno"
ENV PATH="$DENO_INSTALL/bin:$PATH"

RUN python3 -m venv /opt/tool-venv \
    && /opt/tool-venv/bin/pip install --upgrade pip \
    && /opt/tool-venv/bin/pip install --upgrade --pre yt-dlp kaggle yt-dlp-getpot-wpc
ENV PATH="/opt/tool-venv/bin:$PATH"

# single root lockfile; -w keeps the image lean (no mobile/frontend deps),
# --ignore-scripts skips husky + native postinstalls
COPY package.json package-lock.json ./
COPY web/shared/package.json ./web/shared/
COPY web/backend/package.json ./web/backend/
COPY packages/extractors/package.json ./packages/extractors/
RUN npm ci --ignore-scripts -w web/backend -w web/shared -w packages/extractors

COPY web/shared/ ./web/shared/
COPY packages/extractors/ ./packages/extractors/
RUN npm run build -w packages/extractors

WORKDIR /app/web/backend
COPY web/backend/ ./
RUN npx tsc

RUN mkdir -p temp && chmod 777 temp

ENV PORT=8000
ENV API_ONLY=true
EXPOSE 8000

CMD ["node", "--import", "./dist/backend/src/instrument.js", "dist/backend/src/app.js"]
