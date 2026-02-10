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

## Testing

```bash
# Run all tests
pnpm test

# Watch mode for development
pnpm test:watch

# With coverage report
pnpm test:coverage

# Run only server tests
pnpm --filter server test

# Run only web tests
pnpm --filter web test

# CI mode (used in GitHub Actions)
pnpm test:ci
```

### Test Structure

```
apps/server/src/__tests__/
├── db/            # Database operation tests
├── lib/           # Unit tests for utilities (auth, etc.)
├── routes/        # API endpoint integration tests
└── websocket/     # WebSocket handler tests

apps/web/src/__tests__/
├── lib/           # Crypto and utility tests
└── placeholder.test.ts
```

### Coverage Requirements

- Security-critical code (crypto, auth): 80% minimum
- Overall coverage: 70% minimum
- All new code must include tests

### TDD Workflow

1. Write failing test first
2. Implement minimal code to pass
3. Refactor while keeping tests green
4. All PRs require tests for new functionality

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
- `message:edit` / `message:edited` - Edit messages
- `message:delete` / `message:deleted` - Delete messages
- `typing:start` / `typing:stop` / `typing:update` - Typing indicators
- `channel:join` / `channel:leave` - Channel subscription
- `community:join` / `community:leave` - Community subscription (for presence)
- `presence:list` / `presence:update` - Online status
- `reaction:add` / `reaction:added` - Add emoji reactions
- `reaction:remove` / `reaction:removed` - Remove emoji reactions
- `key:request` / `key:requested` - Channel key redistribution requests
- `key:available` - Notifies user that a channel key has been distributed to them

### Encryption

- Uses Web Crypto API (ECDH P-256 for key exchange, AES-GCM for messages)
- Private keys stored locally in IndexedDB via Dexie
- Each channel has ONE canonical shared symmetric key (first user to message creates it)
- Key redistribution: When a new user joins, they request the key via WebSocket and the key owner redistributes it
- Key files: `apps/web/src/lib/crypto.ts`, `keyStore.ts`, `channelCrypto.ts`

**Key sync flow:**

1. User A sends first message → creates channel key, distributes to current members
2. User B joins later → sees "[Syncing keys...]" → requests key via WebSocket
3. User A receives `key:requested` → redistributes key to all members including B via REST API
4. Server sends `key:available` to User B via WebSocket after storing the key
5. User B receives `key:available` → re-decrypts all pending messages
6. Fallback: If key owner is offline, client polls for keys every 5 seconds

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

### Implemented Security Features

**Authentication:**

- JWT-based authentication with required secret (no fallback defaults)
- Token verification on all protected endpoints
- WebSocket connections require valid JWT token

**Authorization:**

- Channel access checks on message send/receive
- Community membership verification
- Sender key distribution requires authentication and channel membership
- REST endpoints verify user ownership where applicable

**Input Validation:**

- All WebSocket messages validated with Zod schemas
- REST API payloads validated with Zod
- UUID format validation on all ID parameters

**Rate Limiting:** API endpoints are rate-limited (100 requests/minute per IP).

### Security Improvements Needed for Production

**Authentication:**

- Proper password hashing (bcrypt/argon2) - currently simplified
- OAuth integration for social login
- Session management and refresh tokens

**Encryption:**

- Key rotation on member leave not yet implemented
- No forward secrecy - key compromise could expose past messages
- No key verification mechanism for MITM detection

## Deployment Environments

**Railway Project: gleaming-respect**

### Production (`main` branch)

- **Backend (vibe-chat)**: Deploys from `main`
- **Frontend (pleasant-motivation)**: Deploys from `main`
- **Database**: Neon PostgreSQL (external, connection string in `apps/server/.env`)
- **Redis**: Railway-managed

### Staging (`staging` branch)

- **Backend (vibe-chat)**: `vibe-chat-staging.up.railway.app` — deploys from `staging`
- **Frontend (pleasant-motivation)**: `pleasant-motivation-staging.up.railway.app` — deploys from `staging`
- **Database**: Railway-managed PostgreSQL (isolated from production)
- **Redis**: Railway-managed (isolated from production)
- Staging has its own database — no shared data with production. New accounts must be created separately.

### Branch Workflow

- Push to `staging` → deploys to QA/staging only
- Push to `main` → deploys to production only
- Feature branches → merge into `staging` for QA, then into `main` for release

## Current Status

### Working Features

- User registration and login
- Community creation and joining (via invite codes)
- Channel creation within communities
- Real-time messaging via WebSockets
- Message editing and deletion
- Emoji reactions
- Typing indicators
- Online presence tracking
- End-to-end encryption with automatic key sync for new members

### Recent Fixes (Jan 2026)

- Fixed modal positioning for create/join community on mobile and laptop screens
- Fixed @fastify/rate-limit compatibility with Fastify 4.x
- Fixed production migrations for Railway deployment
- Fixed multi-user message decryption (single canonical channel key)
- Added key redistribution protocol for users joining after channel key creation

### Security Improvements (Jan 2026)

- Added comprehensive test suite (114 tests) with TDD approach
- JWT authentication required on WebSocket connections
- Authorization checks on all REST endpoints (emojis, reactions, channels)
- Sender key distribution security with auth + membership verification
- Prekey fetch atomicity with database transactions
- WebSocket message validation with Zod schemas for all message types
- Database operation safety helpers
- Memory leak prevention in WebSocket connection management
- Single canonical channel key enforcement to prevent key fragmentation

### Workflow Note

- Push to `staging` branch for QA testing, push to `main` for production deploys.
- Staging and production have fully isolated databases — no shared state.

## Local Development (Alternative)

If you want to run locally instead of deploying:

```bash
docker compose up -d          # Start PostgreSQL + Redis
pnpm install                  # Install dependencies
pnpm db:generate              # Generate Drizzle migrations
pnpm db:migrate               # Run migrations
pnpm dev                      # Start both server and web
```
