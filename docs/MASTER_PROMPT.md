# SAMVEDNA — Master Build Prompt

> Paste everything below the line into a fresh Claude Code / Cursor agent session with the
> repository open at `/Users/anik/Code/SAMVEDNA`. It is self-contained: the agent should not
> need to re-explore the codebase before starting.

---

You are working on **SAMVEDNA**, a Smart India Hackathon submission for the Ministry of Social
Justice & Empowerment problem statement: *"AI-based Dynamic Mental Health Monitoring and Distress
Prediction System"* for victims and complainants registered through **NHAA (National Helpline
Against Atrocities, 14566)** and the Integrated Portal, under the **Scheduled Castes and Scheduled
Tribes (Prevention of Atrocities) Act, 1989**.

You have **7–8 hours**. The build is phased. Complete phases in order. Every phase must leave the
demo in a working state — never break a working feature to start a new one.

---

## 0. CURRENT STATE OF THE REPOSITORY

Read this instead of exploring. Verify only when a specific detail matters.

### Monorepo

pnpm workspaces (`pnpm@9.15.4`, Node ≥20). No Turborepo. Orchestrated with `concurrently`.

```
apps/web        @samvedna/web        Next.js 14.2.22 App Router, React 18.3.1, Tailwind 3.4.17
apps/api        @samvedna/api        Express 4.21.2 + Socket.io 4.8.1, Zod, Helmet
apps/mobile     @samvedna/mobile     Expo SDK 57, RN 0.86.3, expo-router
services/ml-service                  Python FastAPI + uvicorn + google-genai (Gemini)
packages/shared-types                Shared TypeScript types
supabase/migrations                  4 SQL migrations
scripts/                             seed.ts, ensure-admin.ts, clear-seed.ts, migrate-check.ts
docs/                                01-architecture.md, PRESENTATION.md
```

Dev ports: web `3000`, counsellor web `3001`, admin web `3002`, API `4000`, ML `8001`, Expo `8081`.
Demo password `Samvedna@2024`; admin `admin@samvedna.demo` / `SamvednaAdmin@2024`.
No Docker, no CI, no deployment config.

### Database (Supabase Postgres, all migrations applied)

Tables: `profiles`, `cases`, `checkins`, `distress_scores`, `alerts`, `support_recommendations`,
`case_timeline_events`, `intervention_notes`, `onboarding_tokens`, `call_sessions`.

Key columns:
- `profiles(id→auth.users, role, full_name, preferred_language, phone_number, created_at)`
- `cases(id, victim_id, case_number UNIQUE, case_type, status, assigned_counsellor_id,
  assigned_official_id, district NOT NULL, state NOT NULL, created_at)`
- `checkins(id, case_id, victim_id, channel, raw_transcript, created_at)`
- `distress_scores(id, checkin_id UNIQUE, case_id, score 0–100, risk_level, reasoning,
  signals_detected jsonb, trend_direction, escalation_risk_7d, escalation_reasoning,
  recommended_interventions jsonb, sentiment, emotion_indicators jsonb,
  contributing_factors jsonb, model_confidence, prediction_method, created_at)`
- `alerts(id, case_id, distress_score_id, severity, status, assigned_to, created_at, resolved_at)`
- `support_recommendations(id, case_id, alert_id, type, description, status, created_at)`
- `call_sessions(id, case_id, victim_id, counsellor_id, call_type, status, risk_level_at_call,
  distress_score_at_call, transcript, duration_seconds, exotel_call_sid, timestamps)`

Enums:
- `user_role`: victim | counsellor | official | admin
- `case_status`: investigation | trial | rehabilitation | closed | complaint_registration |
  compensation | protection_followup
- `checkin_channel`: chat | ivrs | sms | app | ai_voice | portal | chatbot | nhaa_14566 | helpline
- `risk_level`: low | moderate | high | critical
- `alert_status`: open | acknowledged | resolved
- `support_type`: counselling | medical | legal | financial | protection | rehabilitation |
  relocation | witness_protection | follow_up
- `support_status`: suggested | in_progress | completed
- `call_type`: counsellor | ai_voice
- `call_status`: requested | ringing | in_progress | completed | missed | cancelled

Triggers/functions: `handle_new_user()` (auto-creates profile on `auth.users` insert),
`get_my_role()` (RLS helper). RLS is enabled with policies on every table, **but the API uses the
Supabase service-role key for all queries, so RLS is bypassed in practice.** Authorization is
enforced at the application layer.

Risk bands used everywhere: `low 0–30, moderate 31–55, high 56–75, critical 76–100`.

### API (`apps/api/src`)

Entry `index.ts` mounts: `/health`, `/checkins`, `/chat`, `/calls`, `/cases`, `/alerts`,
`/dashboard`, `/webhooks`, `/admin`, `/intake`.

Auth: `middleware/auth.ts` — Bearer JWT validated via `supabaseAdmin.auth.getUser(token)`, role
loaded from `profiles`. `requireAuth` and `requireRole(...roles)`.

Socket.io: client emits `join_user_room(userId)`, `join_case_room({case_id})`; server emits
`new_alert`, `incoming_call`, `call_accepted`.

`lib/`:
- `supabase.ts` — service-role client `supabaseAdmin`; unused `createUserClient(jwt)`
- `ml-client.ts` — `POST {ML_SERVICE_URL}/score`, 25s timeout, `localFallback()` rules scorer
- `scoring-pipeline.ts` — `createCheckinAndScore()`: insert check-in → score → merge with local
  intelligence → insert `distress_scores` → insert up to 4 `support_recommendations` → maybe
  create alerts (dedup: 1h window per assignee) → insert timeline event
- `distress-intelligence.ts` — `riskFromScore()`, trend (delta ±8), escalation formula, priority
  formula, `defaultInterventions()`
- `call-routing.ts`, `exotel.ts`, `exoml.ts`, `exotel-bridge.ts`, `phone.ts`, `errors.ts`

Existing escalation formula (`distress-intelligence.ts`):
```
RISK_WEIGHT = { low: 0, moderate: 15, high: 35, critical: 50 }
escalation = RISK_WEIGHT[risk] + round(score * 0.35)
           + (trend rising      ? +18 : 0)
           + (score_delta >= 15 ? +12 : 0)
           + (consecutive_elevated >= 2 ? 10 * min(n,4) : 0)
           + (high_risk_count >= 3 ? +8 : 0)
           + (threat signals ? 8 * min(count,3) : 0)
           - (improving && !critical ? 12 : 0)
clamp 0..100
```

