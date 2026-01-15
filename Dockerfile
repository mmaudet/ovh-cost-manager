# OVH Cost Manager - Docker Image
FROM node:20-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./
COPY cli/package*.json ./cli/
COPY data/package*.json ./data/
COPY server/package*.json ./server/
COPY dashboard/package*.json ./dashboard/

# Install dependencies
RUN npm install --production=false

# Copy source code
COPY . .

# Build frontend
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/months || exit 1

# Start server
CMD ["npm", "run", "start"]
