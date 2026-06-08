# Image: registry.staffbase.com/sb-images/cc-custom-plugin-template

# ── Stage 1: builder ──────────────────────────────────────────────────────────
# Digest-pin pattern `IMAGE:TAG@sha256:...` (Sonar S8431) is the
# Dependabot-recommended form: digest gives reproducibility + closes
# transient base-image CVEs, tag stays for human readability so the
# Dependabot bump PR shows `1-alpine` → `1-alpine` (digest changes only).
FROM oven/bun:1-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS builder
WORKDIR /app

# Copy workspace manifests first — maximises layer cache hits
COPY package.json bun.lock bunfig.toml ./
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY widget/package.json ./widget/

# Mount NPM token as a build secret — write .npmrc, install, then remove (REQ-004)
RUN --mount=type=secret,id=npm_token \
    echo "//npm.pkg.github.com/:_authToken=$(cat /run/secrets/npm_token)" > /root/.npmrc && \
    echo "@staffbase:registry=https://npm.pkg.github.com" >> /root/.npmrc && \
    bun install --frozen-lockfile && \
    bun install --cwd widget && \
    rm /root/.npmrc

# Copy full source after dependencies are installed
COPY . .

# Build client → outputs to dist/public/ (vite.config.ts build.outDir: "../dist/public")
RUN bun run --filter ./client build

# Build widget — must run AFTER client build so Vite's emptyOutDir does not delete it.
RUN (cd widget && bun run build) && \
    mkdir -p dist/public/widget && \
    cp widget/dist/*.js dist/public/widget/ && \
    cp widget/dist/manifest.json dist/public/widget/

# ── Stage 2: runner ───────────────────────────────────────────────────────────
# Same digest-pin pattern as the builder above — see comment there.
FROM oven/bun:1-distroless@sha256:c28c51287af70bab8e0b66fc4b6a30cfb92a727ebc88045223adc9f4c9d09307 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV LOG_FORMAT=json
ENV LOG_LEVEL=INFO

# Copy workspace manifests and production node_modules only (REQ-003)
COPY --from=builder /app/package.json /app/bun.lock /app/bunfig.toml ./
COPY --from=builder /app/server ./server
COPY --from=builder /app/node_modules ./node_modules

# Client static assets served by Hono's serveStatic
COPY --from=builder /app/dist/public ./dist/public

# Run as unprivileged user — never root (CON-002)
# distroless ships 'nonroot' (UID 65534); alpine shipped 'bun'
USER nonroot
EXPOSE 3000

CMD ["run", "server/src/index.ts"]
