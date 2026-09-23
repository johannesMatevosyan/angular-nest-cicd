# CI/CD Build Notes & Gotchas

A chronological log of what actually went wrong (and why) building this pipeline, stage by stage. Where `InterviewNotes.md` answers "what is X and why does it matter," this file is the messier, more honest version: the actual bugs hit, the wrong turns taken first, and what the real fix was — good material for "tell me about a hard bug you debugged" as much as it is a build log.

Stages 1–3's gotchas were captured from earlier work on this project and are lighter on step-by-step detail than Stage 4, which was built and debugged in real time against this file. If you remember additional issues from Stages 1–3 that aren't here, worth adding them.

---

## Stage 1 — Nx Monorepo + Basic CI

- **Nx's ESLint target doesn't register as `lint`.** The `@nx/eslint/plugin` inferred-plugin system lets you rename the target via `targetName` in `nx.json` — this repo's is explicitly set to `eslint:lint`. Referencing the wrong name in a workflow (`-t lint` when the real name is `eslint:lint`, or vice versa) doesn't error — Nx just runs the target against zero matching projects and reports success. A CI step that looks green may have linted nothing at all. Always verify with `npx nx show project <name> --json` rather than assuming the target name.
- **Renaming a CI job breaks branch protection silently.** If a workflow job's name changes (e.g. `main` → `build`), any GitHub Ruleset/branch-protection rule still pointing at the old job name stops matching anything — the check just never shows up as satisfied, and PRs get stuck. Job renames and branch-protection required-check lists have to be updated together, in the same PR if possible.
- **Squash-merge complicates branch reuse.** Squash-merging a PR collapses its commits into one on `main`; if you then reuse the same branch name for a new round of work, GitHub may consider it "out of date" in a way that's confusing to reason about compared to the original branch's history. Simplest fix: use a fresh branch name per fix/feature rather than recycling one after it's been squash-merged.

## Stage 2 — CD: Vercel + Render + Supabase

- **Prisma 7 is a real breaking change, not a patch bump.** Driver adapters (`@prisma/adapter-pg`) became mandatory, and the database connection URL moved out of `schema.prisma` entirely into `prisma.config.ts`. Code and tutorials written for Prisma 6 don't translate directly.
- **`npm install prisma@latest` is not safe to run blind.** At one point this resolved to an unstable `8.0.0-rc.*` pre-release rather than the intended stable version. Pin exact versions (`prisma@7.10.0`) for reproducibility — `latest` on npm doesn't always mean "latest stable" in practice.
- **NestJS CORS has to be enabled before `listen()`, not after.** `app.enableCors()` called after `app.listen()` fails silently — no error, CORS just doesn't work. Easy to lose an hour to this because there's no exception pointing at the real problem.
- **Vercel scopes environment variables per deployment type.** A variable scoped to "Production" only does not automatically apply to Preview deployments — has to be explicitly scoped to both if both need it.
- **Prisma's CLI needs live network access even for "offline" operations.** `prisma migrate`/`generate` reach out to `binaries.prisma.sh` to fetch the correct query-engine binary; this can't be validated inside a fully sandboxed/offline environment, which is worth knowing before assuming a sandboxed CI dry-run will catch every issue.

## Stage 3 — Docker

- **Dummy credentials in build `ARG`s, never real ones.** The backend `Dockerfile`'s `ARG DATABASE_URL=postgresql://user:pass@localhost:5432/db` is intentionally fake — `prisma generate` never opens a real connection, so a placeholder is all it needs. This matters because anything passed as a Docker `ARG`/`ENV` gets baked permanently into that image layer, readable by anyone who can pull or inspect the image — a real credential there would be a genuine leak, not just bad practice.
- **Non-root runtime via the image's built-in user, not a custom one.** `USER node` in the backend's final stage uses the official Node image's pre-created unprivileged user (uid 1000) rather than manually creating one — one less thing to get wrong.
- **`exec "$@"` in the entrypoint script isn't decorative.** `docker-entrypoint.sh` runs migrations, then does `exec "$@"` rather than just calling the command directly. Without `exec`, the Node process would run as a child of the shell script, and the shell — not Node — would be PID 1 and the one actually receiving `SIGTERM` on shutdown, risking an ungraceful kill instead of a clean one.
- **Local dev deliberately doesn't touch Supabase.** `docker-compose.yml` spins up a local Postgres 16 container rather than pointing at the real hosted database — so local experimentation can't accidentally corrupt or exhaust the free-tier production database, and doesn't require network access to work at all.

