# SAMVEDNA — Master Build Prompt (v2)

Repository: `/Users/anik/Code/SAMVEDNA`. Budget: 7–8 hours. Build in phase order. Never leave the
demo broken between phases.

You are building **SAMVEDNA** for the Smart India Hackathon, Ministry of Social Justice &
Empowerment: *"AI-based Dynamic Mental Health Monitoring and Distress Prediction System"* for
survivors and complainants registered via **NHAA 14566** and the Integrated Portal under the
**Scheduled Castes and Scheduled Tribes (Prevention of Atrocities) Act, 1989**.

---

# PART A — REPOSITORY STATE

Do not re-explore. This is accurate as of now.

**Monorepo:** pnpm workspaces, `pnpm@9.15.4`, Node ≥20, orchestrated by `concurrently`. No Turborepo.

```
apps/web             Next.js 14.2.22 App Router · React 18.3.1 · Tailwind 3.4.17
apps/api             Express 4.21.2 + Socket.io 4.8.1 · Zod · Helmet
apps/mobile          Expo SDK 57 · RN 0.86.3 · expo-router
services/ml-service  FastAPI + uvicorn + google-genai (Gemini 2.0 Flash)
packages/shared-types
supabase/migrations  4 applied migrations
scripts/             seed.ts · ensure-admin.ts · clear-seed.ts · migrate-check.ts
```

Ports: web `3000`, counsellor `3001`, admin `3002`, API `4000`, ML `8001`.
Demo password `Samvedna@2024`; admin `admin@samvedna.demo` / `SamvednaAdmin@2024`.

