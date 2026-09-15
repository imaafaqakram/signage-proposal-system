# Changelog

## 2026-08-18 — CRM Lead Import, Saved Leads, Confidentiality Scrub

### Added
- **Fetch from CRM** (`EditorSidebar.vue`, `server.js`'s `/api/migrate-lead`): pull a lead straight into the editor by name or by date, no terminal, no manual file upload. Runs the local lead-import script as a subprocess and streams live per-client progress (pending → processing → done/failed) over NDJSON, so a batch of many clients shows real-time status instead of one long silent wait.
  - Each client gets its own 150-second timeout — a single slow or stuck lead can only ever cost 150s and gets marked failed; it can never take an entire batch down with it, and every already-succeeded client is delivered to the browser the moment it finishes.
  - A **Stop** button cancels an in-flight fetch immediately — no further CRM/AI calls happen after clicking it.
  - Local dev only (spawns a Python script) — see USER_GUIDE.md section 5 for why this can't run on Vercel.
- **Saved Leads** (`db.js`, `api/leads.js`, `server.js`'s `/api/leads`, `EditorSidebar.vue`): every fetched lead is saved automatically; a green **Save** button persists manual edits too. Full version history — every save creates a new version, nothing is ever overwritten, any past version can be reloaded (including restoring one after a bad edit). Backed by Supabase, so this works identically on the local dev server and once deployed — recall or edit any client without ever repeating a CRM/AI call.
- Real Gemini integration (`api/ai.js`, `server.js`'s `/api/gemini`): replaced the placeholder gradient-SVG stub with an actual Gemini image-to-image call, rotating across up to 3 accounts on rate limits. Fixed the prompt-enhancer model name (`gemini-2.0-flash` → `gemini-3.6-flash`) after confirming live that the old one had been retired.
- Image-to-Image mode in `AIChat.vue` now actually sends the source image (previously a silent no-op).

### Changed
- `db.js` moved from local SQLite to Supabase (`supabase/migrations/004_add_leads_tables.sql`) — a local file-based DB would have worked for local dev but has no persistent disk on Vercel's serverless functions, so it would silently break once deployed. All read/write functions are now async; every call site updated to match.
- `/api/leads` routes switched from path params (`/api/leads/:id/versions`) to query params (`/api/leads?id=X&action=versions`) to match the existing Vercel-function convention already used elsewhere in this codebase (`api/replicate.js`) — the same URLs now work identically from `server.js` locally and `api/leads.js` once deployed.

### Fixed
- **Root cause of a real hang**: one CRM record's PDF embedded a 146-megapixel image; hashing/cropping/encoding it never finished, silently killing an entire multi-client batch with zero results. Fixed by capping any loaded image to 3000px on its longest side immediately after load, before any expensive processing runs on it.
- **A subtle Node/Express bug**: the original cancel-detection listened on `req.on('close')`, which actually fires almost immediately after Express finishes reading the POST body — a parsing artifact, not a sign the client disconnected. Depending on timing this either did nothing or silently killed an in-progress fetch for no real reason. Fixed by listening on `res.on('close')` instead, guarded by `!res.writableEnded`.
- Deprecated Gemini model names (`gemini-2.0-flash`, `gemini-2.5-flash` for text) returned 404s when tested live — updated everywhere to `gemini-3.6-flash`.

### Security / Confidentiality
- Removed every mention of the underlying CRM vendor and specific customer-brand names from the repo, code comments, UI text, toast messages, environment variable names, and a database migration filename — renamed to generic terms (`CRM`, `crmRecordId`, `CRM_API_TOKEN`) so neither an end user of the deployed app nor anyone browsing this public GitHub repo can trace which CRM or which brands this pulls from.
- Added a real `.gitignore` entry for the local Supabase/SQLite-era `data/` directory (superseded by Supabase, kept as a guard).
- **Found and flagged**: an upstream commit (`f5d7735`) had committed what appeared to be a real Google API key directly into `.env.example` (a file meant to hold placeholders only, and already public on GitHub). Replaced with a placeholder in this branch; the user was told to rotate/revoke the key independently, since it was already exposed before this fix.
- Verified (by reading the actual PDF-generation code, not assuming) that none of this ever reached the client-facing proposal PDF: `pdfGenerator.js` builds the PDF via `html2canvas` off visible DOM content only, and the only PDF metadata jsPDF embeds by default is its own library version string — no Author, Subject, or Keywords fields are set anywhere.

### Authorship
- Established real git history (this repo had none for any of the above work until now) and added copyright/author comments to every file touched — dev-facing only, verified never visible in the app UI or any generated PDF.
