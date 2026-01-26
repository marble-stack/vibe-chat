# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Vibe Chat is an end-to-end encrypted messaging app with Discord-style channels within communities. It uses the Signal Protocol (Sender Keys) for E2E encryption.

## Commands

```bash
# Start development (requires Docker for PostgreSQL)
docker-compose up -d          # Start PostgreSQL + Redis
pnpm install                  # Install dependencies
pnpm db:generate              # Generate Drizzle migrations
pnpm db:migrate               # Run migrations
pnpm dev                      # Start both server and web

# Individual services
pnpm dev:server               # Backend only (port 3000)
pnpm dev:web                  # Frontend only (port 5173)

# Database
pnpm db:studio                # Open Drizzle Studio GUI

# Code quality
pnpm lint                     # Run ESLint
pnpm format                   # Format code with Prettier
pnpm format:check             # Check formatting
```

## Architecture

```
vibe-chat/
├── apps/
│   ├── server/           # Fastify + WebSocket backend
│   │   ├── src/
│   │   │   ├── db/       # Drizzle ORM schema + migrations
│   │   │   ├── routes/   # REST API endpoints
│   │   │   └── websocket/# Real-time messaging
│   │   └── drizzle/      # Generated SQL migrations
│   │
│   └── web/              # React + Vite frontend
│       └── src/
│           ├── components/  # UI components
│           ├── pages/       # Route pages
│           ├── stores/      # Zustand state
│           └── lib/         # API client, WebSocket, crypto
│
└── packages/
    └── shared/           # Shared TypeScript types
```

## Key Patterns

### Database (Drizzle ORM)
- Schema defined in `apps/server/src/db/schema.ts`
- Run `pnpm db:generate` after schema changes to create migrations
- Use `db.query.*` for type-safe queries

### WebSocket Protocol
Messages use `{ type: string, payload: object }` format:
- `message:send` / `message:new` - Chat messages
- `typing:start` / `typing:stop` / `typing:update` - Typing indicators
- `channel:join` / `channel:leave` - Channel subscription

### Encryption
- Uses Web Crypto API (ECDH P-256 for key exchange, AES-GCM for messages)
- Private keys stored locally in IndexedDB via Dexie
- Each channel has a shared symmetric key distributed to members
- Key files: `apps/web/src/lib/crypto.ts`, `keyStore.ts`, `channelCrypto.ts`

**Known limitations:**
- Keys are device-local; logging in on a new device requires re-registration
- Key rotation on member leave not yet implemented
- No forward secrecy - key compromise could allow decryption of past messages
- No key verification mechanism for detecting MITM attacks

## Data Model

- **Community**: Top-level container (like Discord server)
- **Channel**: Chat room within a community (all members can access all channels)
- **Message**: Encrypted ciphertext stored server-side
- **SenderKey**: Per-user, per-channel encryption key distributed to members

## Environment

Copy `apps/server/.env.example` to `apps/server/.env` for local development.
Copy `apps/web/.env.example` to `apps/web/.env` if you need to override default API/WebSocket URLs.

## Security Considerations

**Authentication:** The current auth system is simplified for development. Production use requires:
- Proper password hashing (bcrypt/argon2)
- JWT tokens with proper expiration
- OAuth integration or other secure auth flows

**Authorization:** Channel/community access checks should be implemented before production.

**Rate Limiting:** API endpoints are rate-limited (100 requests/minute per IP).

**WebSocket Validation:** All WebSocket messages are validated with Zod schemas.

## Current Status

**Deployed and Live on Railway**

- **Database**: Neon PostgreSQL (connection string in `apps/server/.env`)
- **Backend**: Deployed on Railway with Redis
- **Frontend**: Deployed on Railway

### Working Features
- User registration and login
- Community creation and joining (via invite codes)
- Channel creation within communities
- Real-time messaging via WebSockets
- Emoji reactions

### Recent Fixes (Jan 2025)
- Fixed modal positioning for create/join community on mobile and laptop screens
- Fixed @fastify/rate-limit compatibility with Fastify 4.x
- Fixed production migrations for Railway deployment

### Workflow Note
Always push changes after making edits so Railway auto-deploys.

## Local Development (Alternative)

If you want to run locally instead of deploying:
```bash
docker compose up -d          # Start PostgreSQL + Redis
pnpm install                  # Install dependencies
pnpm db:generate              # Generate Drizzle migrations
pnpm db:migrate               # Run migrations
pnpm dev                      # Start both server and web
```
