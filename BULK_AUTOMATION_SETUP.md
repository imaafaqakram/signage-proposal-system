# Luminus Bulk Automation — Complete Setup Guide

This guide walks you through every manual step required to get the bulk proposal automation pipeline fully operational. All code has been written — these are the configuration, deployment, and testing steps only you can complete.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1 — Install Dependencies](#step-1--install-dependencies)
3. [Step 2 — Run the Supabase SQL Migration](#step-2--run-the-supabase-sql-migration)
4. [Step 3 — Configure Environment Variables](#step-3--configure-environment-variables)
5. [Step 4 — Deploy Self-Hosted N8N (VPS)](#step-4--deploy-self-hosted-n8n-vps)
6. [Step 5 — Test the PDF Extractor](#step-5--test-the-pdf-extractor)
7. [Step 6 — Start the App and Test Batch Upload](#step-6--start-the-app-and-test-batch-upload)
8. [Step 7 — Configure N8N Workflows](#step-7--configure-n8n-workflows)
9. [Architecture Overview](#architecture-overview)
10. [API Reference](#api-reference)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Make sure these are installed before starting:

| Tool | Minimum Version | Install Command |
|---|---|---|
| Node.js | v18+ | [nodejs.org](https://nodejs.org) |
| Python | 3.9+ | [python.org](https://python.org) |
| pip | 23+ | bundled with Python |
| Docker + Docker Compose | latest | [docker.com](https://docker.com) *(VPS only)* |

You also need:
- A **Supabase** project (free tier works)
- A **Replicate** API token
- A small **VPS** (DigitalOcean, Vultr, Hetzner — $6/mo is enough) for N8N

---

## Step 1 — Install Dependencies

### Node.js (already done if you ran Phase 0/1/2)
```bash
cd C:\Users\ANC\Downloads\The-Luminus-Proposal-System-AI-integrated-main
npm install
```

### Python PDF extraction dependencies
```bash
pip install -r extraction/requirements.txt
```

This installs:
- `pdfplumber` — PDF text and table extraction
- `PyMuPDF` — backup PDF parsing engine

> **Verify it works:**
> ```bash
> python extraction/extractor.py --help
> ```
> You should see the help output without errors.

---

## Step 2 — Run the Supabase SQL Migration

This creates 3 new tables (`import_batches`, `import_clients`, `import_items`), a status enum, indexes, and 2 storage buckets.
If you already ran this migration in a previous phase, also run:
- `supabase/migrations/002_add_pricing_json.sql` for the full pricing-table column
- `supabase/migrations/003_add_sign_detail_fields.sql` for sign details, discounted price, and multi-image support

1. Open your Supabase project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Go to **SQL Editor** (left sidebar, terminal icon)
3. Click **New Query**
4. Open `supabase/migrations/001_bulk_automation_phase1.sql` from this project
5. Copy the entire file contents and paste into the SQL Editor
6. Click **Run** (green button)

> **Verify it worked:**
> Go to **Table Editor** → you should see `import_batches`, `import_clients`, `import_items`  
> Go to **Storage** → you should see `import-pdfs` and `import-images` buckets

---

## Step 3 — Configure Environment Variables

Copy `.env.example` to `.env` if you haven't already:

```bash
cp .env.example .env
```

Then open `.env` and fill in these values:

### Required for the Bulk Automation system

```env
# ── Supabase (existing) ────────────────────────────────────────
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# ── Supabase Service Role Key (NEW — server-side only) ─────────
# From: Supabase → Project Settings → API → service_role key
# ⚠️  NEVER prefix this with VITE_ — it must stay server-side
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# ── Replicate API (server-side, no VITE_ prefix) ──────────────
# From: replicate.com → Account → API Tokens
REPLICATE_API_TOKEN=r8_your_token_here

# ── Image Generation Models ────────────────────────────────────
# Primary: Nano Banana Pro (or FLUX Schnell for testing)
REPLICATE_MODEL_PRIMARY=black-forest-labs/flux-schnell

# Fallback: GPT Image 2 (for quality/text accuracy issues)
REPLICATE_MODEL_FALLBACK=openai/gpt-image-2

# Max parallel image generation jobs (start at 5)
IMAGE_GEN_CONCURRENCY=5

# ── N8N Webhooks (fill in after Step 4) ───────────────────────
N8N_EMAIL_WEBHOOK=https://your-n8n-domain.com/webhook/email-pdf
VITE_N8N_EMAIL_WEBHOOK=https://your-n8n-domain.com/webhook/email-pdf
VITE_N8N_PAYMENT_WEBHOOK=https://your-n8n-domain.com/webhook/payment
VITE_N8N_SHEETS_WEBHOOK=https://your-n8n-domain.com/webhook/sheets
```

---

## Step 4 — Deploy Self-Hosted N8N (VPS)

The Docker Compose file is ready at `infra/docker-compose.yml`.

### On your VPS:

1. **Copy files to VPS:**
   ```bash
   scp infra/docker-compose.yml user@your-vps-ip:~/luminus/
   scp infra/.env.n8n.example user@your-vps-ip:~/luminus/.env
   ```

2. **Edit the `.env` on your VPS:**
   ```bash
   nano ~/luminus/.env
   ```
   - Set a strong `POSTGRES_PASSWORD`
   - Set a strong `N8N_ADMIN_PASSWORD`
   - Set `N8N_HOST=n8n.yourdomain.com` (your domain)
   - Set `N8N_WEBHOOK_BASE_URL=https://n8n.yourdomain.com`

3. **Start N8N:**
   ```bash
   cd ~/luminus
   docker compose up -d
   ```

4. **Point your domain** to the VPS IP, then set up a reverse proxy (nginx or Caddy) forwarding port 443 → 5678.

5. **Access N8N** at `https://n8n.yourdomain.com` and log in with your admin credentials.

6. **Copy the 3 Webhook URLs** (see Step 7) and paste them into your local `.env` file.

> **Testing locally without a VPS:**  
> You can use [n8n.cloud](https://n8n.cloud) free tier instead. Just paste the cloud webhook URLs into your `.env`.

---

## Step 5 — Test the PDF Extractor

Before running a real batch, test the Python extractor against your actual lead-vendor PDFs:

```bash
# Test a single PDF (pretty-printed output)
python extraction/extractor.py "path/to/your/lead.pdf" --pretty
```

**Example expected output:**
```json
{
  "source_pdf": "path/to/lead.pdf",
  "client": {
    "client_name": "John Smith",
    "client_email": "john@acme.com",
    "validation_flags": {},
    "needs_manual_check": false
  },
  "items": [
    {
      "page_number": 1,
      "sign_type": "3D Metal Back-lit",
      "size": "36in x 24in",
      "original_price": 962.0,
      "validation_flags": {},
      "needs_manual_check": false
    }
  ]
}
```

### If fields come out wrong or missing:

Open `extraction/extractor.py` and update the patterns in the **§REGEX PATTERNS** section (lines ~25–60):

| Field | Where to fix |
|---|---|
| Sign type not detected | Add your exact sign type names to `SIGN_TYPE_KEYWORDS` list |
| Price not found | Adjust `RE_PRICE` regex — check what format your PDFs use |
| Dimensions wrong | Adjust `RE_DIMENSION` regex |
| Client name missing | Look at `extract_client_info()` — add your template's label (e.g., `"Customer:"`, `"Prepared For:"`) |

> **Run against 15–20 real PDFs** before going live. Measure how often all fields extract correctly.

---

## Step 6 — Start the App and Test Batch Upload

```bash
npm run dev
```

This starts:
- **Frontend** at http://localhost:3000
- **Backend API** at http://localhost:3001

### Access the Batch Upload page:

Navigate to **http://localhost:3000/batch-upload**, or click the **Batch Upload** button in the top-right of the Proposal Editor.

### Test workflow:
1. Go to `/batch-upload`
2. Drag or click-to-select 1–50 client PDFs
3. Set a discount % if needed (or leave at 0)
4. Keep **Auto-generate AI mockups** checked if you want images created immediately, or uncheck it to generate later
5. Click **Start Extraction**
6. You are taken to `/batch-review/:batchId` where each PDF becomes one client card
7. Expand a client card, review extracted fields and pricing rows, and click **Open in Proposal Editor** to auto-fill the main proposal
8. In the Proposal Editor, review the loaded client data and click **Send Email** or **Create Payment** to trigger the configured N8N workflows
9. Back on `/batch-review`, select multiple clients and click **Send Selected to N8N** to generate PDFs and email them in bulk

---

## Step 7 — Configure N8N Workflows

You need 3 active N8N workflows. Each needs a **Webhook** trigger node to receive data from this system.

### Workflow 1: Email PDF to Client

| Node | Config |
|---|---|
| **Webhook** (trigger) | Method: POST, Path: `email-pdf`, respond: Immediately |
| **Code** | Convert `pdfBase64` → binary PDF attachment (see code below) |
| **Gmail / SMTP** | To: `{{ $json.clientEmail }}`, Subject: `Your Proposal`, Attachment: binary |

**Code Node (N8N JavaScript):**
```javascript
let item = $input.item.json;
if (item.body) item = { ...item, ...item.body };

const clientName = item.clientName || 'Client';
if (!item.pdfBase64) throw new Error("No PDF Data Received");

const binaryData = Buffer.from(item.pdfBase64, 'base64');
const fileName = `${clientName.replace(/[^a-z0-9]/gi, '_')}_Proposal.pdf`;

return {
  json: item,
  binary: {
    attachment: {
      data: item.pdfBase64,
      mimeType: 'application/pdf',
      fileName: fileName
    }
  }
};
```

### 4. Setup your N8N Webhooks
The codebase is fully integrated with N8N to handle the email delivery and Google Sheets logging.
**You must configure the webhooks in N8N to receive the payloads from this app.**

#### Email Webhook Setup:
1. Create a workflow in N8N with a **Webhook Trigger** node.
2. Set Method to `POST` and copy the **Test URL**.
3. In your `.env` file, paste the URL into `VITE_N8N_EMAIL_WEBHOOK` and `N8N_EMAIL_WEBHOOK`.
4. Connect an **Email Sender Node** (e.g., SMTP or Gmail) to the webhook.
5. In the email node, map the fields from the webhook payload:
   - To: `{{ $json.clientEmail }}`
   - Subject: Proposal from {{ $json.companyId }}
   - Attachment: The `pdfBase64` string must be converted back to a binary file using an N8N "Move Binary Data" node.

#### Google Sheets Webhook Setup:
1. Create another workflow in N8N with a **Webhook Trigger** node.
2. Set Method to `POST`.
3. In your `.env` file, paste the URL into `VITE_N8N_SHEETS_WEBHOOK`.
4. Connect a **Google Sheets Node** (Append Row).
5. Map the fields `name`, `price`, `size`, `signType` to your Google Sheet columns.

---

### 5. Email Deliverability (SPF/DKIM/DMARC) - CRITICAL
Since this system will automatically email clients, you must ensure your email domain is authenticated. If you skip this, your proposals will end up in the client's spam folder!

1. Check your email provider (Google Workspace, Office 365, etc.).
2. Go to your DNS provider (GoDaddy, Cloudflare, Namecheap).
3. Ensure you have the correct **SPF** TXT record (e.g., `v=spf1 include:_spf.google.com ~all`).
4. Ensure you have a **DKIM** key set up.
5. Setup a basic **DMARC** policy (e.g., `v=DMARC1; p=none; rua=mailto:admin@yourdomain.com`).
6. You can test your deliverability by sending a test email to **mail-tester.com**.

---

### 6. Run the Pilot Batch
Once your webhooks are set up and `.env` is configured:
1. Start your dev server: `npm run dev`
2. Go to `http://localhost:3000/batch-upload`
3. Upload **3 to 5 real sample PDFs** as a small pilot batch.
4. Verify the extraction accuracy and AI generation quality.
5. Go to the Batch Review dashboard, approve the clients, and hit **"Send Selected"**.
6. Check your email inbox to verify the final PDF looks correct and didn't go to spam!

---

You are now fully automated! 🚀

---

### Workflow 2: Log to Google Sheets

| Node | Config |
|---|---|
| **Webhook** (trigger) | Method: POST, Path: `sheets` |
| **Google Sheets** | Append row. Map: Name→`name`, Price→`price`, Size→`size`, Image→`image`, Time→`timestamp` |

> Copy the Production URL → `VITE_N8N_SHEETS_WEBHOOK` in `.env`

---

### Workflow 3: Payment Link Generation

| Node | Config |
|---|---|
| **Webhook** (trigger) | Method: POST, Path: `payment` |
| **Stripe** | Create payment link with `totalAmount`, `clientName`, `items` |
| **Respond to Webhook** | Return `{ paymentLink: "..." }` |

> Copy the Production URL → `VITE_N8N_PAYMENT_WEBHOOK` in `.env`

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│  Vue 3 Frontend (localhost:3000)                       │
│  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │ Proposal Editor  │  │  /batch-upload page       │   │
│  │ (existing)       │  │  • drag-drop 1-50 PDFs   │   │
│  └──────────────────┘  │  • discount %            │   │
│                        │  • extraction results    │   │
│                        │  • gen status polling    │   │
│                        └──────────────────────────┘   │
└──────────────────────┬─────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼─────────────────────────────────┐
│  Express Backend (localhost:3001)                      │
│  POST /api/batch/upload       ← multer + Python extractor │
│  POST /api/image-gen/process-batch/:id ← Replicate AI │
│  POST /api/image-gen/regenerate/:itemId ← manual      │
│  POST /api/send-email         ← N8N webhook            │
│  POST /api/send-to-sheets     ← N8N webhook            │
└────┬──────────────────────────────────────┬────────────┘
     │                                      │
┌────▼──────────┐                ┌──────────▼──────────┐
│  Supabase DB  │                │  Replicate API       │
│  • batches    │                │  Primary model       │
│  • clients    │                │  Fallback model      │
│  • items      │                └────────────────────── │
│  • Storage    │
│    import-pdfs│
│    import-images│
└───────────────┘
         │
┌────────▼──────┐
│  N8N          │
│  (self-hosted │
│  or cloud)    │
│  • Email PDF  │
│  • Sheets log │
│  • Payment    │
└───────────────┘
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/batch/upload` | Upload 1–50 PDFs. Form fields: `files[]`, `discount_percent` |
| `GET`  | `/api/batch/status/:batchId` | Get batch + client statuses |
| `GET`  | `/api/batch/client/:clientId` | Get single client + all items |
| `POST` | `/api/image-gen/process-batch/:batchId` | Start AI image generation for entire batch |
| `POST` | `/api/image-gen/regenerate/:itemId` | Manual regenerate one item with fallback model |
| `GET`  | `/api/image-gen/status/:batchId` | Poll generation progress |
| `POST` | `/api/send-email` | Send proposal PDF to client via N8N |
| `POST` | `/api/send-to-sheets` | Log proposal data to Google Sheets via N8N |

---

## Troubleshooting

### "No PDF Data Received" in N8N
- Make sure `N8N_EMAIL_WEBHOOK` (no VITE_ prefix) is set in your `.env`
- Make sure the N8N workflow is in **Active** (Production) mode, not test mode

### Python extractor returns empty fields
- Run `python extraction/extractor.py yourfile.pdf --pretty` and inspect raw output
- Add your template's field labels to `SIGN_TYPE_KEYWORDS` or `extract_client_info()` in `extraction/extractor.py`

### Replicate image generation times out
- Reduce `IMAGE_GEN_CONCURRENCY` from 5 to 3 in `.env`
- Check your Replicate account has API credits

### Supabase RLS errors (403 / permission denied)
- Make sure you're using `SUPABASE_SERVICE_ROLE_KEY` (not the anon key) in the backend `.env`
- The service role key bypasses RLS — it's designed for server-to-server calls

### Port 3001 already in use
```bash
# Kill the existing process
npx kill-port 3001
# Then restart
npm run dev
```

### Can't access /batch-upload
- Make sure you are logged in (the route requires auth)
- Try bypass mode: set `VITE_ADMIN_BYPASS_MODE=true` in `.env`