**Already installed in `apps/web` (use them, don't re-add):** framer-motion, sonner, next-themes,
react-simple-maps, d3-scale, d3-array, cmdk, recharts, lucide-react, tailwindcss-animate,
class-variance-authority, tailwind-merge, and Radix: slot, label, dialog, dropdown-menu, select,
tabs, toast, avatar, tooltip, scroll-area, progress, separator, accordion, popover, switch, slider.

**Database tables:** `profiles`, `cases`, `checkins`, `distress_scores`, `alerts`,
`support_recommendations`, `case_timeline_events`, `intervention_notes`, `onboarding_tokens`,
`call_sessions`.

Key shapes:
- `cases(id, victim_id, case_number UNIQUE, case_type, status case_status, assigned_counsellor_id, assigned_official_id, district, state, created_at)`
- `checkins(id, case_id, victim_id, channel checkin_channel, raw_transcript, created_at)`
- `distress_scores(id, checkin_id UNIQUE, case_id, score 0-100, risk_level, reasoning, signals_detected jsonb, trend_direction, escalation_risk_7d, escalation_reasoning, recommended_interventions jsonb, sentiment, emotion_indicators jsonb, contributing_factors jsonb, model_confidence, prediction_method, created_at)`
- `alerts(id, case_id, distress_score_id, severity, status, assigned_to, created_at, resolved_at)`

Enums: `user_role(victim,counsellor,official,admin)`,
`case_status(investigation,trial,rehabilitation,closed,complaint_registration,compensation,protection_followup)`,
`checkin_channel(chat,ivrs,sms,app,ai_voice,portal,chatbot,nhaa_14566,helpline)`,
`risk_level(low,moderate,high,critical)`, `alert_status(open,acknowledged,resolved)`,
`support_type(counselling,medical,legal,financial,protection,rehabilitation,relocation,witness_protection,follow_up)`,
`support_status(suggested,in_progress,completed)`, `call_type`, `call_status`.

Helper: `public.get_my_role()`. RLS is enabled everywhere but the API uses the **service-role key**,
so RLS is bypassed in practice and authorisation is application-layer.

**Risk bands everywhere:** low 0–30 · moderate 31–55 · high 56–75 · critical 76–100.

**API** (`apps/api/src`): mounts `/health /checkins /chat /calls /cases /alerts /dashboard /webhooks
/admin /intake`. Auth = Bearer JWT → `supabaseAdmin.auth.getUser` → role from `profiles`;
`requireAuth`, `requireRole`. Socket.io emits `new_alert`, `incoming_call`, `call_accepted`.
`lib/` holds `supabase.ts`, `ml-client.ts` (POST `/score`, 25 s timeout, `localFallback()`),
`scoring-pipeline.ts` (`createCheckinAndScore()`), `distress-intelligence.ts` (trend + escalation +
priority rules), `call-routing.ts`, `exotel*.ts`, `phone.ts`, `errors.ts`.

**ML service** (`services/ml-service/main.py`, one file): `GET /health`, `POST /score` (Gemini JSON
mode with `_fallback_score()` keyword rules), `POST /explain` (just reformats — no second call),
`POST /chat` ("Mann-Mitra" companion).

**Web routes today:** `/`, `/login`, `/signup`, `/onboard/[token]`, `/auth/callback`,
`/victim/{checkin,call,history}`, `/counselor/{cases,cases/[id],calls}`,
`/official/{dashboard,alerts}`, `/admin`. Components: `app-shell`, `ai-voice-call` (Web Speech),
`alert-toast`, `crisis-notice`, `risk-badge`, `incoming-call-panel`, `incoming-call-toast` (dead),
and only four UI primitives (`button`, `card`, `input`, `label`).

**Bugs to fix in passing:** (1) `GET /alerts/` doesn't filter for `victim` role — a victim sees
every alert, security bug. (2) `PATCH /cases/:id/support/:supportId` has no authorisation check.
(3) Exotel webhooks unverified. (4) `lookupVictimByPhone` loads all victims into JS.
(5) `/intake/nhaa` uses `listUsers({perPage:200})`. (6) `support_recommendations` duplicated every
check-in. (7) `/chat` proxy has no timeout or fallback. (8) Tamil typo in `crisis-notice.tsx`:
`அavசர` → `அவசர`. (9) Admin credentials hardcoded in `login/page.tsx`. (10) Landing uses a teal
palette while the app uses purple.

---

# PART B — LAWS OF THIS BUILD

**1. The survivor never sees a number.** No distress score, no risk level, no red, no warning
triangle, no "critical" on any victim-facing screen — ever. Telling a trauma survivor "you are
78/100, CRITICAL" is iatrogenic harm and any clinician on the panel will mark you down. Assessment
is invisible to the assessed. Survivors see warmth, agency, and evidence that someone acted.

**2. Label every claim.** Three tiers used consistently in UI, README and pitch: `LIVE` (running
now), `ARCHITECTED` (contract + data model exist, integration simulated), `ROADMAP` (designed only).
Never dress the simulated NHAA connector as a live government API. Candour scores; a discovered
overclaim is fatal.

**3. Degrade, never fail silent.** If Gemini, prosody, or the forecast dies, the system still
scores, flags `model_confidence: "fallback"`, and routes for human review. Never default anyone to
"safe."

**4. Deterministic crisis path.** Explicit self-harm or suicide language, a positive C-SSRS item
3/4/5, or an active threat-to-life disclosure bypasses all scoring and model logic and fires a
critical alert immediately. An LLM must never be the arbiter of a suicide disclosure. Crisis
resources on screen instantly: 112, KIRAN 1800-599-0019, Tele-MANAS 14416, NHAA 14566.

**5. Language.** Purge "crime victim" from code, UI, and docs. Use *atrocity survivor*, *POA Act
beneficiary*, *complainant*, *protected witness*. Name the Act.

---

# PART C — THE FEATURE SET

Fourteen features. Each is specified to the level of formula and endpoint. Build in the numbered
order — later ones depend on earlier ones.

---

## C1 · Five-Channel Composite Score with Confidence Arbitration

Replace the opaque Gemini integer with a transparent weighted composite. This is the spine: it makes
explainability arithmetic rather than narrative, and it gives every other feature a place to plug in.

```
score = clamp(0,100, Σ wᵢ · channelᵢ)
```

| Channel | Base weight | Source | Available when |
|---|---|---|---|
| `clinical` | 0.30 | PHQ-9 / GAD-7 / PCL-5 / C-SSRS → 0–100 | instrument within 14 days |
| `text_sentiment` | 0.25 | Gemini `/score` on redacted transcript | always |
| `vocal_stress` | 0.20 | Vocal Stress Index (C3) | voice channel, ≥5 s speech |
| `behavioural` | 0.15 | 100 − engagement score (C5) | ≥2 prior check-ins |
| `case_context` | 0.10 | hearing proximity, relief delay, bail status, case type | always |

**Redistribute, never zero-fill.** A missing channel has its weight spread proportionally over
present channels. Zero-filling would make a text-only check-in look artificially calm. Record the
active channel set in `distress_scores.active_channels`.

**Affect–content discordance detector — the clinically sophisticated bit.** When the text channel
reads calm (< 40) but the vocal channel reads stressed (> 65), that gap is *itself* the strongest
signal, not noise. Minimisation and masking are textbook trauma presentations, and they are exactly
what a words-only system misses. Compute `discordance = |text_score − voice_score|`; when it exceeds
30, add `+12` to the composite, emit signal `affect_content_discordance`, and surface it verbatim in
the counsellor UI: *"She said she is fine. Her voice did not agree."* Judges remember this line.

**Crisis override** per Law 4: sets `score = 95`, `risk_level = 'critical'`, `crisis_override = true`,
with the reason recorded and the alert fired before any model call returns.

Write one `score_contributions` row per feature with `raw_value`, `weight`, `contribution`,
`direction`, and a plain-English `evidence` string. That table is the explanation — nothing is
generated after the fact.

New file `apps/api/src/lib/composite-score.ts`; refactor `scoring-pipeline.ts` to call it.

---

## C2 · Care Cadence Engine + Silence-as-Signal

The problem statement's first requirement is *"conduct periodic interactions."* Today nothing
happens unless the survivor opens the app. This is the single largest gap in the build.

**Risk-adaptive cadence.** Recompute `cases.cadence_tier` after every score and upsert the next
`outreach_schedule` row: `intensive` (critical or escalation ≥ 75) → 24 h · `active` (high or
escalation ≥ 55) → 48 h · `routine` (moderate) → 7 d · `maintenance` (low, stable ≥ 3) → 14 d.

**Event triggers** fire independently of tier:
- `next_hearing_date − 48 h` — pre-hearing anxiety is the most predictable spike in the entire dataset
- `next_hearing_date + 24 h` — outcome check
- `relief_due_date + 1 d` while `disbursed < sanctioned` — a Rule 12(4) breach is a distress event
- any `case.status` transition
- 7 days after an alert resolves — relapse check
- **anniversary of the incident**, and the first major festival after it — trauma anniversary
  reactions are well documented and nobody else in the competition will have thought of this

**Silence is data, not absence.** When a scheduled outreach passes its grace window unanswered, mark
it `missed` and apply an escalating behavioural penalty: 1 missed `+8`, 2 missed `+18`, 3+ missed
`+30` **and auto-create an alert** reading `"disengagement — 3 consecutive missed contacts"`. A
survivor who stops answering is the highest-risk person in the system and currently the most
invisible. Pin these to a **"Gone Quiet"** rail at the top of the counsellor console.

**Runner:** 60-second `setInterval` in `apps/api/src/index.ts` processing due rows, dispatching via
Exotel when configured (else log + mark `sent`), emitting a socket event, sweeping misses. Add
admin-only `POST /outreach/simulate-tick` so the demo fast-forwards instead of waiting.

Endpoints: `GET /outreach/case/:caseId`, `POST /outreach/schedule`, `POST /outreach/:id/respond`,
`GET /outreach/due`, `POST /outreach/simulate-tick`.
New files: `apps/api/src/lib/cadence-engine.ts`, `apps/api/src/routes/outreach.ts`.

---

## C3 · Voice Stress Analytics on a Personal Baseline

A named innovation component you currently score zero on. Real signal processing, not a mock.

New `services/ml-service/prosody.py`; endpoint `POST /score-voice` taking `multipart/form-data`.

**Extract** — parselmouth (Praat) for the clinical-standard measures, librosa for the rest:
F0 mean / std / range (pitch floor 75 Hz, ceiling 500 Hz) · jitter local · shimmer local · HNR dB ·
speech rate and articulation rate via intensity-peak syllable nuclei · pause ratio and mean pause
duration (silences ≥ 250 ms below −25 dB of peak) · intensity mean and std · spectral centroid ·
MFCC 1–13 mean and std.

**Vocal Stress Index.** Z-score each feature against **this person's own calm baseline** from
`voice_baselines` once `sample_count ≥ 3`; fall back to population norms before that and say so in
the confidence field.

```
VSI = 100 · sigmoid( 0.28·z(f0_mean) + 0.18·z(f0_std) + 0.16·z(jitter)
                   + 0.14·z(shimmer) − 0.12·z(hnr) + 0.07·z(pause_ratio)
                   + 0.05·z(|speech_rate − baseline|) )
```

Signs matter and must be commented in code: stress **raises** F0 mean and variability, jitter and
shimmer; it **lowers** HNR (strained, breathy phonation); it **lengthens** pauses.

Personal baselines are the honest approach and you should say so — population-norm-only voice stress
is scientifically weak and a good judge knows it. Learn the baseline by updating the running mean
after any analysis whose text score lands `low`.

`confidence`: `high` (≥15 s and baseline exists) · `medium` (one missing) · `low` · `insufficient`
(<5 s → composite drops the channel entirely).

**Capture:** `MediaRecorder` with `audio/webm;codecs=opus` in `apps/web`, uploaded to
`POST /checkins/voice`, proxied to the ML service. Explicit consent written to `consent_records`
before the first recording. Keep Web Speech API for the live transcript; prosody runs in parallel on
the recording. Both feed C1.

If `praat-parselmouth` won't build on the local Python, implement jitter/shimmer/HNR via numpy
autocorrelation, set `extractor: "numpy_fallback"`, `confidence: "reduced"`, and move on. Do not
let this block the phase.

---

## C4 · Conversationally-Administered Clinical Instruments

The highest-credibility item in the build. "Anchored to PHQ-9, GAD-7 and PCL-5" is a completely
different conversation from "our LLM said 72."

Implement **PHQ-2 → PHQ-9**, **GAD-2 → GAD-7**, **PC-PTSD-5 → PCL-5**, **C-SSRS** screener, and
**WHO-5** (positive framing alternative).

**Never render a survey form.** Mann-Mitra weaves items into natural conversation in the user's
language; Gemini maps each reply onto the 0–3 Likert scale with a confidence value. Escalate to the
full instrument only when the two-item screener trips (PHQ-2 ≥ 3, GAD-2 ≥ 3, PC-PTSD-5 ≥ 3). **Cap
at one full instrument per session** — putting a 25-item battery in front of a rape survivor is
re-traumatising and is the opposite of the goal.

**Adaptive item selection.** Within an instrument, order items by expected information gain given
answers so far (simple IRT-flavoured heuristic: ask the item whose population response distribution
is closest to 50/50 given the current partial score). Typically resolves severity in 4–6 items
instead of 9–20. Report the saving in the UI: *"severity established in 5 of 9 items."*

Persist to `clinical_assessments` with per-item responses and mapping confidence. Normalise:
PHQ-9/27, GAD-7/21, PCL-5/80, weighted 0.4/0.3/0.3 when several are recent.

Show counsellors **the severity band and instrument name, never the bare integer** — PHQ-9 0–4
minimal, 5–9 mild, 10–14 moderate, 15–19 moderately severe, 20–27 severe. That is how it appears in
clinical practice.

---

## C5 · Digital Phenotyping & Engagement Analytics

The problem statement says *"behavioural responses and engagement patterns."* You currently analyse
content only. These are passive, zero-burden signals with real literature behind them.

Capture into `engagement_metrics` per check-in: response latency to first keystroke · message
character and word count **relative to this person's own rolling baseline** (collapsing message
length is a strong withdrawal marker) · session duration · turn count · abandonment · hour of day
and circadian drift from personal norm (a 3 a.m. check-in from a 7 p.m. person means something) ·
days since last contact versus expected cadence · missed outreach in 30 days · typing burst
variability where available (psychomotor retardation shows up as increased inter-key latency
variance).

