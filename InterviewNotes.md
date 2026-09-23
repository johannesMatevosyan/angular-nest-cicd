# Interview Notes

Every interview question the original learning plan targeted, answered the way you'd actually say it out loud — grounded in what this specific project does, not textbook definitions. Where something in the original plan wasn't actually built, that's called out honestly rather than glossed over — better to know the gap now than get caught overclaiming in the room.

---

## Stage 1 — CI Fundamentals

### What is CI and why does it matter?
Continuous Integration: every code change is automatically built, linted, and tested the moment it's proposed (here, on every PR to `main`), rather than discovered broken days later when someone else pulls it. It matters because the cost of finding a bug scales with how long it's been hidden — a failing test caught in a 90-second CI run costs nothing; the same bug found in production costs an incident.

### What is a GitHub Actions workflow and how is it structured?
A YAML file in `.github/workflows/` that defines: **triggers** (`on:` — this repo uses `pull_request` and `push` to `main`), **jobs** (independent units that can run in parallel, each on its own fresh runner), and within each job, **steps** (sequential commands/actions sharing that runner's filesystem). `ci.yml` has two jobs — `build` (lint/test/build) and `pr-comment` (posts a status comment, gated with `needs: build` so it always runs after and can read the result even on failure via `if: always()`).

### What are jobs and steps in GitHub Actions?
A job is an isolated execution environment (its own VM); steps are the ordered instructions inside it, sharing that one environment. Two jobs in the same workflow don't share filesystem state unless you explicitly pass artifacts between them — which is exactly why `pr-comment` in `ci.yml` only reads `needs.build.result` (a status string) rather than any file the `build` job produced.

### How does caching work in CI pipelines?
Two layers in this project: (1) `actions/setup-node`'s `cache: 'npm'` caches `~/.npm` between runs keyed on `package-lock.json`'s hash, so `npm ci` skips re-downloading unchanged dependencies; (2) Nx's own task cache (keyed on file-content hashes of a task's declared inputs) skips re-running lint/test/build entirely when nothing relevant changed — this is what produces the `[existing outputs match the cache, left as is]` messages you'd see running Nx locally. Docker builds add a third layer: `docker-publish.yml` uses `cache-from/cache-to: type=gha`, caching Docker layers in GitHub Actions' own cache backend.

### What are branch protection rules and why use them?
Rules that block merging into a protected branch (`main`) until conditions are met — required status checks passing, branch up to date, etc. This project uses GitHub's newer **Rulesets** (not "classic" branch protection) with three required checks: `build`, `SonarQube Scan`, `Lighthouse CI`, plus "require branches to be up to date before merging." Without this, a human could merge a PR with failing tests just by clicking the button — the rule makes the gate structural, not a matter of someone remembering to check.

### What is the difference between CI and CD?
CI verifies a change is good (build/test/lint); CD is what happens *after* that verification — getting the verified change into a running environment. In this project: CI is `ci.yml` + `sonarqube.yml` + `lighthouse.yml`, all triggered on the PR. CD is Vercel and Render's own git-integration auto-deploy, triggered independently on push to `main` — notably, **not orchestrated by any workflow in this repo at all**; it's entirely on the platforms' side.

### How do Nx affected commands save CI time?
`nx affected -t lint/test/build` (used in `ci.yml`, powered by `nrwl/nx-set-shas` computing the correct base/head commit range) only runs a target against projects whose dependency graph was actually touched by the diff. A backend-only change never re-lints or re-tests the frontend. This is the single biggest lever on CI cost/speed in a two-app monorepo — the alternative (`--all`, used deliberately in `sonarqube.yml` because SonarQube needs the whole coverage picture, not a partial one) runs everything, every time.

---

## Stage 2 — CD, Secrets, Environments

### How do you manage secrets in a CI/CD pipeline?
Never in code or committed config — always injected at runtime from a secret store the CI platform controls. This project uses **GitHub Actions Secrets** (`DATABASE_URL`, `DIRECT_URL`, `SONAR_TOKEN`) referenced via `${{ secrets.NAME }}`, which GitHub automatically redacts from logs even if a step somehow echoed one. Docker adds a related but distinct rule: the backend `Dockerfile`'s `ARG DATABASE_URL=postgresql://user:pass@localhost:5432/db` is a **dummy** value used only to satisfy `prisma.config.ts`'s eager resolution during `prisma generate` (which never opens a real connection) — a real credential must never go into a Docker `ARG`, because `ARG`/`ENV` values are baked permanently into that image layer and readable by anyone who can pull or inspect the image.

