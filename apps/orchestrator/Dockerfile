# Multi-stage Dockerfile for Solutions Studio Orchestrator
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy monorepo configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/domain/package.json ./packages/domain/
COPY apps/orchestrator/package.json ./apps/orchestrator/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source trees
COPY packages/contracts ./packages/contracts
COPY packages/domain ./packages/domain
COPY apps/orchestrator ./apps/orchestrator

# Build domain, contracts, and orchestrator
RUN pnpm --filter @solutions-studio/domain build && \
    pnpm --filter @solutions-studio/contracts build && \
    pnpm --filter @solutions-studio/orchestrator build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

COPY --from=builder /app /app

EXPOSE 4000

HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=10 \
  CMD wget -qO- http://127.0.0.1:4000/api/health/live || exit 1

CMD ["pnpm", "--filter", "@solutions-studio/orchestrator", "exec", "tsx", "scripts/run-http-server.ts", "--port", "4000", "--host", "0.0.0.0"]
