FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY services/runner/package.json services/runner/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY services/runner services/runner
RUN npm run build -w @cloudai/runner
RUN npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/runner/package.json ./services/runner/package.json
COPY --from=build /app/services/runner/dist ./services/runner/dist
EXPOSE 4000
CMD ["node", "services/runner/dist/index.js"]
