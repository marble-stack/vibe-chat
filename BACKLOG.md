# Vibe Chat - Task Backlog

## In Progress

- [ ] Deploy to Railway + Neon

## Next Steps (Railway Deployment)

1. Install Railway CLI: `npm install -g @railway/cli`
2. Login to Railway: `railway login`
3. Create project: `railway init`
4. Add Redis in Railway dashboard (New → Database → Redis)
5. Set environment variables in Railway:
   - `DATABASE_URL` = your Neon URL (already in .env)
   - `REDIS_URL` = provided by Railway Redis
   - `PORT` = 3000
   - `HOST` = 0.0.0.0
   - `CORS_ORIGIN` = your frontend URL
6. Create Railway config files for server and web apps
7. Deploy backend and frontend

## Current Setup

- **Database**: Neon PostgreSQL (configured in apps/server/.env)
- **Redis**: Needs Railway add-on or Upstash
- **Backend**: apps/server (Fastify + WebSocket)
- **Frontend**: apps/web (React + Vite)

## To Do (After Deployment)

- [ ] Test user registration and login flow
- [ ] Test community creation
- [ ] Test channel creation within communities
- [ ] Test real-time messaging via WebSockets
- [ ] Test emoji reactions

## Completed

- [x] Initial project setup with monorepo structure
- [x] Database schema design
- [x] Backend API routes
- [x] WebSocket implementation
- [x] Frontend components
- [x] Authentication pages
- [x] State management with Zustand
