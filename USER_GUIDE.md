# Luminus Proposal System - User Guide

This guide covers the complete setup, configuration, and deployment of the Luminus Proposal System.

## 1. Local Setup

### Prerequisites
- Node.js (v18 or higher)
- NPM (v9 or higher)

### Installation
1.  **Clone the repository** (if you haven't already).
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Environment Setup**:
    - Copy `.env.example` to `.env`:
        ```bash
        cp .env.example .env
        ```
    - Fill in the required variables (see [Configuration](#configuration) below).

### Running Locally
To run both the Frontend (Vite) and Backend (Node Server) concurrently:
```bash
npm run dev
```
- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001

---

## 2. Configuration (.env)

These are the key environment variables you need to configure in your `.env` file (or Vercel Environment Variables).

| Variable | Description |
| :--- | :--- |
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase Anonymous Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase secret (bypasses RLS). Never prefix with `VITE_` — that would ship it to the browser. Used by `db.js` for Saved Leads. |
| `VITE_ADMIN_BYPASS_MODE` | Set to `true` to bypass login (for development/demo) |
| `VITE_N8N_EMAIL_WEBHOOK` | URL for N8N Email Workflow (Must be Active) |
| `VITE_N8N_PAYMENT_WEBHOOK` | URL for N8N Payment Workflow |
| `CRM_API_TOKEN` | Personal access token for the CRM the lead-import script pulls from. Server-only, local dev only — see section 6. |
| `MIGRATION_SCRIPT_DIR` | Local filesystem path to the lead-import script. Local dev only. |

---

## 3. Supabase Setup (Database & Auth)

The system uses Supabase to handle User Login and Sign Up securely.

### Step 1: Create Project & Get Keys
1.  Go to [supabase.com](https://supabase.com) and create a **New Project**.
2.  Wait for the database to provision.
3.  Go to **Project Settings** (Cog icon) -> **API**.
4.  Copy the **Project URL** and paste it into `.env` as `VITE_SUPABASE_URL`.
5.  Copy the **anon public** key and paste it into `.env` as `VITE_SUPABASE_ANON_KEY`.

### Step 2: Configure Authentication
1.  In Supabase, go to **Authentication** (Users icon) -> **Providers**.
2.  Ensure **Email** is **Enabled**.
3.  (Optional) Disable "Confirm email" if you want users to log in instantly without verifying their email first.
    *   Go to **Authentication** -> **URL Configuration**.
    *   Set **Site URL** to your deployed URL (e.g., `https://your-project.vercel.app`).
    *   If testing locally, add `http://localhost:3000` to **Redirect URLs**.

### Step 3: Run Database SQL (Required for Profiles)
To store user data (like their name) and handle security, you must run this SQL script.

1.  In Supabase, go to the **SQL Editor** (Terminal icon).
2.  Click **New Query**.
3.  **Paste and Run** the following code:

```sql
-- 1. Create a table for public profiles
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  full_name text,
  avatar_url text,
  updated_at timestamp with time zone
);

-- 2. Turn on Security (Row Level Security)
alter table public.profiles enable row level security;

-- 3. Create Policies (Who can do what?)
-- Anyone can view profiles (needed for sharing)
create policy "Public profiles are viewable by everyone." 
  on profiles for select using (true);

-- Users can insert their own profile
create policy "Users can insert their own profile." 
  on profiles for insert with check (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile." 
  on profiles for update using (auth.uid() = id);

-- 4. Create a Trigger (Auto-create profile on signup)
-- This function runs automatically whenever a new user signs up
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id, 
    new.email, 
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$ language plpgsql security definer;

-- Attach the trigger
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 5. Create Storage Bucket (for images)
insert into storage.buckets (id, name, public) 
values ('proposal-assets', 'proposal-assets', true)
on conflict (id) do nothing;

create policy "Public Access" 
  on storage.objects for select using ( bucket_id = 'proposal-assets' );

create policy "Authenticated Users can Upload" 
  on storage.objects for insert 
  with check ( bucket_id = 'proposal-assets' and auth.role() = 'authenticated' );
```

### Step 4: Verify Setup
1.  Set `VITE_ADMIN_BYPASS_MODE=false` in your `.env`.
2.  Restart your app (`npm run dev`).
3.  Go to the login screen.
4.  Try to **Sign Up** with a real email and password.
5.  If successful, check your Supabase **Table Editor**:
    *   You should see a new row in the `profiles` table.

---

## 4. Automation Workflows (N8N or Activepieces)

The system relies on external automation tools (N8N or Activepieces) for sending emails to avoid complex backend SMTP setup.

### Option A: Activepieces Workflow Setup (Recommended for beginners)
1. **Create a new Flow** in Activepieces.
2. **Add a Catch Webhook Trigger**:
    - Choose the **Webhook** app and "Catch Webhook" trigger.
    - Copy the generated Webhook URL and paste it into `.env` as `VITE_ACTIVEPIECES_EMAIL_WEBHOOK`.
    - Click "Test Trigger" and send a dummy email request from your app, or just wait for the first real request.
3. **Add a Code Step**:
    - Choose the **Code** app to process the PDF data.
    - Setup the Input properties: Create a property called `pdfBase64` and map it to `Trigger > Body > pdfBase64`.
    - Setup the Input properties: Create a property called `clientName` and map it to `Trigger > Body > clientName`.
    - **Use this code to convert Base64 to a file buffer**:
      ```javascript
      export const code = async (inputs) => {
        const base64Data = inputs.pdfBase64;
        const name = inputs.clientName || 'Client';
        const buffer = Buffer.from(base64Data, 'base64');
        return {
          fileName: `${name.replace(/[^a-zA-Z0-9]/g, '_')}_Proposal.pdf`,
          fileBuffer: buffer
        };
      };
      ```
4. **Add an Email Step**:
    - Choose **Send Email** (using their default SMTP server, or use Gmail/SMTP).
    - **To**: Map this to `Trigger > Body > clientEmail`.
    - **Subject**: "Your Proposal"
    - **Body**: Write your desired email text.
    - **Attachment**: Map this directly to the output of the Code step. Activepieces handles buffers natively for attachments.
5. **Publish**: Click Publish and your flow is active!

### Option B: N8N Workflow Setup
1.  **Create a new Workflow** in N8N.
2.  **Add a Webhook Node**:
    - Method: `POST`
    - Path: `webhook-pdf-proposal`
    - Authentication: None
3.  **Add a Code Node**:
    - This converts the incoming Base64 data back into a PDF file.
    - **Use this code to safely handle missing data**:
      ```javascript
      // Smart Code to handle data paths
      let item = items[0].json;
      if (item.body) item = { ...item, ...item.body }; 

      const clientName = item.clientName || 'Client';
      
      // Check for PDF data
      if (!item.pdfBase64) {
          throw new Error("No PDF Data Received");
      }

      const binaryData = Buffer.from(item.pdfBase64, 'base64');
      const fileName = `${clientName.replace(/[^a-z0-9]/gi, '_')}_Proposal.pdf`;

      return [{
        json: item,
        binary: {
          data: {
            data: binaryData.toString('base64'),
            mimeType: 'application/pdf',
            fileName: fileName
          }
        }
      }];
      ```
4.  **Add an Email (SMTP) Node**:
    - Connect the Code Node to this.
    - **To Email**: Expression `{{ $json.clientEmail }}`
    - **Attachments**: Toggle "Binary Data" **ON**.
    - **Property Name**: Type in `data` (all lowercase).
5.  **Activate Workflow**:
    - Save the workflow.
    - Toggle **Active** (Top Right) to ON.
    - Copy the **Production URL** and paste it into `VITE_N8N_EMAIL_WEBHOOK`.

---

## 5. CRM Lead Import & Saved Leads

Two related features live in the editor sidebar, next to Import: **Fetch** (cyan) and **Leads** (slate), plus **Save** (green).

### Fetch — pull a lead straight from the CRM, no terminal

1. Click **Fetch** to open the panel.
2. **By Name**: paste one client name (or company name, or CRM record ID) per line, then click **Fetch**. Multiple names fetch as a batch.
3. **By Date**: pick a date — every lead created that calendar day (UTC) gets fetched.
4. Watch the live progress list — each client shows pending → processing → done/failed, with a reason shown inline if one fails. A red **Stop** button cancels immediately; nothing already fetched is lost, and no further calls happen once stopped.
5. As each client finishes, it's automatically saved (see below) and added to the **Clients** list for review — click any name to load it into the editor.

**This only works from the local dev server** (`npm run dev`), never on the deployed Vercel site — it spawns a Python script on your own machine to read the CRM's PDF proposals, which Vercel's serverless functions can't do (no persistent filesystem, no guaranteed Python runtime, and the connection needs to stay open far longer than serverless functions allow). Fetch locally; everything after that works everywhere.

### Save — persist the current proposal

Click the green **Save** button any time to save whatever's currently in the editor. A few things happen automatically:
- Every fetch **auto-saves** the moment it completes — you never have to remember to click Save just to keep what you fetched.
- Editing a proposal (price, sign type, images, anything) and clicking **Save** creates a **new version** — nothing is overwritten. All previous versions stay retrievable.

### Leads — recall or edit anything you've ever saved, no CRM call needed

Click the slate **Leads** button to open **Saved Leads** — every client ever fetched or saved, listed with name, email, and last-updated time.

- **Click a name** to load its latest version into the editor instantly — this reads from the database only, so it costs nothing and never touches the CRM or any AI API.
- **Click the clock icon** (shown when a client has more than one version) to expand its full version history — each entry shows what it was (e.g. "Imported from CRM" or "Saved from editor") and when. Click any version to load exactly that one back into the editor — including restoring an old version after a bad edit (restoring creates a new version too, so you can always undo the undo).
- **Trash icon** deletes a lead and all its versions permanently — this cannot be undone, and a confirmation dialog protects against accidental clicks.

**This works both locally and on the deployed Vercel site** — Saved Leads is backed by Supabase (a shared cloud database), not anything tied to your local machine. Fetch a lead locally today, then open the live site tomorrow and it's right there in Leads, ready to review, edit, and re-save.

### One-time setup this feature needs

1. In Supabase's SQL Editor, run `supabase/migrations/004_add_leads_tables.sql` (after 001-003, if you haven't already).
2. Add `SUPABASE_SERVICE_ROLE_KEY` to your local `.env` **and** to Vercel's Environment Variables (Project Settings → Environment Variables) — this is different from the `anon` key already there, and must never be prefixed with `VITE_`.
3. For Fetch specifically (local-only): add `CRM_API_TOKEN` and `MIGRATION_SCRIPT_DIR` to your local `.env` only — these have no reason to exist on Vercel since Fetch can't run there anyway.

---

## 6. Vercel Deployment

Deploying this app to Vercel is easy because we have included Serverless Functions in the `api/` folder.

1.  **Push to GitHub**: Ensure your code is in a GitHub repository.
2.  **Import to Vercel**:
    - Go to [vercel.com/new](https://vercel.com/new).
    - Select your repository.
3.  **Configure Project**:
    - **Framework Preset**: Vite
    - **Root Directory**: `./` (default)
    - **Build Command**: `vite build` (or `npm run build`)
    - **Output Directory**: `dist`
4.  **Environment Variables**:
    - Copy all your local `.env` values into the Vercel "Environment Variables" section.
    - **CRITICAL**: Ensure `VITE_N8N_EMAIL_WEBHOOK` is set to your **Active** N8N Production URL.
    - **CRITICAL for Saved Leads**: Add `SUPABASE_SERVICE_ROLE_KEY` here too (see section 5) — without it, `api/leads.js` can't read or write the database and Saved Leads will fail on the live site even though it works locally. Do **not** add `CRM_API_TOKEN` or `MIGRATION_SCRIPT_DIR` to Vercel — Fetch only runs locally, so those would do nothing there.
5.  **Deploy**: Click Deploy.

### How it works on Vercel
- The Frontend is served as static files from `dist/`.
- The API endpoints (like `/api/send-email`) are automatically handled by Vercel Serverless Functions located in the `api/` directory.
- This means you **do not** need to run `server.js` on Vercel; the `api/` folder replaces it.
