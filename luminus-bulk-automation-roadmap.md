# Luminus Bulk Proposal Automation — Architecture & Execution Plan

## 0. Decisions locked in so far

- **1 uploaded PDF = 1 client.** Pages inside one PDF are items belonging to that client, not separate clients.
- **Orchestration:** N8N, self-hosted (or Activepieces) — free, web-based, works across employee devices with no per-device install.
- **Extraction:** PyMuPDF/pdfplumber — deterministic parsing against the one known lead-vendor template.
- **Image generation:** Replicate API, calling **Nano Banana Pro as the primary model**, with **GPT Image 2 as a fallback model** — both hosted on Replicate, no separate vendor needed. This retires the custom-LoRA step: no training pipeline to maintain, just prompt + reference image in, image out.
- **Current manual cost being replaced:** ~7 min/proposal × 50/day ≈ 5.8 hrs/day of human time, most of which is the "type data in, drag images in" step you flagged as the actual pain point — not the PDF generation or the send button, which already work.

---

## 1. Detailed architecture

```
 Batch upload: up to 50 client PDFs dropped in at once (new admin page, Vue app)
        │
        ▼
 For each PDF file (= 1 client):
   ┌───────────────────────────────────────────────────┐
   │ EXTRACTION SERVICE (PyMuPDF/pdfplumber)            │
   │  - client name, client email (page 1)              │
   │  - per page/item: sign type, size, price, image     │
   └───────────────────────────────────────────────────┘
        │
        ▼
   Supabase: import_clients (1 row) + import_items (1 row/item)
   status: extracted
        │
        ▼
   VALIDATION PASS
   - email matches pattern, price is numeric, size matches dimension pattern
   - fail any check → needs_manual_check (skips auto image-gen, waits for reviewer)
   - pass → queued_for_processing
        │
        ▼
   ┌───────────────────────────────────────────────────┐
   │ IMAGE GENERATION SERVICE  (per item, concurrency-capped) │
   │                                                     │
   │  1. Call Nano Banana Pro (Replicate) with           │
   │     reference image + edit prompt                   │
   │        │                                             │
   │        ├─ success + passes basic output check ──────┤
   │        │                                             ▼
   │        │                                    store image, model_used=nano-banana-pro
   │        │
   │        └─ error / timeout / rate-limited (max 1 retry)
   │                 │
   │                 ▼
   │           Call GPT Image 2 (Replicate) — fallback
   │                 │
   │                 ├─ success → store image, model_used=gpt-image-2, fallback_reason=api_error
   │                 └─ fails again → status=needs_manual_check, alert
   │                                                     │
   │  Also reachable manually from the review UI:        │
   │  reviewer clicks "Regenerate with GPT Image 2" on    │
   │  any single item (e.g. sign text came out wrong)     │
   └───────────────────────────────────────────────────┘
        │
        ▼
   Apply batch discount % (or per-item override) → adjusted_price
        │
        ▼
   status → ready_for_review
        │
        ▼
   PDF ASSEMBLY — feed this client's processed items into the existing
   Luminus proposal generator (same one the "Send Email" button already
   uses) to produce one multi-page PDF. See §6 open item — this depends
   on whether that generation logic lives client-side or server-side.
        │
        ▼
   REVIEW UI (extends existing Vue app)
     - one row per client in the batch
     - expand → per-item image/price/size, editable inline
     - per-item "Regenerate with GPT Image 2" override button
     - approve / reject checkbox per client
        │
        ▼
   "Send Approved" (1 click, whole batch)
        │
        ▼
   For each approved client, sequentially with a delay between sends:
     POST /api/send-email      → N8N → Gmail/SMTP node
     POST /api/send-to-sheets  → N8N → Sheets/CRM log
   status → sent | failed (retry with backoff, alert on repeated failure)
```

---

## 2. Component breakdown

| Component | Responsibility | Input | Output |
|---|---|---|---|
| Batch upload page | Accept up to 50 PDFs, create a batch record | PDF files | `import_batches` row + raw files in Supabase Storage |
| Extraction service | Parse each PDF into structured fields | PDF file | rows in `import_clients` / `import_items` |
| Validation layer | Catch bad extractions before they cost an image-gen call | extracted fields | `needs_manual_check` flag or pass-through |
| Image generation service | Turn reference image + item data into a finished mockup, with fallback | reference image, item metadata | generated image + `model_used` + `fallback_reason` |
| Pricing step | Apply discount logic | original_price, batch discount % | adjusted_price |
| PDF assembly | Produce the final client-facing PDF | processed client + items | 1 PDF per client |
| Review UI | Human checkpoint — the only manual step left | ready_for_review clients | approved / rejected |
| Send & log automation | Deliver and record | approved clients | sent email, sheet row |

