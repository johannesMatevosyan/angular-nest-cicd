# Angular-Nest-CICD

A full-stack task manager built with **Angular**, **NestJS**, and an **Nx monorepo** — used as a hands-on project to learn and demonstrate a production-grade CI/CD pipeline. The app itself is intentionally simple; the real engineering here is the delivery pipeline wrapped around it.

## 🚀 Live

- **Frontend:** https://angular-nest-cicd.vercel.app/
- **Backend API:** https://angular-nest-cicd-api.onrender.com/api

> Backend is on Render's free tier — expect a ~30–60s cold start after ~15 minutes of inactivity.

[![CI](https://github.com/johannesMatevosyan/angular-nest-cicd/actions/workflows/ci.yml/badge.svg)](https://github.com/johannesMatevosyan/angular-nest-cicd/actions/workflows/ci.yml)
[![Lighthouse CI](https://github.com/johannesMatevosyan/angular-nest-cicd/actions/workflows/lighthouse.yml/badge.svg)](https://github.com/johannesMatevosyan/angular-nest-cicd/actions/workflows/lighthouse.yml)
[![Quality Gate](https://sonarcloud.io/api/project_badges/quality_gate?project=johannesMatevosyan_angular-nest-cicd)](https://sonarcloud.io/summary/overall_health?id=johannesMatevosyan_angular-nest-cicd)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=johannesMatevosyan_angular-nest-cicd&metric=coverage)](https://sonarcloud.io/summary/overall_health?id=johannesMatevosyan_angular-nest-cicd)

## 📖 About

This repo exists to go deep on the delivery pipeline, not the app. Every stage was built to understand the *reasoning* behind each decision, not just to get it working:

- Continuous integration with `nx affected` (only test/build what actually changed)
- Branch protection via GitHub Rulesets, with required status checks and automated PR bot comments
- Two fully isolated environments — **staging** and **production** — each with its own database, backend service, and frontend deployment
- Multi-stage Docker builds for both apps, with a local `docker-compose` dev environment (Postgres included)
- Automated container image publishing to GitHub Container Registry on every merge to `main`

## 🛠 Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Angular 22 (standalone components, esbuild builder) |
| Backend | NestJS 11 |
| ORM | Prisma 7 (driver adapters — `@prisma/adapter-pg`) |
| Database | PostgreSQL — Supabase (prod/staging), local Docker Postgres (dev) |
| Monorepo | Nx 23 |
| Containers | Docker (multi-stage builds), Docker Compose |
| CI | GitHub Actions |
| Registry | GitHub Container Registry (GHCR) |
| Hosting | Vercel (frontend), Render (backend) |
| Quality gates *(planned)* | SonarCloud, Lighthouse CI |

## 🏗 Pipeline Overview

**On every PR:**
```
PR opened → nx affected (lint, test, build) → required check + PR bot comment → squash-merge only when green
```

**On merge to `main`:**
```
                ┌── Vercel deploys frontend (static build)
push to main ───┼── Render deploys backend (Prisma migrate + Nest server)
                └── GitHub Actions builds + pushes both Docker images to GHCR
                     tagged :latest and :<short-sha>
```

**Environments:** a feature branch merges into `staging` first (its own Supabase project, own Render service, own Vercel preview URL) for verification, before a separate PR promotes `staging` → `main` for production.

## 🏷 Image Tagging Strategy

Every published image gets two tags:
- `:latest` — a convenience pointer, fine for local `docker pull`, **never** used as a deploy reference
- `:<short-sha>` — immutable, always traceable back to the exact commit that produced it

Anything actually deployed should reference the SHA tag, so "what's running" and "what commit is that" are always the same answer. See [Packages](https://github.com/johannesMatevosyan/angular-nest-cicd/pkgs/container/angular-nest-cicd-backend) for published images.

## 📦 Local Development

```bash
git clone https://github.com/johannesMatevosyan/angular-nest-cicd.git
cd angular-nest-cicd
docker compose up --build
```

This spins up Postgres, the NestJS API, and the Angular frontend (via nginx) as three networked containers. First run applies migrations automatically.

Manual (non-Docker) setup:

```bash
npm install
npm run db:generate
npm run db:migrate
npx nx serve backend    # http://localhost:3000/api
npx nx serve frontend   # http://localhost:4200
```

Requires a `.env` in `apps/backend` with `DATABASE_URL` and `DIRECT_URL` (see Prisma section below for why there are two).

## 📝 Notes

Detailed build notes, gotchas, and interview-prep write-ups for each stage of this pipeline live in `CICD-Notes.md`.
