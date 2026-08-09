# ── Base ─────────────────────────────────────────────────────
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# ── Build ────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @bokku/web... run build

# ── Runtime ──────────────────────────────────────────────────
FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S bokku && adduser -S bokku -G bokku
COPY --from=build --chown=bokku:bokku /app/apps/web/.next ./.next
COPY --from=build --chown=bokku:bokku /app/apps/web/public ./public
COPY --from=build --chown=bokku:bokku /app/apps/web/package.json ./package.json
COPY --from=build --chown=bokku:bokku /app/apps/web/next.config.ts ./next.config.ts
COPY --from=build --chown=bokku:bokku /app/node_modules ./node_modules
USER bokku
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-p", "3000", "-H", "0.0.0.0"]