```
engagement = 100 − clamp(0,100,
    30·missed_ratio_30d
  + 20·(1 − length_vs_own_baseline)
  + 15·abandonment_rate_30d
  + 15·(overdue_days / cadence_interval_days)
  + 10·latency_z_clamped
  + 10·(circadian_drift_hours / 12) )
```

The behavioural channel contributes `100 − engagement`.

---

## C6 · Case-Outcome Risk: Predicting Witness Hostility

**The feature that turns this from a wellness app into a justice-system instrument.** Conviction
rates under the POA Act hover around 30 %, and the dominant cause is complainants and witnesses
turning hostile or withdrawing under sustained pressure. Predicting that is a *Ministry-level*
outcome, not a mental-health nicety, and no competing team will have it.

Compute a **Case Attrition Risk** (0–100) per case from: sustained high distress, threat-signal
frequency, engagement collapse, accused bail status, months elapsed since FIR (attrition rises
sharply past 18 months), relief non-disbursement, hearing adjournment count, and whether protection
was requested but not granted.

Surface it on the counsellor and official consoles beside distress, as a distinct metric with its
own colour (violet, not the risk ramp — different concept, different hue), and wire it into the
official dashboard as *"cases at risk of collapse this quarter, by district."* Recommend the
targeted counter-intervention: witness protection, travel and maintenance under Rule 11, Special PP
engagement, or a Vigilance & Monitoring Committee escalation.

