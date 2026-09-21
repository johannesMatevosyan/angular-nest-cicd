FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Dummy values purely to satisfy prisma.config.ts's eager DIRECT_URL
# resolution — `generate` never actually connects to a database, so
# these never need to be real. Never put real credentials in an ARG —
# they'd be baked permanently into this image layer.
ARG DATABASE_URL=postgresql://user:pass@localhost:5432/db
ARG DIRECT_URL=postgresql://user:pass@localhost:5432/db
ENV DATABASE_URL=$DATABASE_URL
ENV DIRECT_URL=$DIRECT_URL
RUN npm run db:generate
RUN npx nx build backend

# ---- Stage 2: Run ----
FROM node:24-alpine AS runner
WORKDIR /app

# Only production dependencies — Nx, TypeScript, webpack, Jest, ESLint,
# and everything else devDependencies-only never enters this stage.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/apps/backend ./dist/apps/backend
COPY --from=builder /app/apps/backend/prisma ./prisma
COPY --from=builder /app/apps/backend/prisma.config.ts ./prisma.config.ts
COPY apps/backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Official Node images already ship a pre-created, unprivileged "node"
# user (uid 1000) — no need to create one manually. Running as root
# inside a container isn't automatically catastrophic, but it's an
# unnecessary risk: if an attacker ever found a way to execute code
# inside this container, root would hand them far more than they need.
USER node
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/apps/backend/main.js"]