### What is a staging environment and why is it important? *(gap — be upfront about this)*
Conceptually: a staging environment is a production-like environment that receives deploys *before* production, letting you catch integration issues (real network calls, real-ish data) that unit tests can't. **This project has a Render service provisioned for staging** (`angular-nest-cicd-api-staging`, configured to auto-deploy on commit from a `staging` branch) — **but the `staging` branch only ever existed locally and was never pushed to GitHub**, so the service has nothing live to deploy from right now. It's a real, honest example of infrastructure that's half-built rather than either "fully working" or "never attempted" — worth being precise about which of those three it actually is if it comes up. To finish it properly would need: the branch pushed to GitHub, a Ruleset/required-checks equivalent targeting `staging` (currently only `main` is protected — merges into `staging` today would go through with zero CI verification), a matching Vercel deployment tracking that branch, and a genuinely separate Supabase project (not just a different connection string against the same database) so staging data can't collide with production data.

### What is a preview deployment?
An ephemeral, fully working deployment built from a specific PR/branch rather than `main` — lets reviewers click a real, live link instead of just reading a diff. Vercel provisions these automatically for any PR against a connected repo with no extra pipeline config needed. **Verify this is actually firing** by opening a real PR and checking for a Vercel bot comment with a preview URL — it should happen automatically, but hasn't been explicitly confirmed within this project's own CI logs.

### How do you implement zero-downtime deployments?
The general pattern: the new version starts and passes its own health check *before* traffic is switched to it, so there's never a moment where a request could hit a half-started or already-stopped process. Vercel does this natively for the frontend (deployments are atomic and immutable — a new one is fully live before the domain points at it, and the previous one can be instantly promoted back). Render's behavior on its free tier for zero-downtime swaps is something to verify directly against current Render documentation rather than assume — free-tier single-instance services may not guarantee it the same way a paid multi-instance setup would.

### What happens if a deployment fails — how do you rollback?
This project relies entirely on the hosting platforms' built-in mechanisms — there's no custom rollback pipeline. Vercel: every deployment is kept and immutable; rolling back is "promote a previous deployment" from its dashboard, effectively instant. Render: redeploying a previous commit from its dashboard. Be honest in an interview that this is platform-provided, not something built — and be ready to describe what a from-scratch rollback strategy (blue/green, canary, feature flags) would look like conceptually if pushed further.

### How do you handle database migrations in CD?
Two different mechanisms exist side by side in this project, worth being able to distinguish clearly: **(1) local Docker**, where `docker-entrypoint.sh` runs `npx prisma migrate deploy` automatically every time the backend container starts, before the app boots (`exec "$@"` afterward hands off to the actual `node` process as PID 1). **(2) actual production**, where migrations against Supabase are applied manually/explicitly (`npm run db:deploy` → `prisma migrate deploy` against `DIRECT_URL`) — Render's deploy from git does not itself run migrations. This split matters: an interviewer might ask "so does every prod deploy auto-migrate?" and the honest answer here is no, not automatically in the current setup — that's a real, nameable gap worth mentioning if it comes up, and a natural "what I'd add next" answer (a migration step in the deploy path, or a Render pre-deploy hook).

### What is a cold start and how do you handle it in UX?
Render's free tier spins the backend down after ~15 minutes of no traffic; the next request has to wait for the process to boot back up (multi-second delay) before responding. This project's frontend currently surfaces this as a plain loading state while the initial `/api` call resolves — there's no dedicated retry/backoff logic or "waking up the server..." messaging built specifically for it. Worth naming as a known, accepted trade-off of $0 hosting rather than something hidden.

### What is connection pooling and why does it matter?
A pool of already-open database connections reused across requests, rather than opening/closing a fresh TCP + auth handshake per query — expensive and, under load, a good way to exhaust Postgres's fairly low default max-connections limit. Supabase fronts its Postgres with pgBouncer for exactly this reason. This is precisely why two separate connection strings exist in this project: `DATABASE_URL` (pooled, what the running app uses for normal queries) and `DIRECT_URL` (unpooled/direct, required specifically for Prisma's migration engine, which needs to hold a single long-lived connection that a transaction-pooling proxy would interfere with).

