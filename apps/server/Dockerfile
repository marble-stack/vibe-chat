# Build stage
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# Set working directory
WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy shared package
COPY packages/shared ./packages/shared

# Copy server package
COPY apps/server ./apps/server

# Install dependencies (frozen lockfile for reproducible builds)
RUN pnpm install --frozen-lockfile

# Build the server
RUN pnpm --filter @vibe-chat/server build

# Production stage
FROM node:20-alpine AS runner

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# Set working directory
WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy shared package
COPY packages/shared ./packages/shared

# Copy server package.json
COPY apps/server/package.json ./apps/server/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files from builder
COPY --from=builder /app/apps/server/dist ./apps/server/dist

# Expose port
EXPOSE 3000

# Set working directory to server
WORKDIR /app/apps/server

# Start the server
CMD ["node", "dist/index.js"]
