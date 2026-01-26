FROM node:20-alpine

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared ./packages/shared
COPY apps/server ./apps/server

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build shared package and server
WORKDIR /app/apps/server
RUN pnpm build

# Run migrations and start
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
