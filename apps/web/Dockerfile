# Multi-stage Dockerfile for Solutions Studio Web UI
FROM node:22-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy monorepo configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/domain/package.json ./packages/domain/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# Copy source trees
COPY packages/contracts ./packages/contracts
COPY packages/domain ./packages/domain
COPY apps/web ./apps/web

# Build dependencies and Next.js app
ARG NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:4000
ARG NEXT_PUBLIC_OIDC_ISSUER=http://localhost:8080/realms/solutions-studio
ARG NEXT_PUBLIC_OIDC_CLIENT_ID=solutions-studio-web

ENV NEXT_PUBLIC_ORCHESTRATOR_URL=$NEXT_PUBLIC_ORCHESTRATOR_URL
ENV NEXT_PUBLIC_OIDC_ISSUER=$NEXT_PUBLIC_OIDC_ISSUER
ENV NEXT_PUBLIC_OIDC_CLIENT_ID=$NEXT_PUBLIC_OIDC_CLIENT_ID

RUN pnpm --filter @solutions-studio/domain build && \
    pnpm --filter @solutions-studio/contracts build && \
    pnpm --filter @solutions-studio/web build

# Production runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app /app

EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=5s --start-period=10s --retries=10 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["pnpm", "--filter", "@solutions-studio/web", "start", "-p", "3000", "-H", "0.0.0.0"]
