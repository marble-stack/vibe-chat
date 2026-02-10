# Vibe Chat — Project Tracker

> Last updated: 2026-02-09

## Board

### In Progress

| ID | Task | Priority | Area | Assignee | Notes |
|----|------|----------|------|----------|-------|
| — | — | — | — | — | Nothing currently in progress |

### Up Next

| ID | Task | Priority | Area | Notes |
|----|------|----------|------|-------|
| T-12 | Key rotation on member leave | P1 - Critical | Encryption | Compromised member can still read new messages without this |
| T-13 | Proper password hashing (bcrypt/argon2) | P1 - Critical | Auth | Currently simplified — must fix before public launch |
| T-14 | Forward secrecy for channel keys | P2 - High | Encryption | Key compromise currently exposes all past messages |
| T-15 | Session management + refresh tokens | P2 - High | Auth | JWT-only flow has no revocation mechanism |

### Backlog

| ID | Task | Priority | Area | Notes |
|----|------|----------|------|-------|
| T-20 | OAuth / social login (Google, GitHub) | P3 - Medium | Auth | Nice-to-have for onboarding |
| T-21 | Key verification mechanism (MITM detection) | P3 - Medium | Encryption | Safety numbers or similar |
| T-22 | Error tracking integration (Sentry) | P3 - Medium | Infra | TODOs in `logger.ts` and `ErrorBoundary.tsx` |
| T-23 | Multi-device support | P3 - Medium | Encryption | Keys are device-local; new device = re-register |
| T-24 | File/image attachments | P3 - Medium | Feature | Encrypted file sharing in channels |
| T-25 | User profile editing (avatar, display name) | P4 - Low | Feature | |
| T-26 | Community settings / admin roles | P4 - Low | Feature | |
| T-27 | Message search | P4 - Low | Feature | Requires client-side index (messages are E2E encrypted) |
| T-28 | Push notifications (mobile web / PWA) | P4 - Low | Feature | |
| T-29 | Read receipts / unread counts | P4 - Low | Feature | |
| T-30 | Thread / reply-chain view | P4 - Low | Feature | Basic reply-to exists; threaded view does not |

---

## Priority Levels

| Level | Meaning |
|-------|---------|
| **P1 - Critical** | Security or data-integrity issue. Must resolve before any public launch. |
| **P2 - High** | Important for production readiness. Tackle in the next sprint. |
| **P3 - Medium** | Valuable improvement. Schedule when P1/P2 are clear. |
| **P4 - Low** | Nice-to-have / future roadmap. |

---

## Changelog

### 2026-02-09

- **fix(encryption): break E2E encryption deadlock** — When both users had cryptographically broken sender keys, neither could decrypt or create a new channel key (permanent "[Syncing keys...]"). Added deadlock recovery in `ensureChannelKey`, extracted `isDecryptionError()` helper, fixed `decryptionFailed` flag in Chat.tsx WebSocket handlers. Added 5 new tests. (`ef7ec91`)

### 2026-01 (January)

- **fix(ui): modal positioning** — Fixed create/join community modals on mobile and laptop screens
- **fix(server): rate-limit compat** — Fixed `@fastify/rate-limit` compatibility with Fastify 4.x
- **fix(server): production migrations** — Fixed migration issues for Railway deployment
- **fix(encryption): multi-user decryption** — Enforced single canonical channel key to prevent key fragmentation
- **feat(encryption): key redistribution** — Added key redistribution protocol for users joining after channel key creation
- **feat(security): test suite** — Added 114+ tests with TDD approach (now 161 tests)
- **feat(security): WebSocket auth** — JWT authentication required on WebSocket connections
- **feat(security): authorization checks** — All REST endpoints (emojis, reactions, channels) now verify ownership/membership
- **feat(security): Zod validation** — WebSocket message validation with Zod schemas for all message types
- **feat(server): presence tracking** — Online presence tracking via WebSocket

### Initial Release

- Monorepo setup (pnpm workspaces): Fastify server + React/Vite frontend
- E2E encryption: ECDH P-256 key exchange, AES-256-GCM message encryption
- Community/channel/message CRUD with real-time WebSocket delivery
- Emoji reactions, typing indicators, message editing/deletion
- Deployed on Railway (backend + frontend) with Neon PostgreSQL + Redis

---

## Completed Tasks

| ID | Task | Completed | Area |
|----|------|-----------|------|
| T-01 | Initial project setup (monorepo) | 2026-01 | Infra |
| T-02 | Database schema + Drizzle ORM | 2026-01 | Server |
| T-03 | REST API routes | 2026-01 | Server |
| T-04 | WebSocket real-time messaging | 2026-01 | Server |
| T-05 | React frontend + routing | 2026-01 | Web |
| T-06 | Zustand state management | 2026-01 | Web |
| T-07 | E2E encryption (ECDH + AES-GCM) | 2026-01 | Encryption |
| T-08 | Deploy to Railway + Neon | 2026-01 | Infra |
| T-09 | Security hardening (auth, validation, rate limiting) | 2026-01 | Security |
| T-10 | Test suite (161 tests, TDD) | 2026-01 | Testing |
| T-11 | Fix E2E encryption deadlock | 2026-02-09 | Encryption |

---

## Infrastructure

| Component | Service | Notes |
|-----------|---------|-------|
| Database | Neon PostgreSQL | Connection string in `apps/server/.env` |
| Cache | Railway Redis | Used for rate limiting, sessions |
| Backend | Railway | Auto-deploys from `main` |
| Frontend | Railway | Auto-deploys from `main` |
| CI | GitHub Actions | Runs tests on PR |
