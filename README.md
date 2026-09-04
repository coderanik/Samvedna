# Samvedna — listening beyond words

**Samvedna** (संवेदना) is an AI-assisted **Dynamic Mental Health Monitoring** platform for
**atrocity survivors and complainants** under the **SC/ST (Prevention of Atrocities) Act, 1989**,
reached via NHAA 14566, the Integrated Portal, chatbot, mobile, IVRS and helpline follow-ups.

> Support tool for authorised professionals — **not** an emergency service and **not** a clinical diagnosis.  
> **112** · **KIRAN 1800-599-0019** · **Tele-MANAS 14416** · **NHAA 14566**

Every capability is labelled **LIVE**, **ARCHITECTED**, or **ROADMAP**. Simulated NHAA/Exotel
connectors are never dressed as live government APIs.

---

## Table of contents

1. [What does this project do?](#what-does-this-project-do)
2. [What you need on your computer](#what-you-need-on-your-computer)
3. [Project folder structure (simple map)](#project-folder-structure-simple-map)
4. [Setup — follow these steps in order](#setup--follow-these-steps-in-order)
5. [Start the app every day](#start-the-app-every-day)
6. [Log in and try the demo](#log-in-and-try-the-demo)
7. [How each part of the app works](#how-each-part-of-the-app-works)
8. [All demo accounts](#all-demo-accounts)
9. [Useful commands](#useful-commands)
10. [Environment variables explained](#environment-variables-explained)
11. [Optional: phone calls with Exotel (India)](#optional-phone-calls-with-exotel-india)
12. [When something goes wrong (troubleshooting)](#when-something-goes-wrong-troubleshooting)
13. [How the code is organized (for curious readers)](#how-the-code-is-organized-for-curious-readers)

---

## What does this project do?

Think of Samvedna like a **digital check-in buddy** for people going through a court case:

| Who | What they do in the app |
|-----|-------------------------|
| **Victim** | Chats with “Mann-Mitra” (AI) in English, Hindi, or Tamil · can request a voice call |
| **Counsellor** | Sees assigned cases · gets alerts when distress is high · accepts phone calls |
| **Official** | Sees district dashboard and open alerts |
| **Admin** | Manages users and case assignments |

When a victim sends a check-in, the system:

1. Saves the message in the database (Supabase)
2. Sends it to the **AI service** (Google Gemini) to score distress (low → critical)
3. Creates an **alert** if the score is high or critical
4. Shows updates on dashboards in real time (Socket.io)

---

## What you need on your computer

Install these **once**. If you already have them, check the version.

| Tool | Minimum version | Why you need it | How to install |
|------|-----------------|-----------------|----------------|
| **Node.js** | 20 or newer | Runs the website and API | [nodejs.org](https://nodejs.org) — download the LTS installer |
| **pnpm** | 9.x | Installs project libraries (faster than npm) | After Node: `npm install -g pnpm` |
| **Python** | 3.9+ | Runs the AI scoring service | [python.org](https://www.python.org/downloads/) — tick “Add Python to PATH” on Windows |
| **Git** | any recent | To clone the project (optional if you already have the folder) | [git-scm.com](https://git-scm.com) |
| **A free Supabase account** | — | Cloud database + login | [supabase.com](https://supabase.com) — Sign up with email |
| **A Google Gemini API key** | — | Powers chatbot + distress scoring | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

**Check installs** — open Terminal (Mac/Linux) or Command Prompt / PowerShell (Windows) and run:

```bash
node -v          # should show v20.x or v22.x
pnpm -v          # should show 9.x
python3 --version   # should show 3.9 or higher
```

---

## Project folder structure (simple map)

```
SAMVEDNA/
├── apps/web/              ← The website you open in the browser (localhost:3000)
├── apps/api/              ← Backend server + real-time alerts (localhost:4000)
├── services/ml-service/   ← Python AI service (localhost:8001)
├── packages/shared-types/ ← Shared TypeScript types
├── supabase/migrations/   ← SQL files to create database tables
├── scripts/seed.ts        ← Creates demo users and sample data
├── .env.example           ← Template for secret keys (copy to .env)
└── package.json           ← Root commands like pnpm dev
```

When you run `pnpm dev`, **three programs start at once** — the website, the API, and the AI service. All three must be running for chat and scoring to work.

### Presentation / NHAA alignment

See [`docs/PRESENTATION.md`](docs/PRESENTATION.md) for the audit summary, LIVE vs ARCHITECTED honesty labels, and a 4-minute demo script.

**Apply DB upgrades** (Supabase → SQL Editor, in order):

1. `supabase/migrations/20260904000001_distress_intelligence.sql`
2. `supabase/migrations/20260905000001_samvedna_v2.sql` (outreach, score_contributions, POA catalog)
3. `supabase/migrations/20260905000003_victim_dashboard.sql` (instant calls, consultants, chat, exercises)

---

## Setup — follow these steps in order

Do not skip steps. If one step fails, fix it before moving on.

### Step 1 — Open the project folder

```bash
cd /path/to/SAMVEDNA
```

Replace `/path/to/SAMVEDNA` with wherever you saved the project (e.g. `~/Code/SAMVEDNA`).

### Step 2 — Install all libraries

```bash
pnpm install
pnpm --filter @samvedna/shared-types build
```

**What this does:** Downloads code libraries for the whole project. The second command builds shared types used by the website and API.

**Wait until it finishes** with no red error messages.

---

### Step 3 — Create a Supabase project (database + login)

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**.
3. Pick a name (e.g. `samvedna-dev`), set a **database password** (save it somewhere safe), choose a region close to you (e.g. Mumbai).
4. Wait until the project status shows **Active** (1–2 minutes).

**Copy these keys** (you will paste them into `.env` in Step 5):

1. In Supabase, open **Project Settings** (gear icon) → **API**.
2. Copy:
   - **Project URL** → this is your `SUPABASE_URL`
   - **Publishable key** (or **anon** key on older projects) → frontend key
   - **Secret key** (or **service_role** key) → backend key — **never share this publicly or put it in the website code**

---

### Step 4 — Create database tables (migrations)

The app needs tables like `profiles`, `cases`, `checkins`, etc. You create them by running SQL files in Supabase.

1. In Supabase, open **SQL Editor** (left sidebar).
2. Click **New query**.
3. Open this file on your computer in a text editor:

   `supabase/migrations/20240829000001_initial_schema.sql`

4. **Select all** the text, **copy** it, **paste** into the Supabase SQL Editor.
5. Click **Run** (or press Ctrl+Enter). You should see “Success”.
6. Repeat for the **next two files**, **in this order**:

   | Order | File |
   |-------|------|
   | 2 | `supabase/migrations/20240829000002_call_sessions.sql` |
   | 3 | `supabase/migrations/20240829000003_exotel_call_sid.sql` |

**Check migrations worked:**

```bash
pnpm migrate:check
```

You should see: `✓ call_sessions table exists — migration 002 is applied.`

If you see an error, go back and run the missing SQL file in Supabase SQL Editor.

---

### Step 5 — Create your `.env` files (secret keys)

Secrets live in `.env` files. **Never commit `.env` to GitHub** — it is already in `.gitignore`.

#### A) Root `.env` (main config)

```bash
cp .env.example .env
```

Open `.env` in any text editor and fill in:

```env
# ─── Supabase (from Step 3) ───
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SECRET_KEY=your-secret-key-here
SUPABASE_PUBLISHABLE_KEY=your-publishable-key-here

NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key-here

# ─── Local URLs (usually leave as-is) ───
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_ML_SERVICE_URL=http://localhost:8001

PORT=4000
ML_SERVICE_URL=http://localhost:8001
SOCKET_CORS_ORIGIN=http://localhost:3000
ML_PORT=8001

# ─── Google Gemini (get from aistudio.google.com/apikey) ───
GEMINI_API_KEY=your-gemini-api-key-here
```

> **Tip:** `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY` are the new Supabase names. Older projects use `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` — those names work too.

#### B) Website `.env.local`

The Next.js website reads its own env file:

```bash
cp .env.example apps/web/.env.local
```

Edit `apps/web/.env.local` — at minimum set:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key-here
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_ML_SERVICE_URL=http://localhost:8001
```

---

### Step 6 — Load demo users and sample data

```bash
pnpm seed
```

**What this does:** Creates demo logins (admin, counsellor, victims, etc.), sample court cases, check-ins, distress scores, and alerts.

You should see green checkmarks like `+ Created user: victim1@samvedna.demo`.  
If you run `pnpm seed` again later, it updates existing users instead of duplicating them.

---

### Step 7 — Start everything

**First time or if ports are busy:**

```bash
pnpm dev:clean
```

**Normal start:**

```bash
pnpm dev
```

Leave this terminal window **open**. When ready, you should see three services running:

| Service | URL | What it is |
|---------|-----|------------|
| **Web** | http://localhost:3000 | Open this in Chrome |
| **API** | http://localhost:4000 | Backend (you usually don’t open this) |
| **ML** | http://localhost:8001 | AI service |
| **Mobile (victim)** | Expo Go / simulator | `pnpm dev:mobile` — see `apps/mobile/README.md` |

**Quick health check** — in a **new** terminal tab:

```bash
curl http://localhost:4000/health
curl http://localhost:8001/health
```

Both should return JSON with `"status": "ok"` or similar.

---

## Start the app every day

Every time you want to work on Samvedna:

1. Open Terminal in the `SAMVEDNA` folder.
2. Run:

   ```bash
   pnpm dev:clean
   ```

   (Use `dev:clean` if you get “port already in use” errors.)

3. Open **Chrome** → http://localhost:3000
4. Log in with a demo account (see below).

To **stop** the app: go to the terminal where `pnpm dev` is running and press **Ctrl + C**.

---

## Log in and try the demo

1. Open http://localhost:3000
2. Click **Login**
3. Use any demo email from the table below
4. Password for **everyone**: `Samvedna@2024`

### Suggested first test (victim chat)

1. Log in as **victim4@samvedna.demo** (low distress — good for safe testing).
2. Go to **Check-in**.
3. Type a message like: *“I felt anxious about the court date but I’m coping.”*
4. Chat with Mann-Mitra, then click **“I'm done for now — save check-in”**.
5. Your message is scored and saved.

### Test a counsellor call (high distress)

1. Log in as **victim1@samvedna.demo** (latest score: **high**).
2. Go to **Call** → **Request counsellor call**.
3. In another browser window (or Incognito), log in as **counsellor1@samvedna.demo**.
4. Go to **Calls** → **Accept call**.
5. The victim screen updates to show the counsellor is ready.

### Test AI voice call (low distress)

1. Log in as **victim4@samvedna.demo**.
2. Go to **Call** → **Start AI voice call**.
3. Use **Chrome** (speech recognition works best there) and allow microphone access.

---

## How each part of the app works

### Victim pages

| Page | What happens |
|------|----------------|
| **Check-in** | Text chat with Mann-Mitra (Gemini). When you save, the API scores your messages. |
| **Call** | **High/critical** distress → counsellor call · **Low/moderate** → AI voice in the browser |
| **History** | Past check-ins and scores for your case |

### Counsellor pages

| Page | What happens |
|------|----------------|
| **Cases** | List of victims assigned to you · click a case for details |
| **Calls** | Incoming call requests · Accept · optional **Dial via Exotel** if phone integration is set up |

### Official pages

| Page | What happens |
|------|----------------|
| **Dashboard** | District-level stats |
| **Alerts** | Open high/critical alerts |

### Admin

| Page | What happens |
|------|----------------|
| **Administration** | User list · assign counsellors/officials to cases |

### How calls work (without Exotel)

| Distress level | Call type | Technology |
|----------------|-----------|------------|
| High / Critical | Counsellor | App notifies counsellor via Socket.io · `tel:` link to dial phone |
| Low / Moderate | AI voice | Browser **Web Speech API** (mic + speaker) + Gemini chat |

### How calls work (with Exotel — optional)

If you configure Exotel (see below), real phone IVRS and SMS check-ins also work, and counsellor calls can be **auto-bridged** between two phone numbers.

---

## All demo accounts

**Password for every account:** `Samvedna@2024`

| Role | Email | Try this |
|------|-------|----------|
| Admin | admin@samvedna.demo / **SamvednaAdmin@2024** | `/admin` — fixed credentials · user counts · add counsellors · assign cases |
| Official | official@samvedna.demo | District dashboard + alerts |
| Counsellor | counsellor1@samvedna.demo | Cases + Calls for victim1 & victim3 |
| Counsellor | counsellor2@samvedna.demo | Cases for victim2 & victim4 |
| Victim (high distress) | victim1@samvedna.demo | **Call** → counsellor routing |
| Victim (moderate) | victim2@samvedna.demo | Chat check-in · AI voice call |
| Victim (critical) | victim3@samvedna.demo | **Call** → counsellor routing |
| Victim (low) | victim4@samvedna.demo | Chat · **AI voice call** |

**Call routing rule:** high or critical → **counsellor** · low or moderate → **AI voice**

---

## Useful commands

Run all commands from the `SAMVEDNA` folder.

| Command | What it does |
|---------|----------------|
| `pnpm install` | Install / update libraries |
| `pnpm --filter @samvedna/shared-types build` | Build shared types (after install) |
| `pnpm seed` | Create or refresh demo data |
| `pnpm ensure-admin` | Create/reset the fixed admin login |
| `pnpm migrate:check` | Check if database migrations are applied |
| `pnpm dev` | Start web + API + ML together |
| `pnpm dev:clean` | Kill ports 3000–3002/4000/8001, then start fresh |
| `pnpm dev:web` | Start only the website (port 3000) |
| `pnpm dev:counselor` | Counsellor dashboard on **:3001** (`/counselor/cases`) |
| `pnpm dev:admin` | Admin dashboard on **:3002** (`/admin`) |
| `pnpm dev:api` | Start only the API |
| `pnpm dev:ml` | Start only the ML service |
| `pnpm build` | Build for production |

---

## Environment variables explained

| Variable | Plain English |
|----------|---------------|
| `SUPABASE_URL` | Address of your Supabase database project |
| `SUPABASE_SECRET_KEY` | Master backend key — **server only**, never in browser |
| `SUPABASE_PUBLISHABLE_KEY` | Safe public key used by the login page |
| `GEMINI_API_KEY` | Google AI key for chat + distress scoring |
| `NEXT_PUBLIC_API_URL` | Where the website finds the backend (local: port 4000) |
| `NEXT_PUBLIC_SOCKET_URL` | Real-time alerts connection (same as API locally) |
| `EXOTEL_*` | Optional phone/SMS keys (India telephony) |
| `TWILIO_*` | Optional Conversational Voice for victim instant agent calls |

Full template: see `.env.example`.

---

## Optional: phone calls with Exotel (India)

**Exotel** is recommended for India (IVRS, SMS, toll-free numbers). **Twilio** works globally but needs extra setup for Indian SMS rules (DLT).

You can run the full app **without Exotel** — chat and browser voice calls still work.

### When you are ready for Exotel

1. Create an account at [exotel.com](https://exotel.com).
2. Get **API Key**, **API Token**, **Account SID**, and an **ExoPhone** number.
3. Add to `.env`:

   ```env
   EXOTEL_API_KEY=...
   EXOTEL_API_TOKEN=...
   EXOTEL_SID=...
   EXOTEL_CALLER_ID=080XXXXXXXX
   EXOTEL_WEBHOOK_BASE_URL=https://YOUR-PUBLIC-URL
   ```

4. Exotel must reach your API from the internet. For local development, use [ngrok](https://ngrok.com):

   ```bash
   ngrok http 4000
   ```

   Copy the `https://....ngrok.io` URL into `EXOTEL_WEBHOOK_BASE_URL`.

5. See webhook URLs to configure in Exotel:

   ```bash
   curl http://localhost:4000/webhooks/exotel/config
   ```

6. In **Exotel App Bazaar**, create an inbound flow with a **URL applet** pointing to:

   `https://YOUR-PUBLIC-URL/webhooks/exotel/exoml/inbound`

---

## Optional: Twilio Conversational Voice (victim instant agent)

Powers **Talk to an Agent Now** on the victim dashboard — outbound phone call with Mann-Mitra speech gather loop, transcript → summary → distress scoring.

1. Create a Twilio account and note **Account SID**, **Auth Token**, and a **Voice-capable From number**.
2. Add to root `.env`:

   ```env
   TWILIO_ACCOUNT_SID=ACxxxx
   TWILIO_AUTH_TOKEN=xxxx
   TWILIO_FROM_NUMBER=+1xxxxxxxxxx
   TWILIO_WEBHOOK_BASE_URL=https://YOUR-PUBLIC-URL
   ```

3. Expose the API publicly (Twilio cannot call `localhost`):

   ```bash
   ngrok http 4000
   ```

   Put the `https://….ngrok-free.app` URL in `TWILIO_WEBHOOK_BASE_URL` (no trailing slash).

4. Confirm setup:

   ```bash
   curl http://localhost:4000/webhooks/twilio/config
   ```

5. Ensure the victim profile has a real `phone_number` (E.164 / Indian mobile). Dashboard uses `mode=auto` → Twilio when LIVE.

6. Optional inbound: Twilio Console → Phone Number → Voice webhook →  
   `POST https://YOUR-PUBLIC-URL/webhooks/twilio/voice`

For local signature quirks only: `TWILIO_SKIP_SIGNATURE_VALIDATION=true` (never in production).

Without Twilio, the dashboard still uses **LIVE** in-browser Mann-Mitra voice.

---

## When something goes wrong (troubleshooting)

### “Cannot start check-in yet / No case linked”

- Use a **seeded** victim account (`victim1@samvedna.demo`, etc.).
- Run `pnpm seed` again if you skipped it.

### Chat replies fail or scoring doesn’t work

- Check **all three** services are running (`pnpm dev`).
- Check `GEMINI_API_KEY` in `.env`.
- Test ML service: `curl http://localhost:8001/health`

### Login fails / “Invalid API key”

- Check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `apps/web/.env.local`.
- Keys must match your Supabase project (Settings → API).

### `pnpm seed` fails

- Check `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in root `.env`.
- Make sure you ran **migration 001** in Supabase SQL Editor first.

### Port already in use (EADDRINUSE)

```bash
pnpm dev:clean
```

Or manually kill processes on ports 3000, 4000, 8001.

### `pnpm migrate:check` fails

- Open Supabase **SQL Editor** and run the migration files listed in [Step 4](#step-4--create-database-tables-migrations).

### AI voice call: “Speech recognition not supported”

- Use **Google Chrome**.
- Allow microphone permission for localhost.
- Safari/Firefox have limited Web Speech support.

### Counsellor call: no phone bridge

- Without Exotel, use the **Call now** `tel:` button (needs phone numbers in seeded profiles).
- With Exotel, both victim and counsellor need `phone_number` in their profile and Exotel env vars set.

### Python / ML service won’t start

```bash
cd services/ml-service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload --port 8001
```

On Windows, use `.venv\Scripts\pip` and `.venv\Scripts\uvicorn` instead.

---

## How the code is organized (for curious readers)

```
┌─────────────────┐     HTTP      ┌─────────────────┐     HTTP      ┌─────────────────┐
│  apps/web       │ ────────────► │  apps/api       │ ────────────► │  ml-service     │
│  Next.js 14     │               │  Express        │               │  FastAPI        │
│  React + Tailwind│ ◄─────────── │  Socket.io      │               │  Google Gemini  │
└────────┬────────┘   WebSocket   └────────┬────────┘               └─────────────────┘
         │                                  │
         │         Supabase Auth            │  Service role
         └──────────────────────────────────┴──────────►  Supabase Postgres (RLS)
```

| Folder | Technology |
|--------|------------|
| `apps/web` | Next.js 14, TypeScript, Tailwind, Supabase Auth |
| `apps/api` | Express, Socket.io, JWT auth, Zod validation |
| `services/ml-service` | Python FastAPI, Gemini (`/score`, `/chat`, `/explain`) |
| `packages/shared-types` | Shared TypeScript types |
| `supabase/migrations` | PostgreSQL schema + Row Level Security |

---

## Crisis helpline (real world)

Samvedna does **not** replace professional emergency care.

- **KIRAN Mental Health Helpline:** 1800-599-0019 (24×7, India)
- **Emergency:** 112

---

*Listening beyond words · शब्दों से परे*
