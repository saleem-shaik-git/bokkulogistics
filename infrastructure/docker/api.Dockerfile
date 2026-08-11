# ── Base ─────────────────────────────────────────────────────
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ── Build ────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @bokku/api... run build && pnpm --filter @bokku/api deploy --prod /out

# ── Runtime ──────────────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S bokku && adduser -S bokku -G bokku
COPY --from=build --chown=bokku:bokku /out/node_modules ./node_modules
COPY --from=build --chown=bokku:bokku /out/apps/api/dist ./dist
COPY --from=build --chown=bokku:bokku /out/apps/api/package.json ./package.json
USER bokku
EXPOSE 4000
CMD ["node", "dist/main.js"]