---

## C7 · Perpetrator-Proximity & Bail-Event Risk

Bail of the accused is the single most reliable intimidation trigger in atrocity cases and it is
completely absent from your model.

Add `accused_bail_status`, `bail_granted_date`, `accused_village_same_as_victim boolean`, and
`protection_order_active boolean` to `cases`. On a bail event: immediately raise the case-context
channel, schedule outreach within 24 h, auto-recommend `POA_WITNESS_PROTECT`, and notify the
assigned official. When the accused resides in the same village and no protection order is active,
apply an additional standing risk premium and flag the case as `co_residence_risk`.

Admin gets a "bail event" simulator so this is demonstrable live.

---

## C8 · Cluster & Contagion Detection

Caste atrocities are collective events. A single victim deteriorating is a clinical case; **five
victims in one village deteriorating in the same week is an ongoing intimidation campaign** and
demands a completely different response — a district-level protection operation, not five
counselling appointments.

Group cases by `(state, district, village_or_cluster_id)` and by shared FIR. Detect when mean
distress across a cluster rises more than 1.5 σ above the cluster's own 30-day baseline **and** at
least three members are affected. Raise a `cluster_alert` addressed to the District Magistrate and
SP rather than to a counsellor, recommend `POA_ATROCITY_PRONE` measures under Rule 3, and render it
on the map as a pulsing cluster marker.

This directly serves the "families affected by caste-based violence" priority use case, and it is
the kind of systems-level insight that separates first place from fifth.

---

## C9 · Forecasting with Honest Uncertainty

`services/ml-service/forecast.py`, endpoint `POST /forecast`.

1. **Trajectory** — Holt's linear exponential smoothing (`statsmodels`) over the score series with a
   prediction interval. Needs ≥ 4 points; below that fall back to the existing rules and label it.
2. **Crisis probability** — logistic regression over engineered features (current score, 3-point
   slope, EWMA, variance, consecutive elevated count, engagement, days to hearing, missed outreach,
   vocal-stress delta, bail status) predicting *any critical score within 7 days*. Train on the
   seeded longitudinal data with a temporal split.
3. **Backtest and publish the number.** MAE for the trajectory, AUC / precision / recall for the
   classifier, plus **median early-warning lead time in days** — that last figure is your headline
   metric and belongs on the landing page.

Label it plainly wherever it appears: *"Trained on synthetic longitudinal data calibrated to
published trauma-recovery trajectories. Requires prospective validation on real NHAA data before
deployment."* That sentence disarms the hardest question you will be asked.

Render as a **forecast cone**: solid history continuing into a shaded interval, crossing a dashed
crisis threshold at 76.

---

## C10 · Intervention Simulator (Counterfactual Planning)

Officials allocate scarce counsellors. Let them allocate by predicted impact.

`POST /cases/:id/simulate` takes a candidate intervention and returns the forecast **with** it
applied versus the do-nothing baseline, using effect sizes estimated from the seeded historical data
(cases that received intervention X versus matched cases that did not). Output: *"Counselling within
48 h → projected 44 on day 7 versus 78 if unattended. Estimated 34-point avoidance."*

On the official dashboard, rank the district's open cases by **predicted benefit per counsellor-hour**
and call it a *triage recommendation*. This is genuine decision support and reads as operations
research rather than a chatbot.

---

## C11 · Explainability by Construction

`GET /cases/:caseId/scores/:scoreId/explain` on the **API**, reading `score_contributions` directly.