Alert trigger: `risk_level in (high, critical) || escalation_risk_7d >= 70`.

`/dashboard/summary?scope=district|state|national&state=&district=` and
`/dashboard/priority-queue` both exist. `POST /intake/nhaa` is a simulated NHAA connector.

### ML service (`services/ml-service/main.py`)

FastAPI, single module, ~390 lines. Endpoints:
- `GET /health`
- `POST /score` → Gemini (`gemini-2.0-flash`, JSON mode) with `_fallback_score()` keyword rules
- `POST /explain` → **pure reformatting of the score output, no second model call**
- `POST /chat` → "Mann-Mitra" companion bot

`requirements.txt`: fastapi, uvicorn[standard], google-genai, pydantic, python-dotenv.

### Web (`apps/web/src`)

Routes: `/`, `/login`, `/signup`, `/onboard/[token]`, `/auth/callback`, `/victim/checkin`,
`/victim/call`, `/victim/history`, `/counselor/cases`, `/counselor/cases/[id]`,
`/counselor/calls`, `/official/dashboard`, `/official/alerts`, `/admin`.

Components: `app-shell`, `ai-voice-call` (Web Speech API STT+TTS), `alert-toast`, `crisis-notice`,
`risk-badge`, `incoming-call-panel`, `incoming-call-toast` (dead code), and `ui/{button,card,input,label}`.

Auth via `@supabase/ssr`. API calls via `apiFetch<T>()` in `lib/utils.ts`. Realtime via
`lib/socket.ts`. No global state store — every page is `"use client"` with local `useState`.

Current tokens in `globals.css`: `--background: 30 25% 98%`, `--primary: 262 52% 47%` (purple),
`--accent: 160 40% 42%` (teal), `--radius: 0.75rem`. `darkMode: ["class"]` configured but no dark
theme vars exist. Landing page uses a *different* teal palette outside the token system.

Installed but unused: `next-intl`, most Radix packages (`dialog`, `toast`, `tabs`, `select`,
`dropdown-menu`, `avatar`), `NEXT_PUBLIC_ML_SERVICE_URL`.

### Known defects to fix along the way

1. `GET /alerts/` does not filter for `victim` role → a victim sees all alerts. **Security bug.**
2. `PATCH /cases/:id/support/:supportId` has no role or assignment check. **Authorization gap.**
3. Exotel webhooks have no signature verification.
4. `lookupVictimByPhone` loads all victim profiles and filters in JS.
5. `POST /intake/nhaa` calls `listUsers({perPage: 200})` — misses users beyond 200.
6. `support_recommendations` are re-inserted on every check-in with no dedup.
7. `POST /chat` proxy has no timeout and no fallback.
8. Tamil typo in `crisis-notice.tsx`: `அavசர` should be `அவசர`.
9. Hardcoded admin credentials visible in `login/page.tsx` source.
10. Two conflicting visual languages (teal landing vs purple app).

---

## 1. NON-NEGOTIABLE CONSTRAINTS

**Trauma-informed victim UX.** The victim **must never see** their distress score, risk level, the
word "critical", or the colour red. Being shown "your distress is 78/100 — CRITICAL" is clinically
harmful and a judging panel with any clinical member will penalise it. Assessment is invisible to
the person being assessed. The victim sees warmth, agency, and care — nothing else.

**Radical honesty in labelling.** Every screen that shows an AI output must be honest about what it
is. Use three explicit tiers throughout the UI and docs:
- `LIVE` — running in this build
- `ARCHITECTED` — API contract and data model exist, integration is simulated
- `ROADMAP` — designed, not built

Never present a simulated NHAA connector as a live government integration. Judges reward candour
and punish overclaiming. Keep the existing `"honesty"` field pattern in `POST /intake/nhaa`.

**Never break the demo.** Every new scoring path must degrade gracefully. If the voice extractor,
Gemini, or the forecast model fails, the system must still produce a score and never mark someone
safe by default. The existing `localFallback()` convention — flag for review, `model_confidence:
"fallback"` — is correct; extend it, don't remove it.

**Clinical safety.** Any C-SSRS positive, any explicit self-harm or suicide statement, and any
active threat-to-life disclosure must bypass all scoring logic and trigger an immediate critical
alert plus on-screen crisis resources (KIRAN 1800-599-0019, Tele-MANAS 14416, emergency 112,
NHAA 14566). Never let an LLM decide whether a suicide disclosure is urgent.

**Terminology.** Purge "crime victim" from the entire codebase, README, and UI. Use **"atrocity
survivor"**, **"POA Act beneficiary"**, **"complainant"**, or **"protected witness"**. Reference
the Act by name. This is explicitly in the problem statement's priority use cases and is free marks.

---

## 2. PHASE 0 — FOUNDATIONS (target: 45 min)

### 2.1 Database migration

Create `supabase/migrations/20260905000001_samvedna_v2.sql`. Additive only — never drop or alter
existing columns. Use `IF NOT EXISTS` throughout so it is safe to re-run.

New enums:
```sql
CREATE TYPE outreach_channel AS ENUM ('chat','ivrs','sms','app_push','whatsapp','helpline_callback');
CREATE TYPE outreach_status  AS ENUM ('scheduled','sent','responded','missed','cancelled');
CREATE TYPE instrument_type  AS ENUM ('phq2','phq9','gad2','gad7','pcptsd5','pcl5','cssrs','who5');
CREATE TYPE consent_scope    AS ENUM ('voice_recording','transcript_storage','llm_processing',
                                      'family_contact','data_sharing_district','research_anonymised');
```

New tables:

- **`outreach_schedule`** — `id, case_id, scheduled_for timestamptz, channel outreach_channel,
  status outreach_status DEFAULT 'scheduled', reason text, generated_by text
  ('cadence'|'event'|'manual'|'escalation'), attempt_count int DEFAULT 0, responded_at timestamptz,
  checkin_id uuid NULL REFERENCES checkins(id), created_at`.
  Index on `(status, scheduled_for)` and `(case_id, scheduled_for DESC)`.