---

## Stage 3 — Docker

### What is Docker and why use it?
Packages an application with its exact runtime environment (OS libraries, language runtime, dependencies) into a single portable image, so "works on my machine" becomes "works anywhere this image runs" — the same image runs identically in local dev, CI, and (if it were used there) production. In this project, the honest scope is: Docker guarantees identical local dev environments via `docker-compose.yml`, and produces real, correctly-built images pushed to GHCR — but see the "known non-issue" in `Architecture.md`: those images aren't what's actually serving production traffic. Be ready to describe what containerized production would look like as a next step.

### What is a multi-stage Docker build?
A single `Dockerfile` with multiple `FROM` stages, where a later stage can selectively copy artifacts out of an earlier one via `COPY --from=<stage>`, discarding everything else. Both Dockerfiles here use this: stage 1 has the full toolchain (Nx, Angular CLI/webpack for frontend; the TypeScript compiler for backend) and produces build output; stage 2 starts from a clean minimal base (`nginx:alpine`, `node:24-alpine`) and copies across *only* that compiled output. The entire dev toolchain — everything needed to build but not to run — never exists in the shipped image.

### What is docker-compose and when do you use it?
Declarative multi-container orchestration for local development — one `docker-compose.yml` defining `db` (Postgres 16), `backend`, and `frontend` as services with their networking, environment variables, and startup order (`depends_on: db: condition: service_healthy`, gated on an actual `pg_isready` healthcheck rather than just "container started") all in one file, brought up with a single `docker-compose up`. Deliberately uses a local Postgres container rather than pointing at the real Supabase instance — so local experimentation never touches production data and doesn't need network access to work at all.

### What is a container registry?
A place to store and version container images by tag, so a specific build can be pulled by name+tag later rather than rebuilt from source. This project uses GHCR (free for public repos) over Docker Hub specifically because auth uses the workflow's built-in `GITHUB_TOKEN` (via `permissions: packages: write`) — no separate long-lived credential to create, store as a secret, or rotate.

### How do you run database migrations in a containerized environment?
`docker-entrypoint.sh`: `npx prisma migrate deploy` runs as the container's first action, before the app process starts, then `exec "$@"` hands off. The `exec` detail is the part worth being able to explain unprompted: without it, the app would run as a child of the entrypoint shell script, and that shell — not Node — would be PID 1 and the one actually receiving `SIGTERM` on shutdown, potentially failing to forward it correctly for a graceful exit.

### What is the difference between a container and an image?
An image is the static, immutable build artifact (layers, filesystem snapshot, metadata) — what gets pushed to GHCR and tagged. A container is a running instance of that image — a live process with its own writable layer on top, network namespace, etc. One image (`angular-nest-cicd-backend:6dd51be`) can be the source of any number of running containers.

### Why should containers run as non-root?
Defense in depth: running as root inside a container isn't automatically catastrophic on its own (container isolation still applies), but it removes a layer of protection for free. If an attacker ever found a way to execute arbitrary code inside the container, root privileges hand them capabilities they don't otherwise need — this project's backend runner stage explicitly sets `USER node`, the official Node image's pre-created unprivileged user, rather than creating a custom one (no need to reinvent it).

### What is .dockerignore and why does it matter?
Excludes files from the build context sent to the Docker daemon — without one, `COPY . .` can pull in `node_modules`, `.git`, and other large or irrelevant directories, bloating build time and image size, and in the worst case leaking files (like a local `.env`) into an image layer that shouldn't be there. This repo's `.dockerignore` excludes `node_modules`, `dist`, `.git`, `.angular`, `.nx`, and both `**/.env` and `**/.env.local` — the last two are the ones that actually matter for security: without them, a local `.env` sitting anywhere in the repo could get copied straight into an image layer by `COPY . .` in either Dockerfile's builder stage, permanently baked in and readable by anyone who pulls the image.

---

## Stage 4 — Quality Gates

### What is a quality gate?
An automated, binary pass/fail threshold a change must clear before it can merge — turns "code quality" from a subjective code-review opinion into a structural, non-negotiable check. This project has three: SonarQube's Quality Gate (bugs/vulnerabilities/coverage/duplication thresholds), Lighthouse's category-score assertions, and ESLint's `--max-warnings=0` — all wired as required GitHub Rulesets checks, so none of them can be skipped by habit or hurry.

