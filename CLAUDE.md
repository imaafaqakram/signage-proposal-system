# CLAUDE.md / AGENTS.md — repository briefing (public-safe)

This repository is the **Luminus Proposal System + CRM** used by Signage Crafting. It is a **live business system**: staff use it daily and it e-mails real customers. Read this before changing anything. (Server addresses, logins and the full operating history are kept in a *separate private handover pack*, not in this repository.)

## What it is
* One **Vue 3 + Pinia + Vue Router + Vite 5 + Tailwind 3** single-page app, served by one **Node 22 / Express 4** back end (`server.js`) with self-contained CRM modules `crm-*.js`.
* The same app is the **Proposal System** (editor, daily lead fetch, e-mail PDF to client) and, when opened on a host name that starts with `crm.`, the **CRM** (inbox, leads, pipeline, follow-ups, orders, finance, materials, vendors, announcements, team).
* Data: **Supabase** (Postgres + Storage). Lead engine: Python `migrate.py` (PyMuPDF, Pillow, Gemini API) called by the server. Automation: **n8n**. Proxy: **Caddy**. Process manager: **PM2**.
* Folders: `src/` (front end), `server.js` + `crm-*.js` (back end), `scripts/` (cron jobs), `supabase/migrations/` (SQL — run by a human in the Supabase SQL editor; CRM features degrade gracefully until the matching migration is run), `api/` (legacy handlers).

## Rules that apply to every change
1. **Do not break the Proposal System.** CRM code stays isolated: separate files, mounted only under `/api/crm/*`, guarded by `requireCrmAuth` / `requireCrmAdmin`. Never alter `requireBypassAuth` / `requireAdmin` or any Proposal route while working on the CRM.
2. **Test on staging (or a throwaway copy) first; back up before overwriting; get the owner's approval before production.** Production restarts are the owner's call.
3. **Visual changes need real proof** (screenshot / opened PDF) — a successful build proves nothing about layout. Templates `.sc-page` / `.nl-page` are fixed-height with `overflow:hidden`.
4. **Client-facing PDF page 1 must not change.** The Terms page follows the proposal theme. Phone number comes from the admin setting, not per proposal.
5. **Secrets never go in git, logs, UI or error text.** The Airtable token and the real lead-source brand names are confidential — use the aliases *Brown, Black, Blue, White* only. No source maps. No author name in any client-visible output.
6. **Budgets:** the daily Airtable fetch must stay at about **4 calls per day** (free plan: 1,000 calls per base per month) — never add per-lead Airtable calls. Gemini: free keys first, paid key last; on failure fall back **with a loud DO-NOT-SEND warning**. Client announcements: **max 30 e-mails per rolling hour**, master switch **OFF by default**.
7. **Never mark the real mailbox as read** and never bulk-delete CRM data (it holds the only copy of older client e-mail).
8. **Staging shares the production database** — mark and delete test rows; never run the announcement worker or inbox reconciler on staging.
9. Streaming routes listen on `res.on('close')` (guarded by `!res.writableEnded`), not `req.on('close')`. Puppeteer's `page.pdf()` returns a `Uint8Array` — wrap it in `Buffer.from(...)` before `res.send`. Never regex over multi-MB strings.
10. Be fast and decisive, report exactly what you verified (no "it works" without proof), spell out acronyms for non-technical readers, ask the owner before anything client-visible, destructive, public or costly.

## Develop locally
```bash
npm install
cp .env.example .env     # fill with TEST values — use a separate test Supabase project and a test mailbox
npm run dev              # Vite on :3000, API on :3001 ; CRM view: http://crm.localhost:3000
npm run build            # production build into dist/
```
There are no automated tests; verify with a throwaway copy, real screenshots and real PDFs.

## Deploy (summary)
The production server is updated by **copying files** (not by `git pull`): back up → copy → `node --check` → `npm run build` → `pm2 restart` once → verify. After a deploy, commit to `master` (production = `master`). Details are in the private handover guide.

## Files never to commit
`.env`, `admin-settings.json`, `*-sessions.json`, `google-service-account.json`, `schedule-config.json`, `daily-fetch-status.json`, `fx-cache.json`, `batch-archive/`, `crm-storage/`, `.deploy-backups/`.
