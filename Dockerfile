# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Multi-stage build for the Next.js standalone output.
#
# The runtime stage carries only the traced server bundle, the static assets
# and public/ — no sources, no dev dependencies, no package manager step.
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:24-alpine

# --- dependencies ----------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# Only the manifests, so this layer is reused whenever sources change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- build -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next.config.ts sets output: "standalone", which emits .next/standalone.
RUN npm run build

# --- runtime ---------------------------------------------------------------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The node:*-alpine images ship an unprivileged "node" user (uid/gid 1000).
# Everything is copied already owned by it, so the runtime never needs root.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
# server.js serves these two itself; standalone does not copy them for you.
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

# Container-internal only. The reverse proxy reaches it over the shared
# network; no port is published to the host.
EXPOSE 3000

CMD ["node", "server.js"]