### What is SonarQube Cloud and what does it measure?
Static analysis platform measuring bugs, vulnerabilities, code smells, test coverage, code duplication, and security hotspots. Two important, easy-to-get-wrong details worth being precise about if asked: (1) it needs real `lcov.info` coverage reports to measure coverage at all — getting that pipeline correctly wired took three separate fixes in this project (the Jest executor's actual flag name, `codeCoverage`, not the more intuitive-looking `--coverage`; Nx's own jest preset silently defaulting `coverageReporters` to `['html']` only, overriding Jest's real multi-format default; and a stale local Nx cache masking whether a fix had actually taken effect) — good, concrete "tell me about a tricky bug you debugged" material. (2) Coverage shown on a **PR's "New Code" view** and coverage shown on the **main branch's "Overall Code" view** are genuinely different numbers measuring different things — a PR that only touches CI config files will correctly show "not enough lines to compute coverage" on New Code while the main branch's Overall Code number (55.3% at last check) is the real, whole-project figure.

### What is Lighthouse CI and why run it in CI?
Automates Google's Lighthouse audits (performance, accessibility, best practices, SEO) as a CI gate rather than a manual, occasional spot-check — regressions get caught on the PR that introduced them, not discovered later by a user or a lucky manual audit. This project intentionally runs it against a **locally built static bundle** (`staticDistDir`, not a live URL) with the live backend URL blocked via `blockedUrlPatterns` — so scores measure the frontend's own performance, not Render's free-tier cold-start latency leaking into the numbers as noise.

### What is a bundle size budget? *(gap — not yet implemented)*
Conceptually: a hard ceiling on compiled bundle size, enforced in CI so a dependency added carelessly (or a lazy-loading boundary accidentally removed) gets caught before merge rather than discovered as "the app feels slower" months later. **This was in the original Stage 4 plan (a `bundlesize`/`size-limit` check plus an Angular budget in `angular.json`) and was not built in this pass.** If asked, this is an honest "not yet implemented, here's what I'd add" answer rather than something to claim exists — worth actually adding before relying on this project as a complete answer to this exact question.

### How do you enforce test coverage in CI?
Two distinct layers, worth naming both: (1) SonarQube's Quality Gate condition on new-code coverage, enforced structurally via a required status check — not a suggestion. (2) The underlying mechanics that make that number meaningful at all: `nx run-many -t test --all --codeCoverage` (note: `--codeCoverage`, the real Jest executor schema property — `--coverage` looks right but is silently a no-op against this executor) plus `coverageReporters: ['html', 'lcov', 'text-summary']` explicitly set in the shared `jest.preset.js`, needed because Nx's own preset silently defaults that to `['html']` only, which produces no `lcov.info` for SonarQube to parse.

### What is a code smell?
Code that isn't necessarily a bug but signals a maintainability risk — long functions, deep nesting, duplicated logic, unclear naming — SonarQube flags these as a distinct category from actual bugs/vulnerabilities, because "will this cause an incident" and "will this be painful to change in six months" are different questions worth tracking separately.

### How do you prevent performance regressions?
Same core idea as any quality gate: turn "someone should probably check performance sometimes" into a structural, automatic, un-skippable CI step. Here specifically: Lighthouse CI's category-score assertions as a required check mean a PR that regresses performance/accessibility/best-practices below 90 or SEO below 80 physically cannot merge — not a review comment asking nicely, a failed required check blocking the merge button.

---

## Things to fix before an interview, not just talk around
- Add the bundle-size check (Stage 4 item never completed).
- Decide and be able to state clearly whether production migrations should become automatic (currently manual `db:deploy`, unlike the Docker path's automatic `migrate deploy` on container start) — the inconsistency between the two paths is a fair thing for an interviewer to probe.
- Confirm Vercel's per-PR preview deployments are actually firing (should be automatic, hasn't been explicitly verified in a CI log this session).
- Decide on staging: either finish it for real (push the `staging` branch, add CI/Ruleset coverage for it, confirm a separate Vercel deployment and a genuinely separate Supabase project) or consciously leave it as a documented "started but deprioritized" item. Right now it's neither — a provisioned-but-inactive Render service that the README no longer claims, which is the honest state but not yet a finished story either way.

Resolved: `.dockerignore` exists and correctly excludes `node_modules`, `dist`, `.git`, `.angular`, `.nx`, and both `.env` variants.