- **`engagement_metrics`** — one row per check-in.
  `id, case_id, checkin_id UNIQUE, response_latency_seconds int, message_char_count int,
  message_word_count int, session_duration_seconds int, turns_in_session int,
  abandoned boolean, hour_of_day int, day_of_week int, days_since_last_checkin numeric,
  missed_outreach_count_30d int, engagement_score int CHECK 0..100, created_at`.

- **`clinical_assessments`** — `id, case_id, checkin_id, instrument instrument_type,
  raw_responses jsonb, total_score int, severity_band text, positive_screen boolean,
  administered_via text, created_at`. Index `(case_id, created_at DESC)`.

- **`voice_analyses`** — `id, case_id, checkin_id, call_session_id,
  duration_seconds numeric, f0_mean numeric, f0_std numeric, f0_range numeric,
  jitter_local numeric, shimmer_local numeric, hnr_db numeric, speech_rate numeric,
  articulation_rate numeric, pause_ratio numeric, mean_pause_duration numeric,
  intensity_mean numeric, intensity_std numeric, spectral_centroid_mean numeric,
  vocal_stress_index int CHECK 0..100, baseline_deviation numeric, confidence text,
  features_raw jsonb, created_at`.

- **`voice_baselines`** — per-victim calm baseline for the deviation calculation.
  `victim_id PK REFERENCES profiles(id), sample_count int, f0_mean numeric, f0_std numeric,
  jitter_mean numeric, shimmer_mean numeric, hnr_mean numeric, speech_rate_mean numeric,
  updated_at`.

- **`score_contributions`** — the XAI backbone. One row per contributing channel per score.
  `id, distress_score_id REFERENCES distress_scores(id) ON DELETE CASCADE, channel text
  ('clinical'|'text_sentiment'|'vocal_stress'|'behavioural'|'case_context'),
  feature text, feature_label text, raw_value numeric, weight numeric, contribution numeric,
  direction text ('increases'|'decreases'), evidence text, created_at`.
  Index on `distress_score_id`.

- **`distress_forecasts`** — `id, case_id, distress_score_id, horizon_days int,
  predicted_score numeric, ci_lower numeric, ci_upper numeric, crisis_probability numeric,
  method text, model_version text, backtest_mae numeric, created_at`.

- **`consent_records`** — `id, victim_id, scope consent_scope, granted boolean,
  granted_at timestamptz, revoked_at timestamptz, policy_version text, created_at`.
  Unique on `(victim_id, scope)`.

- **`audit_log`** — hash-chained. `id bigserial PK, actor_id uuid, actor_role text, action text,
  resource_type text, resource_id uuid, case_id uuid, purpose text, ip_hash text,
  metadata jsonb, prev_hash text, entry_hash text NOT NULL, created_at`.
  Index on `(case_id, created_at DESC)` and `(actor_id, created_at DESC)`.

- **`intervention_catalog`** — the POA Act statutory reference table, seeded (see §3.6).
  `id, code text UNIQUE, support_type support_type, title text, statutory_basis text,
  responsible_authority text, sla_hours int, description text, eligibility_note text,
  applies_to_case_types text[], min_risk_level risk_level, active boolean DEFAULT true`.

- **`district_registry`** — `id, state text, district text, lis_code text,
  population_sc int, population_st int, sp_office_contact text, dlsa_contact text,
  UNIQUE(state, district)`. Seed with the districts used in `scripts/seed.ts` plus ~20 more so the
  national map has data.

Extend `distress_scores`:
```sql
ALTER TABLE distress_scores
  ADD COLUMN IF NOT EXISTS component_clinical      numeric,
  ADD COLUMN IF NOT EXISTS component_text          numeric,
  ADD COLUMN IF NOT EXISTS component_voice         numeric,
  ADD COLUMN IF NOT EXISTS component_behavioural   numeric,
  ADD COLUMN IF NOT EXISTS component_context       numeric,
  ADD COLUMN IF NOT EXISTS composite_version       text DEFAULT 'v2.0',
  ADD COLUMN IF NOT EXISTS crisis_override         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS crisis_override_reason  text;
```

Extend `cases`:
```sql
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS next_hearing_date        date,
  ADD COLUMN IF NOT EXISTS fir_number               text,
  ADD COLUMN IF NOT EXISTS poa_sections             text[],
  ADD COLUMN IF NOT EXISTS relief_stage             text,
  ADD COLUMN IF NOT EXISTS relief_amount_sanctioned numeric,
  ADD COLUMN IF NOT EXISTS relief_amount_disbursed  numeric,
  ADD COLUMN IF NOT EXISTS relief_due_date          date,
  ADD COLUMN IF NOT EXISTS witness_protection_status text,
  ADD COLUMN IF NOT EXISTS cadence_tier             text,
  ADD COLUMN IF NOT EXISTS last_contact_at          timestamptz;
```

Add RLS policies for every new table mirroring the existing pattern (victim reads own,
counsellor/official read assigned, `get_my_role()` for role checks). `audit_log` gets SELECT for
the subject victim and admins only, and no UPDATE or DELETE policy for anyone.

Also fix the **admin RLS gap**: current migrations give `admin` almost no policies. Add
`get_my_role() = 'admin'` read policies on `cases`, `alerts`, `distress_scores`, `checkins`.

### 2.2 Dependencies

`services/ml-service/requirements.txt` — add:
```
librosa>=0.10.2
praat-parselmouth>=0.4.4
numpy>=1.26
scipy>=1.13
soundfile>=0.12.1
scikit-learn>=1.5
python-multipart>=0.0.9
statsmodels>=0.14
```
Note: `praat-parselmouth` needs a wheel for the local Python version. If it fails to install,
implement jitter/shimmer/HNR with `numpy` autocorrelation in `prosody.py` and set
`confidence: "reduced"` — do not block the phase on it.

`apps/web` — add:
```
framer-motion  @radix-ui/react-tooltip  @radix-ui/react-scroll-area  @radix-ui/react-progress
@radix-ui/react-separator  @radix-ui/react-accordion  @radix-ui/react-popover
sonner  next-themes  react-simple-maps  d3-scale  d3-array  cmdk  class-variance-authority
```
(`@radix-ui/react-dialog`, `react-tabs`, `react-select`, `react-dropdown-menu`, `react-avatar`,
`react-toast`, `lucide-react`, `recharts`, `tailwindcss-animate` are already installed.)

