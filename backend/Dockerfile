# Backend + static frontend in one image (uses the docker sandbox driver via the host socket).
# Build from the repository root: docker build -f backend/Dockerfile -t cstudio .
FROM node:22-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends docker.io && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npx tsc -p tsconfig.json
COPY --from=web /app/dist /app/dist
ENV CSTUDIO_SANDBOX=docker CSTUDIO_STATIC=/app/dist CSTUDIO_WORK_ROOT=/var/cstudio-jobs
EXPOSE 8787
CMD ["node", "dist/server.js"]
