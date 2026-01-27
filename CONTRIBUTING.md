# Contributing to Vibe Chat

Thank you for your interest in contributing to Vibe Chat! This document provides guidelines and information for contributors.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone. Please:

- Use welcoming and inclusive language
- Be respectful of differing viewpoints and experiences
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

## How to Contribute

### Reporting Bugs

Before submitting a bug report:

1. Check existing issues to avoid duplicates
2. Use the latest version of the project
3. Collect information about the bug (steps to reproduce, expected vs actual behavior)

When submitting a bug report, include:

- A clear, descriptive title
- Detailed steps to reproduce the issue
- Expected behavior vs actual behavior
- Screenshots if applicable
- Your environment (OS, browser, Node.js version)

### Suggesting Features

Feature requests are welcome! Please:

1. Check existing issues for similar suggestions
2. Provide a clear description of the feature
3. Explain the use case and benefits
4. Consider implementation complexity

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Follow the setup instructions** in README.md
3. **Make your changes** following the code style guidelines
4. **Test your changes** thoroughly
5. **Update documentation** if needed
6. **Submit a pull request** with a clear description

## Development Setup

```bash
# Clone your fork
git clone https://github.com/your-username/vibe-chat.git
cd vibe-chat

# Install dependencies
pnpm install

# Start services
docker compose up -d
pnpm db:migrate
pnpm dev
```

## Code Style Guidelines

### TypeScript

- Use TypeScript strict mode
- Prefer explicit types over `any`
- Use Zod for runtime validation
- Follow existing code patterns

### React

- Use functional components with hooks
- Keep components focused and small
- Use Zustand for global state
- Follow existing component patterns

### Backend

- Use Fastify's built-in validation
- Handle errors appropriately
- Use Drizzle ORM for database queries
- Keep routes focused on single responsibilities

### General

- Write self-documenting code
- Add comments only when necessary
- Use meaningful variable and function names
- Keep functions small and focused

## Commit Messages

Follow conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:

```
feat(auth): add password reset functionality
fix(websocket): handle disconnection gracefully
docs(readme): update installation instructions
```

## Project Structure

```
vibe-chat/
├── apps/
│   ├── server/         # Backend (Fastify)
│   └── web/            # Frontend (React)
└── packages/
    └── shared/         # Shared types
```

### Key Directories

- `apps/server/src/routes/` - API endpoints
- `apps/server/src/websocket/` - WebSocket handlers
- `apps/server/src/db/` - Database schema and queries
- `apps/web/src/components/` - React components
- `apps/web/src/lib/` - Utilities and API client
- `apps/web/src/stores/` - Zustand stores

## Testing

This project uses **Test-Driven Development (TDD)**. All contributions must include tests.

### Running Tests

```bash
# Run all tests
pnpm test

# Watch mode for development
pnpm test:watch

# With coverage report
pnpm test:coverage

# Server tests only
pnpm --filter server test

# Web tests only
pnpm --filter web test
```

### TDD Workflow

1. **Write a failing test** that describes the desired behavior
2. **Write minimal code** to make the test pass
3. **Refactor** while keeping tests green

### Test Structure

```
apps/server/src/__tests__/
├── db/            # Database operation tests
├── lib/           # Unit tests for utilities (auth, etc.)
├── routes/        # API endpoint integration tests
└── websocket/     # WebSocket handler tests

apps/web/src/__tests__/
├── lib/           # Crypto and utility tests
└── components/    # Component tests (planned)
```

### Coverage Requirements

- Security-critical code (crypto, auth): **80% minimum**
- Overall coverage: **70% minimum**
- All new code must include tests

### Security Code Requirements

For security-sensitive code (auth, crypto, WebSocket):

- 100% test coverage for new code paths
- Input validation with Zod schemas
- Authorization checks for all user data access

## Security

For security-related issues, please see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Questions?

Feel free to open an issue for questions or discussions about the project.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