### 2.3 Shared types

Extend `packages/shared-types/src/index.ts` with every new entity and API response shape defined in
this document. All three apps import from here — keep it the single source of truth.

---

## 3. PHASE 1 — INTELLIGENCE LAYER (target: 3 h)

Build in this order. Each item is independently demo-able.

### 3.1 Composite Distress Score v2 — *the spine of everything else*

Replace the single opaque Gemini number with a **weighted composite of five named channels**. This
single change is what makes explainability real, makes voice analytics meaningful, and makes the
score defensible to a clinician.

```
distress_score = clamp(0, 100, Σ (channel_weight × channel_score))
```

| Channel | Weight | Source | Present when |
|---|---|---|---|
| `clinical` | 0.30 | PHQ-9 / GAD-7 / PC-PTSD-5 / C-SSRS normalised to 0–100 | an instrument was administered in the last 14 days |
| `text_sentiment` | 0.25 | Gemini `/score` on the transcript | always |
| `vocal_stress` | 0.20 | Vocal Stress Index from prosody | voice channel only |
| `behavioural` | 0.15 | engagement score inverted | ≥2 prior check-ins |
| `case_context` | 0.10 | hearing proximity, relief delay, case type, stage | always |

**Weight redistribution.** When a channel is unavailable, redistribute its weight proportionally
across the present channels and record which channels were active in
`distress_scores.composite_version` metadata. Never silently treat a missing channel as zero — that
would make a voice-less, screener-less check-in look artificially calm.

**Crisis override.** Before composing, run a deterministic crisis check. If it fires, set
`score = 95`, `risk_level = 'critical'`, `crisis_override = true`, populate
`crisis_override_reason`, and alert immediately regardless of every other signal. Triggers:
C-SSRS item 3/4/5 positive, explicit self-harm/suicide language (multilingual regex + Gemini
confirmation, either alone is sufficient — OR logic, never AND), disclosure of active threat to
life, or a report of a witness-intimidation incident.

**Write one `score_contributions` row per feature**, with `raw_value`, `weight`, `contribution`
(the actual points added or removed), and a human-readable `evidence` string. This table is what
the XAI panel renders — the explanation is generated from the same arithmetic that produced the
score, not from a second model asked to rationalise it. Say exactly that in the UI.

New file: `apps/api/src/lib/composite-score.ts`. Refactor `scoring-pipeline.ts` to call it. Keep
`localFallback()` as the text-channel fallback.

### 3.2 Care Cadence Engine — *the biggest gap in the current build*

The problem statement's first requirement is *"conduct periodic interactions."* Right now nothing
happens unless the survivor opens the app. Fix this.

New files: `apps/api/src/lib/cadence-engine.ts`, `apps/api/src/routes/outreach.ts`.

**Risk-adaptive cadence.** After every score, recompute the case's `cadence_tier` and upsert the
next `outreach_schedule` row:

| Tier | Condition | Interval |
|---|---|---|
| `intensive` | critical, or escalation ≥ 75 | 24 h |
| `active` | high, or escalation ≥ 55 | 48 h |
| `routine` | moderate | 7 days |
| `maintenance` | low, stable ≥ 3 check-ins | 14 days |

**Event-triggered outreach.** Independently of tier, schedule contacts at:
- `next_hearing_date − 48h` — pre-hearing anxiety is the single most predictable distress spike
- `next_hearing_date + 24h` — post-hearing outcome check
- `relief_due_date + 1d` if `relief_amount_disbursed < relief_amount_sanctioned` — Rule 12(4) delay
- case `status` transition — every stage change is a distress event
- 7 days after any alert is resolved — relapse check

**Silence detection.** This is the clinically important half. A missed scheduled outreach is not
neutral, it is a signal. When an outreach passes `scheduled_for + grace_period` with no response,
mark it `missed`, increment `attempt_count`, and apply an escalating penalty to the case's
behavioural channel: 1 missed = +8, 2 = +18, 3+ = +30 and auto-create an alert with reason
`"disengagement — 3 consecutive missed contacts"`. Surface these prominently in the counsellor
queue as a dedicated **"Gone Quiet"** section. Judges will immediately grasp why this matters.

**Runner.** A `setInterval` tick in `apps/api/src/index.ts` every 60 s that processes due rows: send
via the channel (Exotel SMS/IVRS if configured, else log and mark `sent`), emit a Socket.io event,
and mark misses. Add `POST /outreach/simulate-tick` (admin-only) so the demo can fast-forward time
on stage rather than waiting.

Endpoints: `GET /outreach/case/:caseId`, `POST /outreach/schedule` (manual),
`POST /outreach/:id/respond`, `GET /outreach/due`, `POST /outreach/simulate-tick`.

### 3.3 Voice Stress Analytics — *the named innovation component you currently score zero on*

New file: `services/ml-service/prosody.py`. New endpoint `POST /score-voice` accepting
`multipart/form-data` with an audio file plus JSON metadata.

**Extract** (parselmouth for the Praat-standard measures, librosa for the rest):
- F0 mean, std, range (Praat `To Pitch`, floor 75 Hz, ceiling 500 Hz)
- Jitter local, shimmer local, HNR dB (`PointProcess` → `Get jitter (local)` etc.)
- Speech rate and articulation rate (syllable-nucleus detection via intensity peaks)
- Pause ratio and mean pause duration (silence intervals below −25 dB relative to peak, ≥ 250 ms)
- Intensity mean and std, spectral centroid, MFCC 1–13 mean/std

**Vocal Stress Index (0–100).** Compute per-feature z-scores against the victim's own
`voice_baselines` row when `sample_count ≥ 3`; otherwise fall back to published population norms
(state them in a comment with the direction of effect). Weight by the literature on acoustic
correlates of psychological stress:

```
VSI = 100 * sigmoid( 0.28*z(f0_mean) + 0.18*z(f0_std) + 0.16*z(jitter)
                   + 0.14*z(shimmer) - 0.12*z(hnr) + 0.07*z(pause_ratio)
                   + 0.05*z(|speech_rate - baseline|) )
```
Direction: stress raises F0 mean and variability, raises jitter and shimmer, **lowers** HNR (breathy
/ strained voice), and lengthens pauses. Document each sign in the code.

