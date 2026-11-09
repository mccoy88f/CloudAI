FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY services/runner/package.json services/runner/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY packages/shared packages/shared
COPY services/runner services/runner
RUN npm run build -w @cloudai/runner

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PATH="/root/.local/bin:${PATH}"
RUN apt-get update \
  && apt-get install -y --no-install-recommends git python3 python3-venv ripgrep ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY services/runner/package.json services/runner/
COPY packages/shared/package.json packages/shared/
RUN npm ci --omit=dev
COPY --from=build /app/services/runner/dist ./services/runner/dist
COPY services/runner/src/login_pty.py ./services/runner/dist/login_pty.py
RUN npm i -g @anthropic-ai/claude-code @google/gemini-cli \
  && (curl -fsSL https://cursor.com/install | bash || echo "cursor install skipped")
EXPOSE 4000
CMD ["node", "services/runner/dist/index.js"]
