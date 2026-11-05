FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.7.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/meta/package.json packages/meta/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/queue/package.json packages/queue/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS production-dependencies
WORKDIR /app
RUN npm install --global pnpm@11.7.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/meta/package.json packages/meta/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/queue/package.json packages/queue/package.json
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/admin/dist apps/admin/dist
COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/migrations packages/db/migrations
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/meta/dist packages/meta/dist
COPY --from=build /app/packages/observability/dist packages/observability/dist
COPY --from=build /app/packages/queue/dist packages/queue/dist

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ARG REVISION=unknown
LABEL org.opencontainers.image.revision=$REVISION
ENV NODE_ENV=production NODE_OPTIONS=--conditions=production HOST=0.0.0.0 PORT=3000
COPY --from=production-dependencies --chown=node:node /app/ ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