Return `vocal_stress_index`, `baseline_deviation`, every raw feature, and `confidence`
(`high` if duration ≥ 15 s and baseline exists; `medium` if one is missing; `low` otherwise —
below 5 s of speech return `confidence: "insufficient"` and let the composite drop the channel).

**Baseline learning.** After each analysis where the resulting text score is `low`, update
`voice_baselines` with a running mean. Personalised baselines are the honest way to do this — say
so in the pitch, because population-norm-only voice stress is scientifically weak and a good judge
knows it.

**Frontend capture.** In `apps/web`, use `MediaRecorder` (`audio/webm;codecs=opus`) during the
voice check-in, upload to `POST /checkins/voice` on the API, which forwards to the ML service. Ask
for explicit consent before the first recording and write it to `consent_records`. Show a live
waveform during recording using `AnalyserNode` — visually this is one of the strongest moments in
the demo.

Keep Web Speech API for the live transcript. Prosody runs on the recorded audio in parallel. Both
feed the composite.

### 3.4 Clinical Instruments Layer

New file: `apps/api/src/lib/clinical-instruments.ts` plus scoring in the ML service.

Implement **PHQ-2 → PHQ-9** (depression), **GAD-2 → GAD-7** (anxiety), **PC-PTSD-5 → PCL-5**
(post-traumatic stress — directly relevant to atrocity survivors), **C-SSRS** screener (suicide
risk), and **WHO-5** (wellbeing, as a positive-framing alternative).

**Conversational administration.** Do not show a survey form. The Mann-Mitra chatbot weaves items
into natural conversation in the user's language, and Gemini maps each reply onto the 0–3 Likert
scale with a confidence value. Only escalate to the full instrument when the 2-item screener trips
(PHQ-2 ≥ 3, GAD-2 ≥ 3, PC-PTSD-5 ≥ 3). Cap it at one full instrument per session — re-traumatising
someone with a 25-item battery is exactly the wrong outcome.

Persist to `clinical_assessments` with `raw_responses` holding each item, the mapped score, and the
mapping confidence. Normalise to 0–100 for the clinical channel:
`PHQ-9 /27`, `GAD-7 /21`, `PCL-5 /80`, weighted 0.4 / 0.3 / 0.3 when multiple are recent.

Store the severity band per instrument (e.g. PHQ-9: 0–4 minimal, 5–9 mild, 10–14 moderate,
15–19 moderately severe, 20–27 severe) and display **the band, not the raw number**, to counsellors
alongside the instrument name — that is how it appears in clinical practice.

This is the single highest-credibility addition in the whole build. "Our score is anchored to
PHQ-9, GAD-7 and PCL-5" is a completely different conversation from "our LLM said 72."

### 3.5 Behavioural & Engagement Analytics

New file: `apps/api/src/lib/engagement.ts`.

Capture per check-in from the client and persist to `engagement_metrics`:
- response latency from prompt to first keystroke
- message length in characters and words, and its trend (collapsing message length is a strong
  withdrawal signal)
- session duration, number of turns, abandonment (started and never submitted)
- hour of day and day of week, and drift from the person's own norm (a 3 a.m. check-in from someone
  who always checks in at 7 p.m. is meaningful)
- days since last check-in vs the expected cadence interval
- missed outreach count in 30 days

```
engagement_score = 100 - clamp(0,100,
    30 * (missed_ratio_30d)
  + 20 * (1 - normalised_message_length_vs_own_baseline)
  + 15 * (abandonment_rate_30d)
  + 15 * (overdue_days / cadence_interval_days)
  + 10 * (latency_z_score_clamped)
  + 10 * (circadian_drift_hours / 12) )
```
The behavioural channel contributes `100 - engagement_score`.

### 3.6 POA Act Intervention Recommender

New file: `apps/api/src/lib/intervention-engine.ts`. Seed `intervention_catalog` with real
statutory entitlements — the specificity here is what separates this from a generic wellness app:

| Code | Title | Statutory basis | Authority | SLA |
|---|---|---|---|---|
| `POA_RELIEF_IMMEDIATE` | Immediate monetary relief | SC/ST (PoA) Rules 1995, Rule 12(4) + Annexure I | District Magistrate | 168 h |
| `POA_RELIEF_STAGED` | Staged relief on chargesheet / conviction | Rules 1995, Annexure I | District Magistrate | 720 h |
| `POA_WITNESS_PROTECT` | Witness protection measures | Witness Protection Scheme 2018; PoA Act s.15A(8),(11) | SP / District Committee | 24 h |
| `POA_RELOCATION` | Relocation / safe accommodation | Rules 1995, Rule 11; WPS 2018 cat. A | District Magistrate | 72 h |
| `POA_LEGAL_AID` | Free legal representation | Legal Services Authorities Act 1987; PoA s.15A(2) | DLSA Secretary | 72 h |
| `POA_SPECIAL_PP` | Special Public Prosecutor appointment | PoA Act s.15 | State Government | 336 h |
| `POA_TRAVEL_MAINT` | Travel & maintenance for court attendance | Rules 1995, Rule 11(1)–(4) | District Magistrate | 48 h |
| `POA_MEDICAL` | Medical treatment & rehabilitation | Rules 1995, Rule 12(4) proviso | CMHO / District Hospital | 24 h |
| `MHA_COUNSELLING` | Psychiatric / psychological care | Mental Healthcare Act 2017, s.18 | DMHP, District | 48 h |
| `MHA_CRISIS` | Emergency mental-health response | MHCA 2017 s.18; Tele-MANAS 14416 | Tele-MANAS / DMHP | 1 h |
| `POA_VM_ESCALATE` | Escalate to Vigilance & Monitoring Cttee | Rules 1995, Rule 16 (district) / 17 (state) | DM / Chief Secretary | 720 h |
| `POA_ATROCITY_PRONE` | Atrocity-prone area protection measures | Rules 1995, Rule 3 | SP / DM | 168 h |
| `BNSS_COMPENSATION` | Victim compensation scheme | BNSS s.396 (formerly CrPC 357A); NALSA scheme | DLSA | 720 h |

**Matching logic.** Score each catalogue entry against the case using: risk level, escalation risk,
detected signals (threat → witness protection; financial → relief; medical keywords → medical),
case type (rape/gang rape → medical + special PP + relocation; witness intimidation → protection;
murder → relief + legal aid), case stage, elapsed relief delay, and whether the same intervention
is already `in_progress`. Return the top 5 with a match rationale.