## Stage 4 — Quality Gates

This stage produced the most debugging, across three separate tools, each with its own multi-layer bug.

### Lighthouse CI
- **Windows-only `chrome-launcher` EPERM bug** cleaning up Chrome's temp profile directory after each run ([known issue](https://github.com/GoogleChrome/chrome-launcher/issues/355)) — not fixable from `lighthouserc.js`, and irrelevant to the actual Linux CI runner, but burned real local debugging time before that was clear.
- **WSL2's Windows interop silently resolved `node`/`npm` to Windows-side binaries** even inside a WSL bash shell — diagnosed via `which node` pointing at `/mnt/c/Program Files/nodejs/...`. Fixed by installing a genuine Linux Node via `nvm` inside WSL.
- **Even after installing native Linux Chrome, `chrome-launcher` kept launching Windows Chrome** via `/mnt/c/...` paths, and WSL2's network boundary meant `127.0.0.1:<port>` from the Linux side couldn't reliably reach a Windows-side Chrome process anyway. Eventually abandoned local WSL Chrome debugging entirely and verified directly against real GitHub Actions CI instead — sometimes the fastest path is to stop fighting a local environment mismatch and trust the actual CI runner.
- **Chrome refuses to run as root without `--no-sandbox`.** Fixed via `chromeFlags: ['--no-sandbox', '--disable-dev-shm-usage']` in `lighthouserc.js`, matching Lighthouse CI's own documented Docker/CI recipes.
- **A brand-new, PR-only-triggered workflow can't be manually triggered until it's "known" to GitHub.** Both the Actions UI's "Run workflow" button and `gh workflow run --ref <branch>` require the workflow file to already exist on the default branch, or to have fired at least once via a real trigger — a chicken-and-egg problem for verifying a new workflow before merging it. Worked around by temporarily removing the `paths` filter so a normal PR push would trigger it for the first time, then restoring the filter afterward — and later removing it again permanently once Lighthouse CI needed to become a required check (see below for why).

### SonarQube Cloud coverage — three separate root causes, found in sequence
1. **`--coverage` looks right for the `@nx/jest:jest` executor but isn't the schema property name — `codeCoverage` is.** Passing `--coverage` was silently accepted and echoed by Nx as an "additional flag" but never actually reached Jest as a real option, so no coverage was collected at all.
2. **After fixing the flag, coverage ran but no `lcov.info` was produced.** Root cause: Nx's own `@nx/jest/preset` bakes in `coverageReporters: ['html']` as a default, silently overriding Jest's real default (`['json', 'text', 'lcov', 'clover']`). Fixed by explicitly setting `coverageReporters: ['html', 'lcov', 'text-summary']` in the shared `jest.preset.js`.
3. **After fixing that too, `lcov.info` still didn't appear on the first retry.** Root cause: Nx's local task cache doesn't reliably track a shared root config file (`jest.preset.js`) referenced only indirectly via `preset:` as a cache input for the `test` target — so it replayed a stale cached result instead of re-running Jest. Fixed with `--skip-nx-cache`.
- **SonarQube's "New Code" coverage and the main branch's "Overall Code" coverage are genuinely different numbers.** A PR that only touches CI/config files (no application source) will correctly show "not enough lines to compute coverage" on its own New Code view, while the main branch's Overall Code view — the number the README badge actually reads — reflects the whole project. Don't read a PR's New Code page as evidence a coverage fix failed; check the main branch's Overall Code view instead.
- **SonarCloud's rebrand to "SonarQube Cloud" broke an old badge-link URL.** `/summary/overall_health?id=...` is a retired legacy path (404); the current working path is `/project/overview?id=...`. The badge *image* endpoint (`api/project_badges/...`) was unaffected — only the click-through link needed fixing.
- **Project visibility (public/private) lives under Administration → Permissions, not General Settings** — easy to miss on a first look through SonarQube Cloud's admin UI.