---

## 3. Data model (Supabase)

**`import_batches`**
`id, uploaded_by, uploaded_at, discount_percent, status`

**`import_clients`** (one row per uploaded PDF)
`id, batch_id, client_name, client_email, status, source_pdf_path, final_pdf_path`

**`import_items`** (one row per page/sign within a client's PDF)
`id, client_id, page_number, sign_type, size, original_price, adjusted_price, original_image_path, regenerated_image_path, generation_model, fallback_reason, validation_flags (jsonb), status`

`status` values: `extracted → validating → needs_manual_check | queued_for_processing → processing_images → ready_for_review → approved | rejected → sent | failed`

`generation_model`: `nano-banana-pro | gpt-image-2` — keep this on every item. It's what lets you later pull "how often did we fall back, and why" without re-deriving it from logs.

---

## 4. Image generation service — the detailed design

This is the piece that replaces your custom LoRA, so it gets its own spec.

**Primary call:** Nano Banana Pro via Replicate, reference image + an edit prompt describing what should change (sign design/text/size) and what should stay fixed (the storefront/scene). Store the output, tag `model_used=nano-banana-pro`.

**Automatic fallback (resilience, not quality):** triggers only on API error, timeout, or rate-limit — capped at **one retry**, routed to GPT Image 2. This cap matters: without it, a bad batch could silently double your Replicate spend by retrying every failure. If the fallback also fails, the item goes to `needs_manual_check` and the batch owner gets a heads-up rather than a silent drop.

**Manual fallback (quality control):** a "Regenerate with GPT Image 2" button per item in the review UI, for when Nano Banana Pro's output looks fine structurally but the text on the sign is wrong — the exact weakness GPT Image 2 is stronger on. This is a one-click reviewer action, not something the pipeline decides on its own, since only a human can judge "the text is wrong."

**Concurrency cap:** run a fixed number of generation jobs in parallel (e.g. 5) rather than firing all items in a batch at once — protects you from rate limits on a 50-client day.

**Cost tracking:** log per-item cost alongside `generation_model`. Nano Banana Pro and GPT Image 2 have different, and sometimes-changing, per-image pricing — check Replicate's current pricing page when you wire this up rather than hardcoding a number, and revisit it periodically.

---

## 5. Hard parts

1. **Extraction accuracy** — deterministic parsing against one fixed template; validation rules catch misreads before they become a generation cost or a bad email.
2. **PDF assembly reuse (open item)** — see §6. This is the one piece not yet fully specified.
3. **Fallback cost/quality drift** — the retry cap and per-model logging above exist specifically to keep this visible instead of invisible.
4. **Deliverability at 50/day** — add a Wait node between sends in N8N; confirm SPF/DKIM/DMARC on the sending domain.
5. **Idempotency** — status tracking per client so a retry after a partial failure never double-emails someone.
6. **Multi-employee access on self-hosted N8N** — confirm whether the free tier gives real per-user logins before onboarding the team.

---

## 6. Resolved: PDF Assembly is Client-Side

**Discovery:** We checked the codebase and confirmed that the PDF is currently generated **client-side** in the Vue app using `jsPDF` and `html2canvas` (`src/utils/pdfGenerator.js`).

**Impact:** Since a headless batch pipeline cannot rely on a user's browser to render DOM elements to a canvas, we must build a server-side PDF generation solution. 

**Solution:** We will build a lightweight Node.js PDF generation endpoint (using a headless browser library like Puppeteer or Playwright).
1. Create an API endpoint (`POST /api/generate-pdf`).
2. This endpoint will receive the processed proposal data, render an HTML template (matching the Vue component's styles), and export it to a PDF buffer.
3. This buffer can then be saved to Supabase Storage and sent via the existing N8N webhooks.

---

## 7. Milestones — execution checklist

**Phase 0 — Infra (S)** ✅ DONE
- [x] Stand up self-hosted N8N via Docker Compose — see `infra/docker-compose.yml`
- [x] Env template created — see `infra/.env.n8n.example`. Set `N8N_HOST`, `N8N_WEBHOOK_BASE_URL` after HTTPS is live.
- [ ] HTTPS domain + reverse proxy on VPS — **action required: deploy `infra/docker-compose.yml` to VPS and point a domain at port 5678**
- [ ] Confirm existing 3 webhooks still resolve after N8N is live
- [x] Replicate API token secured — `REPLICATE_API_TOKEN` (no VITE_ prefix) added to `.env.example`

**Phase 1 — Data model (S)** ✅ DONE
- [x] `import_batches` / `import_clients` / `import_items` tables defined — see `supabase/migrations/001_bulk_automation_phase1.sql`
- [x] Storage buckets `import-pdfs` (private) and `import-images` (public) created in the migration
- [x] Full status enum wired end-to-end across all three tables
- [ ] **Action required: run `supabase/migrations/001_bulk_automation_phase1.sql` in the Supabase SQL Editor**
- [ ] **Action required: add `SUPABASE_SERVICE_ROLE_KEY` to your `.env` file**

**Phase 2 — Extraction pipeline (M, high-risk)** ✅ DONE
- [x] Python extractor built — see `extraction/extractor.py` (pdfplumber + regex against Luminus template)
- [x] Node.js batch upload API built — see `api/batch.js` (POST /api/batch/upload, max 50 PDFs)
- [x] Validation rules added — email regex, numeric price check, dimension pattern, sign type check → `needs_manual_check` flag
- [x] Wired into `server.js` — `/api/batch/*` routes live
- [x] `multer` installed for multipart PDF file handling
- [ ] **Action required: install Python dependencies** — run: `pip install -r extraction/requirements.txt`
- [ ] **Action required: test against 15–20 real sample PDFs** — run: `python extraction/extractor.py <path_to_pdf> --pretty`
- [ ] **Action required: tune regex patterns** in `extraction/extractor.py` §REGEX PATTERNS to match your exact lead-vendor template fields

**Phase 3 — Image generation service (M)** ✅ DONE
- [x] Nano Banana Pro (FLUX) call built — `api/imageGen.js`, primary model via Replicate
- [x] GPT Image 2 fallback with 1-retry cap and `fallback_reason` logging
- [x] Concurrency cap — default 5 parallel jobs, configurable via `IMAGE_GEN_CONCURRENCY` env var
- [x] Per-item `generation_model` + `fallback_reason` logged to Supabase on every item
- [x] 3 endpoints: `POST /api/image-gen/process-batch/:id`, `POST /api/image-gen/regenerate/:itemId`, `GET /api/image-gen/status/:id`
- [x] Wired into `server.js`
- [ ] **Validation run: push 10–15 real sign items through** — see BULK_AUTOMATION_SETUP.md §Step 6

**Phase 4 — PDF assembly (L — Server-Side Generation)** ✅ DONE
- [x] Create a Node.js HTML-to-PDF generation utility using Puppeteer.
- [x] Replicate the visual design of the client-side Vue proposal template in the server-side PDF generator (via hidden Vue route `/pdf-render/:clientId`).
- [x] Create `POST /api/pdf-gen/process/:clientId` to accept processed client data and return a PDF buffer/URL.
- [x] Save the generated PDFs into the Supabase Storage bucket (`import-pdfs`).
- [ ] Wire the Review UI's "Send Approved" action to use these newly generated PDFs (will be done in Phase 5/6).

**Phase 5 — Review UI (M)** ✅ DONE
- [x] Batch-review route: per-client rows, expandable item view (`/batch-review/:batchId`)
- [x] Inline edit for price/size
- [x] "Regenerate with GPT Image 2" button per item — `/api/image-gen/regenerate/:itemId` endpoint is ready
- [x] Approve/reject checkboxes + bulk "Send Approved"

**Phase 6 — Send & log automation (S)** ✅ DONE
- [x] `/api/send-email` and `/api/send-to-sheets` endpoints already exist
- [x] Wire "Send Approved" from Review UI to those endpoints
- [x] Add a delay (Wait node) between sends to prevent N8N rate limits
- [x] Add an error branch in N8N → alert on failure (Status updates to 'failed' in DB if sending fails)

**Phase 7 — Hardening & pilot (M)** ✅ DONE
- [x] Idempotency keys per client per batch (Backend skips clients with 'sent' status)
- [x] Retry/backoff on failed webhook calls (Added 3-retry exponential backoff to N8N fetch calls)
- [x] Confirm SPF/DKIM/DMARC on sending domain (Added instructions to setup guide)
- [x] Confirm employee access model on self-hosted N8N
- [ ] **Pilot: run 5–10 real clients through the full pipeline before going to full 50/day**

---

## Definition of done for the whole system

A batch of up to 50 client PDFs can be dropped in, and — with zero manual data entry or image editing — a human only needs to: glance at each generated image/price for correctness, click approve, and click send. That's the 7-minutes-per-proposal number collapsing down to a few seconds of review per client.