Every recommendation card in the UI shows title, statutory basis, responsible authority, an SLA
countdown, and a **breach flag** when the SLA is exceeded. An overdue-SLA view for officials —
"7 relief payments past the Rule 12(4) deadline in this district" — is exactly the accountability
artefact a government judge is looking for.

### 3.7 Predictive Forecast with Uncertainty

New file: `services/ml-service/forecast.py`, endpoint `POST /forecast`.

Given a case's score history, produce a 7-day projection:
1. **Baseline** — Holt's linear exponential smoothing (`statsmodels`) on the score series, with a
   prediction interval. Requires ≥ 4 points; below that, fall back to the existing rules formula
   and label it as such.
2. **Crisis probability** — logistic regression over engineered features (current score, 3-point
   slope, EWMA, variance, consecutive elevated count, engagement score, days to hearing, missed
   outreach count, vocal stress delta) predicting "any critical score within 7 days." Train it on
   the seeded longitudinal data (see §5) with a proper temporal train/test split.
3. **Backtest and report the number.** Compute MAE for the score projection and AUC/precision/recall
   for the crisis classifier on held-out data. Store `backtest_mae` on every forecast row and
   **display the accuracy in the UI**. A stated, honest, modest accuracy number beats an
   unquantified claim of "predictive" every single time.

Label the whole thing clearly: *"Trained on synthetic longitudinal data calibrated to published
trauma-recovery trajectories. Requires validation on real NHAA data before deployment."* That
sentence protects you from the hardest question you will be asked.

Render as a **forecast cone** — the historical line continuing into a shaded uncertainty band,
crossing a dashed "crisis threshold" line at 76. Visually this is the single most convincing
"we are predictive" artefact in the build.

### 3.8 Explainability Panel (real attribution)

New endpoint `GET /cases/:caseId/scores/:scoreId/explain` on the **API** (not the ML service),
reading `score_contributions` directly.

