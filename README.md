# Vibe Chat

An end-to-end encrypted messaging application with Discord-style communities and channels. Built with modern web technologies and the Signal Protocol (Sender Keys) for secure communication.

## Features

- **End-to-End Encryption**: Messages are encrypted using AES-GCM with ECDH P-256 key exchange
- **Communities & Channels**: Organize conversations in Discord-style servers with multiple channels
- **Real-time Messaging**: WebSocket-based instant message delivery
- **Typing Indicators**: See when others are typing in real-time
- **User Presence**: Online/offline status for community members
- **Message Editing & Deletion**: Edit or delete your messages
- **Message Replies**: Reply to specific messages in threads
- **Custom Emoji**: Add custom emoji to your communities

## Tech Stack

### Backend
- **Fastify** - Fast, low-overhead web framework
- **WebSocket (ws)** - Real-time bidirectional communication
- **PostgreSQL** - Primary database
- **Drizzle ORM** - Type-safe database queries
- **Zod** - Runtime schema validation

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **Zustand** - State management
- **TailwindCSS** - Utility-first styling
- **Dexie (IndexedDB)** - Local storage for encryption keys
- **Web Crypto API** - Browser-native cryptography

## Prerequisites

- Node.js 20.0.0 or higher
- pnpm 9.1.0 or higher
- Docker and Docker Compose (for local development)

## Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/vibe-chat.git
   cd vibe-chat
   ```

2. **Start the database services**
   ```bash
   docker compose up -d
   ```

3. **Install dependencies**
   ```bash
   pnpm install
   ```

4. **Set up environment variables**
   ```bash
   cp apps/server/.env.example apps/server/.env
   cp apps/web/.env.example apps/web/.env
   ```

5. **Run database migrations**
   ```bash
   pnpm db:migrate
   ```

6. **Start the development servers**
   ```bash
   pnpm dev
   ```

The application will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

## Project Structure

```
vibe-chat/
├── apps/
│   ├── server/           # Fastify backend
│   │   ├── src/
│   │   │   ├── db/       # Database schema & migrations
│   │   │   ├── routes/   # REST API endpoints
│   │   │   └── websocket/# Real-time messaging
│   │   └── drizzle/      # Generated SQL migrations
│   │
│   └── web/              # React frontend
│       └── src/
│           ├── components/  # UI components
│           ├── pages/       # Route pages
│           ├── stores/      # Zustand state management
│           └── lib/         # API client, WebSocket, crypto
│
└── packages/
    └── shared/           # Shared TypeScript types
```

## Testing

This project uses Vitest for testing with strict coverage requirements.

### Running Tests

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all tests once |
| `pnpm test:watch` | Run in watch mode |
| `pnpm test:coverage` | Generate coverage report |
| `pnpm --filter server test` | Server tests only |
| `pnpm --filter web test` | Frontend tests only |

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

## Available Scripts

### Root
| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all services in development mode |
| `pnpm dev:server` | Start backend only |
| `pnpm dev:web` | Start frontend only |
| `pnpm build` | Build all packages |
| `pnpm lint` | Run linting across all packages |
| `pnpm test` | Run all tests |
| `pnpm db:migrate` | Run database migrations |

### Server (`apps/server`)
| Command | Description |
|---------|-------------|
| `pnpm db:generate` | Generate new migrations from schema changes |
| `pnpm db:studio` | Open Drizzle Studio GUI |

## Encryption

Vibe Chat implements end-to-end encryption using a Signal Protocol-inspired approach:

1. **Key Generation**: Each user generates an ECDH P-256 key pair on registration
2. **Key Exchange**: When joining a channel, users exchange public keys
3. **Message Encryption**: Messages are encrypted with AES-GCM using shared channel keys
4. **Local Storage**: Private keys are stored locally in IndexedDB (never sent to server)

### Important Security Notes

- Private keys are device-local. Logging in on a new device requires re-registration
- The server only stores encrypted ciphertext - it cannot read message contents
- Key rotation on member departure is not yet implemented

## Deployment

### Railway (Backend)

The backend is configured for Railway deployment. Set these environment variables:
- `DATABASE_URL` - PostgreSQL connection string (auto-provided by Railway)
- `CORS_ORIGIN` - Your frontend URL
- `NODE_ENV` - Set to `production`

### Vercel (Frontend)

The frontend is configured for Vercel deployment. Set these environment variables:
- `VITE_API_URL` - Your backend API URL
- `VITE_WS_URL` - Your backend WebSocket URL

## Development

### Database Changes

After modifying the schema in `apps/server/src/db/schema.ts`:

```bash
pnpm db:generate  # Generate migration files
pnpm db:migrate   # Apply migrations
```

### WebSocket Protocol

Messages follow the format `{ type: string, payload: object }`:

| Type | Direction | Description |
|------|-----------|-------------|
| `message:send` | Client → Server | Send a new message |
| `message:new` | Server → Client | New message received |
| `message:edit` | Client → Server | Edit an existing message |
| `message:delete` | Client → Server | Delete a message |
| `typing:start` | Client → Server | User started typing |
| `typing:stop` | Client → Server | User stopped typing |
| `typing:update` | Server → Client | Typing status update |
| `channel:join` | Client → Server | Join a channel |
| `channel:leave` | Client → Server | Leave a channel |
| `presence:update` | Server → Client | User presence changed |

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## Security

For security concerns, please see our [Security Policy](SECURITY.md).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Signal Protocol for the encryption approach inspiration
- The Fastify, React, and Drizzle communities for excellent documentation
