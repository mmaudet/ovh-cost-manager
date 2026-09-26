# OVH Cost Manager - Docker Image
# Multi-stage build: run npm/node natively on build host, avoid QEMU emulation

# Stage 1: Build on the host platform (no QEMU)
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder

ARG TARGETARCH

WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./
COPY cli/package*.json ./cli/
COPY data/package*.json ./data/
COPY server/package*.json ./server/
COPY dashboard/package*.json ./dashboard/

# Install dependencies without native compilation scripts
RUN npm install --ignore-scripts --production=false

# Download prebuilt better-sqlite3 binary for the TARGET architecture
RUN ARCH=$TARGETARCH; \
    if [ "$ARCH" = "amd64" ]; then ARCH=x64; fi; \
    cd /app/node_modules/better-sqlite3 && \
    npx --yes prebuild-install --arch $ARCH --platform linux --libc musl || \
    { echo "ERROR: No prebuilt binary found for better-sqlite3 ($TARGETARCH)"; exit 1; }

# Copy source code
COPY . .

# Build frontend (pure JS bundling, runs natively)
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Stage 2: Runtime image (target platform). Keep the same Node major as the
# builder: prebuild-install picks the better-sqlite3 binary for its Node ABI.
FROM node:24-alpine

WORKDIR /app

COPY --from=builder /app .

# Make scripts executable
RUN chmod +x /app/scripts/*.sh

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# Start server with periodic import
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