Returns: the composite arithmetic, per-channel contributions with evidence strings, the top 5
individual features ranked by absolute contribution, counterfactuals ("score would fall to 51 if
engagement returned to this person's baseline"), the model version, the confidence, and an explicit
statement of what is **not** claimed.

Render as a **waterfall chart**: baseline 0 → each contribution as a positive or negative bar →
final score. Beside it, plain-language sentences per contribution. This is genuine feature
attribution, not an LLM narrating itself — and you should say that difference out loud in the pitch,
because most competing teams will have the LLM-narrating version.

Rewrite the ML service's `/explain` to delegate to this, or deprecate it.

### 3.9 Consent & Audit Ledger

New files: `apps/api/src/lib/audit.ts`, `apps/api/src/routes/consent.ts`.

**Audit.** Express middleware that writes an `audit_log` row for every read or write touching victim
data: actor, role, action, resource, case, declared purpose, SHA-256 of the IP, and
`entry_hash = sha256(prev_hash || canonical_json(entry))`. Add `GET /audit/verify` that walks the
chain and reports integrity — tamper-evidence you can demonstrate live by showing the verify
endpoint pass.

**Consent.** Granular per-scope toggles enforced in code, not just recorded. If
`llm_processing` is revoked, the pipeline must actually skip Gemini and use rules only. If
`voice_recording` is revoked, the recorder must not start. Demonstrating enforcement rather than
mere logging is the difference between a compliance claim and a compliance feature.

**Retention.** A daily job that deletes raw audio past 90 days and raw transcripts past 365 days
while retaining derived scores, matching the DPDP Act's storage-limitation principle. Show the
retention countdown in the UI.

**Victim transparency screen** at `/victim/privacy`: "who accessed your information", the consent
toggles, retention timers, and a data-export button. This is a genuinely rare feature in hackathon
projects and reads as serious.

### 3.10 PII Redaction

New file: `apps/api/src/lib/redact.ts`. Before any transcript leaves for Gemini, strip Indian names
(against a name list plus the victim's own known name and family names on the case), phone numbers,
Aadhaar-shaped digits, email addresses, exact addresses, and place names below district level.
Replace with typed placeholders (`[NAME_1]`, `[PHONE]`, `[VILLAGE]`) so context survives. Persist
the redaction map locally, never send it. Log a redaction count per call and surface it in the admin
console: "1,247 PII entities redacted before model processing this month." Now the privacy claim in
your pitch is verifiably true.

### 3.11 Multilingual

Extend from en/hi/ta to at least: Hindi, English, Tamil, Telugu, Marathi, Bengali, Kannada,
Gujarati, Odia, Punjabi, Malayalam, Assamese. Gemini handles generation; keep code-mixed
(Hinglish/Tanglish) handling in the prompts, which already exists. Extend the fallback keyword
dictionary in `_fallback_score()` with distress terms in each script so the offline path is not
English-only. Reference **Bhashini** (the Government of India national language platform) as the
production ASR/TTS path and mark it `ARCHITECTED` — naming the actual government stack matters here.

### 3.12 Fix the known defects

Work through §0's defect list. Items 1 and 2 are security bugs and must be fixed.

---

## 4. PHASE 2 — FRONTEND REBUILD (target: 3 h)

### 4.1 The core design thesis

**Two design systems in one app, deliberately, because two populations have opposite needs.**
Say this explicitly during the pitch — it reads as design maturity rather than inconsistency.

**SANCTUARY** (victim + onboarding + public) — calm, warm, low-stimulation, trauma-informed.
**COMMAND** (counsellor + official + admin) — dark, dense, precise, operational.

Implement as two token sets in `globals.css` scoped by a wrapper class (`.theme-sanctuary`,
`.theme-command`), applied in the respective route-group layouts. Use `next-themes` only if you also
want a light/dark toggle inside Command; the sanctuary/command split itself is route-driven, not
user-toggled.

### 4.2 Sanctuary tokens

```
Background      warm dawn gradient: #FDFBF7 → #FBF6EF → #F7F1E8
Surface         #FFFFFF at 70% with backdrop-blur-xl
Primary         deep teal   #0F6F65   (trust, calm, non-clinical)
Secondary       warm sand   #E8DCC8
Accent          soft terracotta #C97B5A  (warmth — never alarm)
Text            #1C2B2A primary, #5A6B69 muted
Success         sage #6B9080
NEVER USE       red, orange, "critical", numeric scores, warning triangles
Radius          1.25rem cards, 2rem hero surfaces, full on buttons
Shadow          soft and diffuse: 0 4px 24px rgba(15,111,101,0.06)
Type            Display: Fraunces or Newsreader (warm serif) — headings only
                Body:    Inter — 16px min, 1.7 line-height, generous
Motion          slow and organic: 400–700ms, ease-out; breathing 4s loop
```

**Screens to build:**

- **`/` landing.** Full-bleed dawn gradient. Serif headline. A live animated hero showing the
  distress-trend line bending downward after an intervention marker — the whole product thesis in
  one visual. Below: the four-step story (Listen → Understand → Predict → Protect), an
  honest LIVE / ARCHITECTED / ROADMAP capability matrix, the innovation-components grid mapped to
  actual features, and crisis helplines in the footer. Scroll-reveal with Framer Motion
  `whileInView`.

- **`/victim/checkin` — the emotional centrepiece.** A breathing orb (4 s scale 1→1.06 loop) that
  the user can tap to start. Chat bubbles that fade and rise in. Mann-Mitra responses that
  stream token by token rather than appearing at once. A mood check that uses **soft illustrated
  faces or a colour-temperature gradient slider, never a 1–10 number**. A language pill row. A
  visible, always-available "I need help now" button that surfaces crisis resources without
  requiring the user to explain themselves first. On submit: no score, no risk badge — a warm
  acknowledgement, "Thank you for telling me. Someone who cares is looking after your case."

- **`/victim/call`.** Live waveform from `AnalyserNode` in warm teal. A calm pulse while the AI
  speaks. Explicit recording-consent modal before the first use, with a plain-language explanation
  of what is captured and why.

- **`/victim/journey`** (replacing `/victim/history`). Not a score history — a **care timeline**:
  check-ins, calls, and support actions taken on their behalf, rendered as a gentle vertical path
  with milestone markers. Shows what the system *did for them*, which builds the confidence in the
  justice system that the problem statement lists as an expected outcome. Still no scores.

- **`/victim/privacy`.** Consent toggles, access log, retention timers, export button.

- **`/victim/support`.** Their entitlements under the POA Act in plain language, with the current
  status of each (relief sanctioned / disbursed, legal aid assigned, protection status). Turning
  opaque statutory entitlements into a legible status page is genuinely valuable and demos well.

### 4.3 Command tokens

```
Background      #0B0F14 base, #131A22 elevated, #1A232D raised
Border          #22303C, hairline
Primary         electric cyan #22D3EE  (data, precision)
Text            #E6EDF3 primary, #8B98A5 muted
Risk scale      low #10B981 · moderate #F59E0B · high #F97316 · critical #EF4444
Escalation      violet #A78BFA (distinct from risk — different concept, different hue)
Radius          0.5rem — sharper, more instrumental
Type            Inter with tabular-nums everywhere; JetBrains Mono for IDs, scores, timestamps
Density         compact: 32px rows, 12–13px labels
Motion          fast and functional: 120–200ms
```

**Screens to build:**

- **`/counselor/queue`** (replacing `/counselor/cases`). A triage console: filter rail, live-updating
  priority list, keyboard navigation (`j`/`k` to move, `Enter` to open, `a` to acknowledge), and a
  **"Gone Quiet"** section pinned above the fold for disengaged cases. Each row: anonymised label,
  risk chip, escalation bar, sparkline of the last 10 scores, trend arrow, days since contact, next
  scheduled outreach, top recommended intervention. Rows animate on reorder with Framer Motion
  `layout`. New alerts arrive by socket and flash in.

- **`/counselor/cases/[id]` — the intelligence view.** A three-column layout:
  - *Left* — case identity, POA sections, FIR, hearing date with countdown, relief status, assigned
    officers, consent state.
  - *Centre* — the **score chart with the forecast cone** (history solid, projection shaded, crisis
    threshold dashed at 76, intervention events as markers on the x-axis so you can visually
    correlate action with outcome), then the **XAI waterfall**, then the check-in feed with
    per-entry expandable explanations, then clinical instrument bands over time.
  - *Right* — recommended interventions with statutory basis and SLA countdowns, outreach schedule,
    intervention notes, quick actions (call, schedule, escalate, mark intervention started).
  - Header: an auto-generated **pre-call brief** — three sentences a counsellor can read in ten
    seconds before dialling. This is the feature counsellors would actually thank you for.

- **`/official/command`** (replacing `/official/dashboard`). A national operations centre:
  - **India choropleth** (`react-simple-maps` + a state TopoJSON) coloured by mean distress, with
    drill-down national → state → district. Clicking a state filters everything below it.
  - KPI strip: active cases, high-risk count, open alerts, SLA breaches, mean response time,
    engagement rate.
  - **Anomaly panel** — districts whose distress is rising significantly faster than the national
    baseline (simple z-score of district slope against the national distribution). "Nagaur is
    +2.3σ above national trend this week" is exactly the evidence-based-policymaking output the
    problem statement asks for.
  - **SLA accountability table** — interventions past their statutory deadline by district.
  - Stage funnel: complaint → investigation → trial → compensation → rehabilitation, with mean
    distress at each stage. This visualises *where in the justice process people suffer most*,
    which is a policy insight, not just a chart.

- **`/official/alerts`.** Dense triage table with bulk acknowledge and an SLA timer per alert.

- **`/admin`.** Keep the existing capabilities, restyle to Command, add: the NHAA intake simulator
  (clearly labelled), model health (Gemini reachable, forecast MAE, redaction counter, ML latency),
  audit-chain verification with a live pass/fail indicator, cadence-tick simulation control for the
  demo, and district registry management.

### 4.4 Shared component work

Install the full shadcn/ui set (`dialog`, `sheet`, `tabs`, `select`, `dropdown-menu`, `tooltip`,
`popover`, `accordion`, `progress`, `separator`, `scroll-area`, `skeleton`, `badge`, `table`,
`command`). Replace every native `<select>` and every `prompt()` call.

New components to build:
`score-waterfall.tsx`, `forecast-chart.tsx`, `india-map.tsx`, `risk-sparkline.tsx`,
`cadence-timeline.tsx`, `intervention-card.tsx` (with SLA ring), `voice-waveform.tsx`,
`breathing-orb.tsx`, `clinical-band.tsx`, `consent-toggle.tsx`, `audit-trail.tsx`,
`explain-popover.tsx`, `gone-quiet-list.tsx`, `pre-call-brief.tsx`, `capability-badge.tsx`
(LIVE/ARCHITECTED/ROADMAP), `crisis-sheet.tsx`.

Replace every "Loading…" with a skeleton. Give every empty state an illustration and a next action.
Delete `incoming-call-toast.tsx` (dead code).

**Accessibility, non-negotiable given the user population:** WCAG AA contrast on both themes,
`aria-live="polite"` on the chat feed, real labels on the mic and speak buttons, full keyboard
navigation, visible focus rings, `prefers-reduced-motion` honoured on every animation (especially
the breathing orb), and 16px minimum body text on the victim side.

---

## 5. PHASE 3 — DEMO READINESS (target: 1 h)

### 5.1 Rewrite the seed script

`scripts/seed.ts` must generate **longitudinal data**, not snapshots. The forecast, trend, cadence,
and anomaly features are all invisible without history.

Create ~60 cases across ≥ 8 districts in ≥ 4 states, each with 10–20 check-ins spread over 90 days,
with **deliberately shaped trajectories**:
- *Deteriorating* — steady climb with a spike two days before a hearing date
- *Recovering* — high, then a counselling intervention marker, then decline
- *Volatile* — oscillating, triggered by relief-payment delays
- *Silent* — engaged, then stopped 18 days ago (this is the "Gone Quiet" demo case)
- *Stable low* — the control
- *Crisis* — one case that trips the crisis override, for the alert demo

Populate voice analyses, clinical assessments, engagement metrics, outreach history (including
misses), score contributions, and forecasts for each. Make case types match the priority use cases:
rape and gang rape, murder, grievous hurt, arson, witness intimidation, caste-based violence
affecting families. Use realistic POA sections and FIR numbers.

Then **train the forecast model on this data and commit the resulting metrics**, so the accuracy
figure shown in the UI is real and reproducible.

### 5.2 Rewrite `README.md`

Purge "crime victim." Reframe throughout as POA Act / atrocity survivor / NHAA 14566. Add: the
innovation-components table mapped to the file that implements each, the LIVE/ARCHITECTED/ROADMAP
matrix, the compliance section (DPDP Act 2023, IT Act 2000, Mental Healthcare Act 2017 s.18,
SC/ST PoA Act 1989 and Rules 1995), the scoring methodology with the composite formula written out,
and the model limitations stated plainly.

### 5.3 Rewrite `docs/PRESENTATION.md`

A 6-minute demo script:

1. **Landing** (30 s) — the problem, the four-step thesis, the honesty matrix.
2. **Survivor check-in** (60 s) — Hindi voice check-in, live waveform, breathing orb, warm
   acknowledgement. Point out: *no score was shown to her, by design.*
3. **What the system actually did** (60 s) — counsellor console: the alert arriving live, the
   waterfall showing that vocal stress and a missed hearing-eve outreach drove the score, not just
   the words.
4. **Prediction** (60 s) — the forecast cone crossing the crisis threshold in four days, with the
   stated backtest accuracy and the stated limitation.
5. **Intervention** (60 s) — recommendations with statutory basis, SLA countdown, one dispatched.
6. **Governance** (60 s) — national map, the anomaly district, the SLA breach table, then the audit
   chain verifying and a consent toggle actually disabling LLM processing.
7. **Close** (30 s) — innovation components checklist, roadmap, what would be needed for real
   deployment.

Also prepare answers to the four questions you will definitely be asked:
- *"Is your prediction validated?"* — No. Backtested on synthetic data calibrated to published
  trajectories, MAE stated. Requires prospective validation on real NHAA data. Here is the design
  for that study.
- *"How is this explainable?"* — The score is a weighted composite; the explanation is the
  arithmetic, not a second model rationalising the first. Show the waterfall.
- *"What about false positives?"* — Every alert routes to a human; the system never acts
  autonomously. Show the threshold tuning and the human-in-the-loop.
- *"Privacy?"* — PII redacted before any model call with a live counter, granular enforced consent,
  hash-chained audit, retention limits, RLS. Show the verify endpoint and the victim privacy screen.

### 5.4 Verify

`pnpm build` clean across all workspaces. `pnpm lint` clean. Every demo path walked end to end at
each of the three ports. Kill Gemini's API key and confirm the whole system still functions on the
fallback path — then restore it. Confirm `prefers-reduced-motion` works.

---

## 6. PRIORITY IF YOU RUN OUT OF TIME

Do not attempt everything if the clock is against you. Ranked by marks-per-hour:

1. **Composite score + XAI waterfall** (§3.1, §3.8) — unlocks the explainability story
2. **Care Cadence Engine + Gone Quiet** (§3.2) — closes the single biggest gap
3. **Sanctuary victim UI** (§4.2) — the emotional differentiator, and the thing you asked about
4. **Voice Stress Analytics** (§3.3) — a named component you currently score zero on
5. **Command counsellor console** (§4.3) — where the intelligence becomes visible
6. **POA intervention recommender** (§3.6) — cheap, high domain credibility
7. **Forecast cone** (§3.7) — the "predictive" proof
8. **Clinical instruments** (§3.4) — highest credibility with clinical judges
9. **National map + anomaly** (§4.3) — the governance story
10. **Consent/audit/redaction** (§3.9, §3.10) — compliance made concrete
11. Behavioural analytics, multilingual expansion, defect fixes

Anything below the line you cannot reach: implement the API contract and the data model, mark it
`ARCHITECTED` in the UI, and say so honestly in the pitch. A clearly-labelled gap costs you far less
than a discovered overclaim.

---

## 7. ANTI-GOALS

Do not show scores or risk levels to victims. Do not add a real NHAA or government API integration —
it is not available and faking one is disqualifying. Do not replace Gemini with a self-hosted model.
Do not migrate frameworks. Do not use blockchain for the audit log — a hash chain in Postgres is the
honest, sufficient answer. Do not claim clinical diagnosis anywhere; this is triage support for
authorised professionals, and every AI output must carry that disclaimer. Do not let the LLM make an
autonomous decision about a suicide disclosure. Do not remove the existing fallback paths.
