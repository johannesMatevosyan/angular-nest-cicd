# Architecture

`angular-nest-cicd` is a deliberately simple full-stack task manager. The application itself (create/list/complete/delete tasks) is not the point — it's a vehicle for building and understanding a production-grade CI/CD pipeline. This document explains every technology choice, why it was made over the alternatives, how the pipeline actually flows end to end, and what it costs (nothing).

## Stack

| Layer | Technology | Version |
|---|---|---|
| Monorepo tooling | Nx | 23.1.1 |
| Frontend framework | Angular (standalone components, no NgModules) | 22.0.4 |
| Backend framework | NestJS | 11 |
| ORM | Prisma (with `@prisma/adapter-pg` driver adapter) | 7.10.0 |
| Database | PostgreSQL (hosted on Supabase) | 16 (local), Supabase-managed (prod) |
| CI | GitHub Actions | — |
| Containerization | Docker (multi-stage builds), Docker Compose | — |
| Container registry | GitHub Container Registry (GHCR) | — |
| Frontend hosting | Vercel | — |
| Backend hosting | Render (free tier) | — |
| Code quality | SonarQube Cloud (formerly SonarCloud) | — |
| Performance/a11y budget | Lighthouse CI | 0.15.1 |
| Runtime | Node.js | 24 |

## Why these choices

### Nx monorepo
**Why:** A single repo housing both the Angular frontend and NestJS backend, with `nx affected` computing exactly which projects a given change touches. This is the single biggest lever on CI speed and cost in this pipeline — `ci.yml`'s lint/test/build steps all run against `affected`, not `--all`, so a PR that only touches the backend never re-lints, re-tests, or re-builds the frontend.
**Alternative considered:** Two separate repos (frontend + backend). Rejected because it splits atomic changes (e.g. a shared DTO shape change) across two PRs and two CI runs, and loses the `affected` optimization entirely — every change would trigger every pipeline in full, regardless of what actually changed.