Returns the composite arithmetic, per-channel contributions with evidence strings, the top five
features by absolute contribution, **counterfactuals** ("would fall to 51 if engagement returned to
her own baseline"), channel agreement/disagreement, model version, confidence, and an explicit
statement of what is *not* claimed.

Render as a **waterfall**: 0 → each signed contribution → final score, with plain-language sentences
beside it. Say the distinction out loud in the pitch: this is the arithmetic that produced the
score, not a second model asked to rationalise the first. Most competing teams will have the second
kind and will not realise the difference matters.

Rewrite the ML `/explain` to delegate here, or deprecate it.

---

## C12 · POA Act Statutory Intervention Engine

Seed `intervention_catalog` with real entitlements. Specificity here is what separates a government
tool from a wellness app.

| Code | Title | Statutory basis | Authority | SLA |
|---|---|---|---|---|
| `POA_RELIEF_IMMEDIATE` | Immediate monetary relief | PoA Rules 1995 r.12(4) + Annexure I | District Magistrate | 168 h |
| `POA_RELIEF_STAGED` | Staged relief on chargesheet / conviction | PoA Rules 1995 Annexure I | District Magistrate | 720 h |
| `POA_WITNESS_PROTECT` | Witness protection measures | Witness Protection Scheme 2018; PoA s.15A(8),(11) | SP / District Committee | 24 h |
| `POA_RELOCATION` | Relocation and safe accommodation | PoA Rules 1995 r.11; WPS 2018 Cat. A | District Magistrate | 72 h |
| `POA_LEGAL_AID` | Free legal representation | Legal Services Authorities Act 1987; PoA s.15A(2) | DLSA Secretary | 72 h |
| `POA_SPECIAL_PP` | Special Public Prosecutor | PoA Act 1989 s.15 | State Government | 336 h |
| `POA_TRAVEL_MAINT` | Travel and maintenance for court attendance | PoA Rules 1995 r.11(1)–(4) | District Magistrate | 48 h |
| `POA_MEDICAL` | Medical treatment and rehabilitation | PoA Rules 1995 r.12(4) proviso | CMHO / District Hospital | 24 h |
| `MHA_COUNSELLING` | Psychiatric and psychological care | Mental Healthcare Act 2017 s.18 | District Mental Health Programme | 48 h |
| `MHA_CRISIS` | Emergency mental health response | MHCA 2017 s.18; Tele-MANAS 14416 | Tele-MANAS / DMHP | 1 h |
| `POA_VM_ESCALATE` | Vigilance & Monitoring Committee escalation | PoA Rules 1995 r.16 (district) / r.17 (state) | DM / Chief Secretary | 720 h |
| `POA_ATROCITY_PRONE` | Atrocity-prone area protection | PoA Rules 1995 r.3 | SP / District Magistrate | 168 h |
| `BNSS_COMPENSATION` | Victim compensation scheme | BNSS 2023 s.396 (ex-CrPC 357A); NALSA scheme | DLSA | 720 h |

Match on risk, escalation, detected signals, case type, stage, relief delay, bail status, and
whether the same intervention is already in progress. Return the top 5 with rationale.

**Automated statutory escalation ladder.** Every recommendation carries a `due_at` from its SLA.
On breach, escalate automatically along the real chain — counsellor → District Magistrate →
District Vigilance & Monitoring Committee (Rule 16) → State Committee (Rule 17) — and log each hop.
An official screen reading *"9 relief payments past the Rule 12(4) deadline in Nagaur"* is precisely
the accountability artefact this Ministry wants and has no way to produce today.

---

## C13 · Consent, Audit Ledger, PII Redaction

**Redaction** (`apps/api/src/lib/redact.ts`) runs before any transcript leaves for Gemini: Indian
given and family names (list + the victim's own known names from the case), phone numbers,
Aadhaar-shaped digits, emails, addresses, and place names below district level, replaced with typed
placeholders `[NAME_1]`, `[PHONE]`, `[VILLAGE]` so context survives. The mapping stays local and is
never transmitted. Count redactions and display the running total in the admin console. Now the
privacy claim is verifiable rather than asserted.

**Audit** — Express middleware writing an `audit_log` row for every access to victim data: actor,
role, action, resource, case, declared purpose, SHA-256 of IP, and
`entry_hash = sha256(prev_hash ‖ canonical_json(entry))`. `GET /audit/verify` walks the chain and
reports integrity, demonstrable live. Append-only by design — no update or delete policy exists.

**Consent** — per-scope toggles that are **enforced in code, not merely recorded**. Revoking
`llm_processing` must actually route scoring through the rules path; revoking `voice_recording` must
prevent the recorder from starting. Enforcement rather than logging is the whole difference.

**Retention** — daily job dropping raw audio past 90 days and transcripts past 365 while keeping
derived scores, per the DPDP Act storage-limitation principle, with the countdown visible in the UI.

Do not use blockchain. A hash chain in Postgres is the honest and sufficient answer, and saying so
demonstrates judgement.

---

## C14 · Victim Confidence Index

The problem statement lists *"strengthened victim confidence in the justice delivery system"* as an
expected outcome. **Measure it.** Nobody else will.

A 0–100 index per case, aggregated to district and state, from: engagement continuity, sentiment
specifically toward police / courts / administration (extracted separately by Gemini from general
distress sentiment), intervention SLA adherence experienced by that person, relief actually
disbursed versus sanctioned, and hearing adjournment burden.

Plot it on the official dashboard **inversely against distress**, and expose the correlation
between SLA adherence and confidence by district. That chart is an evidence-based-policymaking
output: it shows administrators that meeting statutory deadlines measurably raises trust. It is the
single most quotable artefact you can hand a policy judge.

---

## C15 · Multilingual Reach

Extend en/hi/ta to twelve: Hindi, English, Tamil, Telugu, Marathi, Bengali, Kannada, Gujarati,
Odia, Punjabi, Malayalam, Assamese. Gemini handles generation; keep the existing code-mixed
(Hinglish/Tanglish) prompt handling. Extend the `_fallback_score()` keyword dictionary with distress
terms in each script so the offline path isn't English-only. Name **Bhashini** as the production
ASR/TTS path and mark it `ARCHITECTED` — naming the actual government stack matters in this room.

---

# PART D — THE FRONTEND

## D0 · The one rule

**No boxes.** The current landing page is four bordered cards in a row and it looks like every other
hackathon project. Delete that instinct entirely.

Hierarchy comes from **typographic scale, whitespace, and motion** — not from borders, cards, or
containers. On the marketing and victim surfaces, if you are reaching for `border rounded-xl bg-card`
you are doing it wrong. Cards are permitted **only** inside the staff consoles, where data density
genuinely requires delineation, and even there they are hairline-separated regions, not floating
elevated tiles.

Reference quality bar: Linear's marketing site, Stripe's docs home, Apple product pages. Continuous,
scroll-driven, generous, confident. Not a dashboard template.

## D1 · Two design systems, on purpose

Two populations with opposite needs. Say this out loud in the pitch — it reads as maturity, not
inconsistency.

Implement as two token blocks in `globals.css` scoped by wrapper class, `.theme-sanctuary` and
`.theme-command`, applied in the respective route-group layouts.

**SANCTUARY** — public, onboarding, and every victim surface.

```
Canvas        #FDFBF7 base, drifting mesh gradient overlay at 5–8% opacity
Ink           #14211F primary · #5A6B69 secondary · #93A19F tertiary
Teal          #0F6F65   trust, calm, clinical-adjacent but not clinical
Sand          #E8DCC8   warm neutral
Terracotta    #C97B5A   warmth and emphasis — never alarm
Sage          #6B9080   affirmation
FORBIDDEN     red · orange · numeric scores · risk words · warning glyphs
Radius        1.5rem on the rare surface that needs one; otherwise none
Shadow        almost none: 0 1px 40px rgba(15,111,101,0.05)
Display font  Fraunces (variable, optical size on) — headings only, weight 400–500, never bold
Body font     Inter — 17px minimum, 1.7 leading
Motion        400–800ms, cubic-bezier(0.22,1,0.36,1); breathing loops at 4s
```

**COMMAND** — counsellor, official, admin.

```
Canvas        #0A0E13 · #111820 elevated · #172029 raised
Hairline      #1F2B36 — 1px, the only delineation used
Cyan          #22D3EE   primary action and data
Risk ramp     #10B981 low · #F59E0B moderate · #F97316 high · #EF4444 critical
Violet        #A78BFA   escalation and attrition — a different concept needs a different hue
Ink           #E6EDF3 primary · #8B98A5 muted · #5C6B7A faint
Radius        0.375rem — instrumental, not friendly
Type          Inter with font-variant-numeric: tabular-nums globally;
              JetBrains Mono for IDs, scores, timestamps
Density       32px rows, 11px uppercase labels at 0.14em tracking
Motion        120–180ms, ease-out. Nothing decorative.
```

Add both fonts via `next/font/google` (Fraunces, Inter) and `next/font/local` or Google for
JetBrains Mono. Wire them as CSS variables in `layout.tsx`.

---

## D2 · Landing page — one continuous scroll, zero boxes

Rebuild `apps/web/src/app/page.tsx` as a scroll-driven narrative. Use `framer-motion`'s `useScroll`
and `useTransform`. Every section is full-bleed; nothing is inside a card.

**§1 Hero — 100vh.**
Mesh-gradient canvas drifting on a 24 s loop (three radial gradients in teal, sand, terracotta at
6 % opacity, animated `background-position`). Content left-aligned in a `max-w-5xl`, vertically
centred, generous top padding.
- Wordmark: `SAMVEDNA` at 11px, `tracking-[0.35em]`, tertiary ink. Beneath it in Devanagari,
  `संवेदना`, and the line *listening beyond words*.
- Headline in Fraunces, `clamp(3.5rem, 8vw, 7rem)`, leading `0.92`, weight 400:
  **"Distress leaves a trace long before a crisis."**
  Words stagger in on mount, 40 ms apart, `y: 24 → 0`, opacity `0 → 1`.
- Sub, 19px, `max-w-xl`, secondary ink: *Continuous mental-health monitoring for survivors of caste
  atrocities — across NHAA 14566, IVRS, SMS, chatbot and the Integrated Portal.*
- Actions are **text links with an animated underline**, not buttons: `Enter →` and `For officials`.
  The arrow translates 4px on hover.
- Bottom-centre: a 40px vertical hairline that pulses downward on a 2 s loop.

**§2 The living chart — sticky, 250vh of scroll.**
The thesis, told without a single word of explanation. A `position: sticky` full-viewport stage
holding one SVG line chart, ~900px wide, hairline axes only.
- Scroll 0→35 %: the line draws left-to-right via `pathLength`, climbing from 30 to 80.
- At 40 %: a small terracotta dot and the label *counselling dispatched* fade in on the curve.
- 45→75 %: the line continues but bends downward toward 40.
- A dashed horizontal rule at 76 labelled *crisis threshold*, drawn faintly the whole time — the
  climbing line visibly approaches it and then turns away.
- Left of the chart, three lines of Fraunces text crossfade with scroll progress:
  *"Every check-in leaves a signal."* → *"The signal has a direction."* → *"Direction is a warning
  you can act on."*

**§3 Capabilities — pinned type sequence, not a grid.**
Sticky viewport. Four words stacked at `clamp(2.5rem, 5vw, 4rem)` in Fraunces:
**Listen · Understand · Foresee · Protect.**
As you scroll, the active word sits at full opacity and full ink while the other three fall to 12 %
opacity. Beside the active word a single sentence fades in:
- *Listen* — twelve languages, by voice or text, on whichever channel reaches her.
- *Understand* — five signal channels, anchored to PHQ-9, GAD-7 and PCL-5.
- *Foresee* — a forecast with a stated error bar, not a claim.
- *Protect* — statutory entitlements, named authorities, and a clock on every one.

No borders. No icons in circles. Type and whitespace only.

**§4 Numbers — hairline-separated, count on view.**
Four figures in a single row on desktop, stacked on mobile, separated by nothing but whitespace and
one 1px hairline rule above the row. Each figure at `clamp(3rem, 6vw, 5rem)` in tabular numerals,
counting up from zero when it enters the viewport, with an 11px uppercase caption beneath.
Use the real backtested values, and if a value isn't real yet, do not display it.
Suggested: median early-warning lead time in days · languages supported · PII fields transmitted to
any model (`0`) · statutory entitlements mapped.

**§5 Honest capability ledger.**
A single column list, each row a hairline-separated line: a tiny left-gutter tag reading `LIVE`,
`ARCHITECTED`, or `ROADMAP` in 10px uppercase, then the capability name, then one line of detail in
secondary ink. No table borders, no cards, no badges with backgrounds. Roughly fifteen rows. This
page section is a scoring asset — judges reward the candour and it is visually calm.

**§6 Statutory footing.**
Small-caps horizontal list, tertiary ink, hairline above: *SC/ST (Prevention of Atrocities) Act 1989
· PoA Rules 1995 · Witness Protection Scheme 2018 · Mental Healthcare Act 2017 · DPDP Act 2023 ·
IT Act 2000 · BNSS 2023 s.396*.

**§7 Footer.**
Crisis numbers set large and legible, not as fine print: 112 · KIRAN 1800-599-0019 ·
Tele-MANAS 14416 · NHAA 14566. Then the disclaimer that this is decision support for authorised
professionals and not a clinical diagnosis or an emergency service.

Honour `prefers-reduced-motion` throughout: replace scroll-linked animation with immediate final
states, keep the crossfades, drop the loops.

---

## D3 · Auth screens

Split viewport. Left 45 %: the sanctuary mesh gradient with the wordmark and a single Fraunces line
of reassurance. Right 55 %: the form on plain canvas — floating-label inputs with a hairline bottom
border only, no boxes, no card wrapper. Primary action is a full-width solid teal pill. Remove the
hardcoded admin credentials from the source and read them from env in dev only.

---

## D4 · Victim surfaces (Sanctuary)

**`/victim/checkin` — the emotional centre of the demo.**
Canvas is the drifting gradient. No app chrome beyond a minimal top row.
- Opens on a **breathing orb**: a soft teal radial 180px across, scaling 1 → 1.06 over 4 s with a
  matching opacity breath, and a Fraunces line above it — *"How has today been?"* Tapping it, or
  typing, begins.
- Conversation renders as **unboxed text**, not chat bubbles. Her words in ink, right-aligned,
  Fraunces italic at 19px. Mann-Mitra's words left-aligned in Inter at 17px, secondary ink, with a
  4-second-per-100-character streaming reveal so it reads like someone typing rather than a wall
  appearing. Generous 32px vertical rhythm between turns.
- Language selection as a row of plain text pills, active one underlined — twelve options.
- Mood input is a **horizontal colour-temperature gradient slider** running from cool sage to warm
  terracotta with no numbers and no faces, labelled only at the ends (*heavy* … *lighter*).
- A persistent, low-key `I need help now` text link, always visible, opening a sheet with the crisis
  numbers and a one-tap call — no explanation required from her first.
- On completion: no score, no badge, no risk word. A Fraunces line — *"Thank you for telling me.
  Someone who cares is looking at your case."* — and, when true, the concrete thing that happened:
  *"Your counsellor has been notified."*

**`/victim/call`.** Live waveform from an `AnalyserNode`, rendered as soft teal vertical bars with
eased height transitions. A slow concentric pulse while the AI speaks. A plain-language recording
consent sheet before the first use explaining exactly what is captured, why, and for how long.

**`/victim/journey`** (replaces `/victim/history`). Not a score history — a vertical care path down
the centre of the page, hairline spine with small nodes: check-ins, calls, and **the actions taken
on her behalf**. Shows the system working for her, which is how the problem statement's "strengthened
confidence" outcome actually gets earned. Still no scores.

**`/victim/support`.** Her POA Act entitlements in plain language, each with real status — relief
sanctioned and disbursed, legal aid assigned, protection status — and what happens next. Turning
opaque statutory rights into a legible status page is genuinely useful and demos beautifully.

**`/victim/privacy`.** Consent toggles that actually take effect, the access log in plain words
(*"Counsellor Meena viewed your case on 3 September"*), retention countdowns, and data export.

---

## D5 · Staff surfaces (Command)

**`/counselor/queue`** (replaces `/counselor/cases`). A triage console, not a table page.
- Left rail: filters, and the **Gone Quiet** list pinned at the top with days-since-contact in
  mono. Disengaged cases are the most dangerous and must be the first thing seen.
- Main: a dense, keyboard-driven list. `j`/`k` to move, `Enter` to open, `a` to acknowledge, `/` to
  focus search via `cmdk`. Each row on 32px: anonymised label, risk chip, escalation bar, a 10-point
  sparkline, trend arrow, attrition-risk pip in violet, days since contact, next scheduled outreach,
  and the top recommended intervention. Rows reorder with Framer Motion `layout` when scores update
  over the socket, and new alerts flash once in their severity colour.

**`/counselor/cases/[id]`** — three columns.
*Left:* identity, POA sections, FIR, hearing countdown, relief status, bail status, consent state.
*Centre:* the **forecast cone** chart with intervention markers on the axis so action and outcome
correlate visually; then the **XAI waterfall**; then the check-in feed with per-entry expandable
explanations; then clinical instrument bands over time.
*Right:* recommended interventions as hairline-separated rows with statutory basis, authority, and an
SLA countdown ring; the outreach schedule; notes; quick actions.
*Header:* an auto-generated **pre-call brief** — three sentences a counsellor reads in ten seconds
before dialling. This is the feature a real counsellor would thank you for.

**`/official/command`** (replaces `/official/dashboard`). A genuine operations centre.
- **India choropleth** via `react-simple-maps`, coloured by mean distress, drilling national → state
  → district, with pulsing markers for C8 cluster alerts. Selecting a state filters everything below.
- KPI strip in mono: active cases, high-risk, open alerts, SLA breaches, median response time,
  Victim Confidence Index.
- **Anomaly rail** — districts rising faster than the national baseline, expressed in sigma.
- **SLA accountability table** — statutory deadlines breached, by district and provision.
- **Confidence vs SLA-adherence scatter** — the policy money-shot from C14.
- Stage funnel from complaint through investigation, trial, compensation, rehabilitation, with mean
  distress at each stage, showing where in the justice process people actually suffer most.

**`/admin`.** Restyle to Command and add: NHAA intake simulator (labelled), model health (Gemini
reachability, forecast MAE, redaction counter, ML latency), audit-chain verification with a live
pass indicator, cadence-tick and bail-event simulators for the demo, district registry.

---

## D6 · Component work

Build out the full shadcn/ui set from the already-installed Radix packages: dialog, sheet, tabs,
select, dropdown-menu, tooltip, popover, accordion, progress, separator, scroll-area, skeleton,
badge, table, switch, slider, command. Replace every native `<select>` and every `prompt()` call.

New components: `mesh-gradient.tsx`, `scroll-story.tsx`, `living-chart.tsx`, `count-up.tsx`,
`breathing-orb.tsx`, `streaming-text.tsx`, `mood-gradient.tsx`, `voice-waveform.tsx`,
`score-waterfall.tsx`, `forecast-cone.tsx`, `india-map.tsx`, `risk-sparkline.tsx`,
`attrition-pip.tsx`, `sla-ring.tsx`, `intervention-row.tsx`, `gone-quiet-rail.tsx`,
`pre-call-brief.tsx`, `clinical-band.tsx`, `consent-toggle.tsx`, `audit-trail.tsx`,
`capability-tag.tsx`, `crisis-sheet.tsx`, `cluster-marker.tsx`.

Replace every `Loading…` with a skeleton. Give every empty state a line of real copy and a next
action. Delete `incoming-call-toast.tsx`.

**Accessibility is not optional given who uses this:** WCAG AA contrast on both themes,
`aria-live="polite"` on the conversation feed, real labels on mic and speak controls, complete
keyboard paths, visible focus rings, `prefers-reduced-motion` honoured on every animation including
the breathing orb, and 17px minimum body text on victim surfaces.

---

# PART E — DEMO DATA AND DOCS

**Rewrite `scripts/seed.ts` to produce longitudinal data.** Trend, forecast, cadence, cluster and
anomaly features are all invisible without history. Generate ~60 cases across ≥8 districts in
≥4 states, each with 10–20 check-ins over 90 days, with deliberately shaped trajectories:
*deteriorating* (climbing, spiking two days before a hearing) · *recovering* (high, intervention
marker, decline) · *volatile* (oscillating on relief delays) · **silent** (engaged, then stopped
18 days ago — the Gone Quiet demo) · *stable low* (control) · *crisis* (trips the override) ·
**a five-case village cluster all rising together** (the C8 demo).

Populate voice analyses, clinical assessments, engagement metrics, outreach history including
misses, score contributions, forecasts, and bail events. Case types must match the priority use
cases: rape and gang rape, murder, grievous hurt, arson, witness intimidation, caste-based violence
against families. Use realistic POA sections and FIR numbers. Then train the C9 models on this data
and commit the metrics so the numbers shown in the UI are real and reproducible.

**Rewrite `README.md`:** purge "crime victim"; add the innovation-components table mapped to the
file implementing each; the LIVE/ARCHITECTED/ROADMAP ledger; the compliance section (DPDP 2023,
IT Act 2000, MHCA 2017 s.18, PoA Act 1989 and Rules 1995); the composite formula written out; and
model limitations stated plainly.

**Rewrite `docs/PRESENTATION.md`** as a six-minute script: landing narrative (30 s) → Hindi voice
check-in with waveform and breathing orb, noting *no score was shown to her, by design* (60 s) →
counsellor console with the live alert and the waterfall showing vocal stress plus a missed
hearing-eve outreach drove the score, not the words (60 s) → forecast cone crossing the threshold in
four days with the stated accuracy and stated limitation (60 s) → statutory interventions with SLA
clocks, one dispatched (45 s) → official map, cluster alert, SLA breach table, confidence-versus-
adherence chart (60 s) → audit chain verifying live and a consent toggle actually disabling LLM
processing (30 s) → close (15 s).

Prepare the four inevitable questions: *Is the prediction validated?* (No — backtested on synthetic
data calibrated to published trajectories, MAE and lead time stated, prospective validation design
ready.) *How is it explainable?* (The score is a weighted composite; the explanation is the
arithmetic, not a second model rationalising the first — show the waterfall.) *False positives?*
(Every alert routes to a human; the system never acts autonomously — show the threshold tuning.)
*Privacy?* (PII redacted pre-inference with a live counter, enforced granular consent, hash-chained
audit, retention limits — show `/audit/verify` and the victim privacy screen.)

**Verify:** `pnpm build` and `pnpm lint` clean across all workspaces; every demo path walked at all
three ports; Gemini's key removed to confirm full fallback operation, then restored;
`prefers-reduced-motion` confirmed.

---

# PART F — ORDER OF WORK

Phase 0 (45 min) — migration, deps, shared types.
Phase 1 (2 h 30) — C1, C2, C11, C12. The composite, cadence, explainability and statutory engine.
Phase 2 (2 h 30) — D2 landing, D4 victim surfaces, D5 counsellor queue and case view.
Phase 3 (1 h 30) — C3 voice, C9 forecast, D5 official command centre.
Phase 4 (1 h) — seed data, README, presentation, verification.
Backlog if time allows — C4, C5, C6, C7, C8, C10, C13, C14, C15.

**If the clock beats you:** ship the API contract and data model, mark it `ARCHITECTED` in the UI,
and say so in the pitch. A labelled gap costs almost nothing. A discovered overclaim costs everything.

---

# PART G — ANTI-GOALS

No scores or risk levels on victim screens. No bordered card grids on the landing or victim
surfaces. No real government API integration — it isn't available and faking it is disqualifying.
No replacing Gemini with a self-hosted model. No framework migration. No blockchain. No claim of
clinical diagnosis anywhere — this is triage decision support for authorised professionals and every
AI output carries that disclaimer. No LLM deciding autonomously about a suicide disclosure. Do not
remove the existing fallback paths.