### ESLint strict enforcement
- **The `@nx/eslint:lint` executor is deprecated** (removal planned for Nx v24) in favor of the inferred-plugin system (`@nx/eslint/plugin`), which this repo already uses, with a customized `targetName: "eslint:lint"`. The deprecated executor's `schema.json` was useful only to confirm the real `maxWarnings` property name existed — but the actual running target uses a different execution path (visible from its `> eslint .` raw-command echo, distinct from how the legacy executor reports).
- **Passing extra flags to an inferred-plugin (Crystal) target works via `--` passthrough, forwarded straight to the real shell command** — `nx affected -t eslint:lint -- --max-warnings=0` appends directly to the literal `eslint .` invocation, so `--max-warnings` reaches ESLint itself as a genuine native CLI flag rather than needing to match any Nx executor schema. This was verified empirically (deliberately introducing an unused-variable warning and confirming the run actually failed), not just inferred from documentation.
- **Nx Cloud's "flaky task" detector is a false positive here.** It flagged `backend:eslint:lint` as flaky because a fresh (uncached) run failed right after an earlier cached run had succeeded — that's not flakiness, that's the code genuinely changing between the two runs (a deliberate test warning was added). Worth knowing this detector can trigger on legitimate before/after differences, not just real nondeterminism.

### Branch protection
- **`needs: <job>` inside a workflow is not the same thing as a required status check.** `needs` only controls execution order *within one workflow run* (e.g. "wait for `build` to finish before running `pr-comment`"). Whether a check actually blocks merging is a completely separate GitHub setting — Rulesets (or classic branch protection) → "Require status checks to pass before merging" — easy to conflate the two since they sound similar.
- **A required check tied to a `paths:`-filtered workflow can get permanently stuck pending.** If a workflow only triggers on certain file paths, and it's marked as a required check, any PR that doesn't touch those paths never gets a status posted for it at all — GitHub treats "never ran" as eternally pending, not as passed. This is exactly why `lighthouse.yml`'s `paths: apps/frontend/**` filter had to come off before marking `Lighthouse CI` as required — otherwise a backend-only PR would be unmergeable forever.

### Local environment
- **npm's Nx native binding is platform-specific, and switching terminals mid-project causes real crashes.** Running `npm ci` inside WSL (Linux) installs only the Linux-native Nx addon; running `nx` afterward from native Windows PowerShell then fails with `(0, native_1.isAiAgent) is not a function` because the Windows-native binding was never installed. Fix is either reinstalling from whichever terminal you're actually using, or just staying consistent about which one you use for a given work session.

## Final Step — Documentation honesty pass

Writing `Architecture.md` and `InterviewNotes.md` surfaced real gaps between what the README *claimed* and what was actually built or verified — worth recording here as its own category of lesson: a portfolio README is public claims that can be checked, so it needs the same "verify before stating" discipline as a bug fix.

- **Docker images are published correctly but consumed by nothing.** `docker-publish.yml` builds and pushes both images to GHCR with correct tags — but the GHCR package's own download count is **0** on every tag, and Render's service settings confirmed directly (build command `npm install && npm run db:generate && nx build backend`, no Dockerfile reference at all) that production is a plain git-native buildpack deploy on both Vercel and Render. The Docker pipeline is real, just parallel to — not part of — what's actually live.
- **A staging environment was half-built, not fully built or entirely absent.** A second Render service (`angular-nest-cicd-api-staging`) exists, configured to auto-deploy from a `staging` branch — but that branch only ever existed locally and was never pushed to GitHub, so the service has nothing to deploy from right now. No Ruleset/required-checks coverage targets `staging` either. The README originally overclaimed a fully working parallel staging environment; corrected to omit the claim rather than either finish the work under time pressure or leave a false statement live.
- **Migrations are handled inconsistently between the two deploy paths.** The Docker path (`docker-entrypoint.sh`) runs `prisma migrate deploy` automatically on every container start; actual production deploys on Render rely on manually running `npm run db:deploy` — there's no automatic migration step wired into the real deploy path at all. A fair thing for anyone reviewing this to notice and ask about.
- **The Stage 4 bundle-size check was never implemented**, despite being in the original learning plan (a `bundlesize`/`size-limit` package, an Angular budget in `angular.json`, a PR comment on growth). Left as an open item rather than glossed over.

## Open items (see `InterviewNotes.md` for the full checklist)

- Bundle-size CI check — not built.
- Decide: finish staging for real (push the branch, add Ruleset coverage, separate Supabase project, separate Vercel deployment) or consciously drop it as a documented future enhancement.
- Decide: whether production migrations should become automatic, and if so, how (a Render pre-deploy hook, or a CI step).
- Confirm Vercel's per-PR preview deployments are actually firing — assumed based on Vercel's default behavior, never explicitly checked in a real PR.