### Angular 22, standalone components
**Why:** No NgModules — every component declares its own dependencies via `imports`. Simpler mental model, smaller bundles (Angular's build tooling tree-shakes unused imports more effectively without the module indirection), and it's the direction Angular itself has moved as the default since v19+.
**Alternative considered:** NgModule-based architecture. Rejected — no benefit for a project this size, and NgModules are increasingly legacy in new Angular code.

### NestJS 11 + Prisma 7 (driver adapters) + PostgreSQL
**Why NestJS:** Structured, decorator-based, dependency-injected — the closest backend framework to Angular's own mental model, which matters when the whole point of the project is demonstrating full-stack competence coherently.
**Why Prisma 7:** Type-safe query building and migrations. Prisma 7 made driver adapters (`@prisma/adapter-pg`) **mandatory** rather than optional, and moved the database connection URL out of `schema.prisma` into `prisma.config.ts` — a breaking change from Prisma 6 that isn't backward compatible. This project is built against 7.10.0 directly rather than an older LTS-feeling version, deliberately, so the CI/CD lessons stay current rather than teaching a pattern that's already superseded.
**Why PostgreSQL over something like MongoDB:** The task-manager domain (tasks, relations, status transitions) is relational by nature, and Postgres is the most common production choice for this shape of app — more transferable interview material than a NoSQL choice made purely for novelty.
**Why Supabase specifically:** Free PostgreSQL, no time limit, no credit card, 500MB — genuinely free forever on the tier used here, not a trial. Supabase also fronts Postgres with connection pooling (pgBouncer), which is why there are two separate connection strings in play: `DATABASE_URL` (pooled, used at runtime by the app) and `DIRECT_URL` (unpooled, required for running migrations, which need a direct connection Prisma's migration engine can hold open).
**Alternative considered:** Running Postgres directly on Render or another host. Rejected — Supabase's free tier is more generous and purpose-built for exactly this "small side project, permanently free" use case; a self-hosted Postgres instance on a free compute tier would also compete for the same limited resources as the API process itself.

### Vercel (frontend) + Render (backend) — not a single host
**Why split hosts:** Vercel is a best-in-class fit for static/SSR frontend builds — effectively zero-config for Angular, generous free tier, automatic preview deployments per PR. Render is a straightforward free tier for a long-running Node process (NestJS needs a persistent server, not a static host).
**Trade-off accepted knowingly:** Render's free tier spins the backend down after 15 minutes of inactivity, so the first request after idle time is slow (a "cold start"). This is a real, visible characteristic of the deployed app, not a bug — it's the honest cost of "$0 hosting," and it's worth being able to speak to directly rather than hiding it.
**Correction to an earlier project note:** an earlier version of this project's description mentioned "Railway" — that's stale. Every workflow, log, and the live URL itself (`angular-nest-cicd-api.onrender.com`) confirm the backend has run on **Render** throughout.

### Docker — containerization exists, but isn't what's live in production
This is the single most important nuance in this architecture, and the one most likely to trip you up if you don't say it explicitly in an interview:

- `apps/frontend/Dockerfile` and `apps/backend/Dockerfile` are real, working multi-stage builds.
- `docker-compose.yml` runs the full stack locally — a local Postgres 16 container, the backend, and the frontend — for local development, deliberately using a **local** Postgres instance rather than Supabase (so local dev doesn't depend on network access to the hosted database, and so nobody's local experiments touch the real Supabase data).
- `.github/workflows/docker-publish.yml` builds both images on every push to `main` and pushes them to GHCR (`ghcr.io/johannesmatevosyan/angular-nest-cicd-{frontend,backend}`), tagged with both `latest` and the short git SHA.
- **But nothing in production actually runs these images.** Vercel and Render each deploy by pulling directly from the connected GitHub repo through their own native git integration — Vercel builds the Angular app itself; Render builds and runs the NestJS app itself. This is confirmed two ways, not assumed: the GHCR package's own download count shows **0 total downloads** on every published tag, and Render's own service settings show a plain git-native buildpack deploy (`Build Command: npm install --include=dev && npm run db:generate && npx nx build backend`, `Start Command: node dist/apps/backend/main.js`) with no Dockerfile or image reference anywhere in its configuration. The Docker pipeline is real and working, but it's currently a parallel, self-contained demonstration of containerization (Stage 3 of the learning plan) and the engine behind local `docker-compose up` — not the thing serving live traffic.
- **A staging environment is partially provisioned, not fully built.** A second Render service (`angular-nest-cicd-api-staging`) exists, configured to auto-deploy from a `staging` branch — but that branch only ever existed locally and was never pushed to GitHub, so the service currently has nothing to deploy. No Ruleset/required-checks coverage targets `staging` either (only `main` is protected). This is accurately described as started-but-inactive, not as either a finished parallel environment or something never attempted.

This is a completely normal and common real-world pattern (PaaS git-deploy for production, a separate container pipeline for portfolio/local-dev purposes) — it just needs to be described honestly rather than implied to be one unified deployment path.

**Multi-stage build reasoning (both Dockerfiles):** stage 1 installs full dependencies (including dev-only tooling — Nx, the Angular CLI, TypeScript, webpack) and builds; stage 2 starts from a clean, minimal base image (`nginx:alpine` for the frontend, a fresh `node:24-alpine` for the backend) and copies across *only* the compiled output. Nx, npm's dev dependencies, and the entire build toolchain never exist in the final image at all — smaller image, smaller attack surface.

**Backend runtime security:** the final stage runs as `USER node` — the official Node image's pre-created, unprivileged user — rather than root. Running as root inside a container isn't automatically catastrophic, but it's an unnecessary risk with no upside: if an attacker ever found a way to execute code inside the container, root would hand them far more than they need.

**Migrations on container startup:** `docker-entrypoint.sh` runs `npx prisma migrate deploy` before starting the app, then does `exec "$@"` rather than just running the command normally. The `exec` matters: it replaces the shell process with the Node process as PID 1, so `SIGTERM` (from Docker, Render, or an orchestrator during a graceful shutdown/redeploy) reaches Node directly instead of getting stuck on an intermediate shell process that doesn't know to forward it.

**Registry choice — GHCR over Docker Hub:** free for public repos, and authentication uses the workflow's own built-in `GITHUB_TOKEN` (scoped via `permissions: packages: write`) rather than a separate long-lived registry credential that would need to be created, stored as a secret, and rotated manually.

### SonarQube Cloud + Lighthouse CI — quality gates as required checks
**Why both, and why they measure different things:** SonarQube analyzes the *code* (bugs, code smells, security hotspots, duplication, and test coverage via parsed `lcov.info` reports) — it can't tell you anything about the running application. Lighthouse CI runs against the actual built frontend (performance, accessibility, best practices, SEO) — it can't tell you anything about code quality. Neither substitutes for the other.
**Thresholds:** Lighthouse enforces performance/accessibility/best-practices ≥ 90 and SEO ≥ 80 as hard CI failures (`categories:*` assertions in `lighthouserc.js`), against a locally built static bundle rather than a live URL — chosen deliberately so scores reflect the app itself, not Render's free-tier cold-start latency bleeding into the numbers. SonarQube's Quality Gate enforces its default conditions, including coverage on **new code** in a PR (not overall repository coverage — an important distinction covered below).
**Both are required GitHub branch-protection checks** (alongside `build`, which covers lint/test/build) — a PR cannot merge into `main` unless all three pass.

### ESLint — warnings stay non-blocking locally, zero-tolerance in CI
Three rules are configured at `warn` severity in the shared flat config: `@typescript-eslint/no-explicit-any`, `no-unused-vars`, and `no-non-null-assertion`. Rather than promoting them to `error` (which would make every contributor's editor light up red for the same things), CI runs the lint step with `--max-warnings=0`. This keeps the local dev loop quiet (a squiggly underline, not a build-blocking red error) while making CI the actual, zero-tolerance enforcement boundary — the more common real-world split between "fast local feedback" and "hard merge gate."

### GitHub Rulesets (not classic branch protection)
Newer GitHub feature than "classic" branch protection rules; functionally similar (required status checks, block force pushes, restrict deletions) but the modern, more flexible mechanism GitHub is standardizing on. `main` is protected by a ruleset requiring `build`, `SonarQube Scan`, and `Lighthouse CI` to pass, plus requiring PR branches to be up to date with `main` before merging (so a check that passed against a stale base commit can't slip through against the current one).

## Pipeline flow, end to end

**On every pull request targeting `main`:**
1. `ci.yml` → single `build` job: install deps → generate Prisma client → lint affected projects (`--max-warnings=0`) → test affected projects with coverage → build affected projects. Any failure blocks merge (required check).
2. `sonarqube.yml` → install deps → generate Prisma client → run **all** projects' tests with coverage (`--codeCoverage`, not the more restrictive `affected` — SonarQube needs the full picture, not just what changed) → SonarQube Scan → Quality Gate check. Required check.
3. `lighthouse.yml` → install deps → production build of the frontend → `lhci autorun` against the local static build. Required check.
4. A PR-comment job posts/updates a single status comment on the PR summarizing the `build` job's result.

**On merge to `main` (push event):**
1. `sonarqube.yml` re-runs (branch analysis, not PR analysis) — this is what actually updates the main-branch dashboard numbers (coverage %, Quality Gate status) that the README badges read from.
2. `docker-publish.yml` builds and pushes both Docker images to GHCR, tagged `latest` + short SHA.
3. **Independently of both of the above**, Vercel and Render each detect the push via their own GitHub integration and redeploy from source — no workflow in this repo triggers or coordinates this; it happens entirely on their side.

## Cost breakdown: $0

| Service | Tier | Why it's free |
|---|---|---|
| GitHub Actions | Free (public repo) | Unlimited minutes for public repositories |
| GHCR | Free (public repo) | No storage cost for public images |
| Vercel | Free ("Hobby") | Generous free tier for personal/non-commercial projects |
| Render | Free | No card required; trade-off is the cold-start behavior described above |
| Supabase | Free forever | 500MB Postgres, no time limit, no card required |
| SonarQube Cloud | Free (public/OSS repo) | Free tier explicitly for open-source projects |

No paid tier, trial, or credit card was used anywhere in this pipeline.

## Known non-issues (things that look like bugs but aren't)

- **`https://angular-nest-cicd-api.onrender.com/` returns a 404** (`Cannot GET /`). Expected — the NestJS app uses a global route prefix (`/api`), so nothing is mapped to the bare root path. The correct health-check/smoke-test URL is `.../api`, which returns `{ "message": "Hello API" }`.
- **The GHCR package pages show 0 downloads.** Expected, not broken — see the Docker section above. The images are published successfully; nothing currently pulls them in production.
- **`@nx/eslint:lint`'s schema is deprecated** (Nx will remove it in v24). This repo actually runs lint through the newer inferred-plugin mechanism (`@nx/eslint/plugin`, configured with a custom `targetName: "eslint:lint"` in `nx.json`) — the deprecated executor's schema was consulted only to confirm the `maxWarnings` option name during CI hardening; it's not what's actually executing.
