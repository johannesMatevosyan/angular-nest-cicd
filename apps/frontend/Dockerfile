# ---- Stage 1: Build ----
FROM node:24-alpine AS builder

WORKDIR /app

# Copy only the lockfile first — this layer only gets invalidated
# (re-run) when dependencies actually change, not on every source edit.
# Source code changes far more often than package.json does, so this
# ordering is what makes rebuilds fast after the first one.
COPY package.json package-lock.json ./
RUN npm ci

# Now bring in the rest of the monorepo.
COPY . .

ARG API_URL=http://localhost:3000/api
ENV API_URL=$API_URL
RUN node apps/frontend/scripts/set-env.js

RUN npx nx build frontend

# ---- Stage 2: Serve ----
FROM nginx:alpine AS runner

# This COPY --from=builder line is the entire point of a multi-stage
# build: it reaches back into the discarded first stage and takes ONLY
# the compiled static files. Node, npm, Nx, the Angular CLI, and every
# devDependency used purely for building never make it into this final
# image at all — they simply don't exist here.
COPY --from=builder /app/dist/apps/frontend/browser /usr/share/nginx/html

COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
