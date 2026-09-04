# Samvedna — Audit & presentation build notes

## What I found (before)

Working MVP: victim check-in → Supabase → Gemini distress score → alert → counsellor/official.
Gaps vs NHAA brief: no longitudinal/escalation UI, weak prioritisation, thin official analytics, no case intelligence panel, login-only landing, no intake abstraction, interventions display-only.

## What changed (this pass)

### Database
- Migration [`supabase/migrations/20260904000001_distress_intelligence.sql`](../supabase/migrations/20260904000001_distress_intelligence.sql)
  - Extra case stages, channels, support types
  - Distress columns: trend, escalation_risk_7d, interventions, sentiment, emotions, factors, confidence

**Apply in Supabase SQL Editor** (required for full columns). Pipeline falls back to minimal score insert if columns missing.

### ML
- Richer `/score` JSON + graceful Gemini fallback
- Honest disclaimers (triage / MVP prediction)

### API
- `distress-intelligence.ts` — transparent rules for trend + escalation + priority
- Scoring: dual alerts (counsellor + official), auto support_suggestions, escalation≥70 alerts
- `GET /dashboard/summary?scope=` district|state|national
- `GET /dashboard/priority-queue`
- `PATCH /cases/:id/status`
- Timeline includes `intelligence` Reason Card payload
- `POST /intake/nhaa` simulated connector

### Frontend
- Landing story on `/`
- Counsellor priority queue + Case Intelligence
- Official charts + scope tabs
- Alert toasts with action + de-dupe
- Admin NHAA-sim intake
- Crisis notice includes 14566

## LIVE vs ARCHITECTED vs FUTURE

| LIVE | ARCHITECTED | FUTURE |
|------|-------------|--------|
| Chat/mobile check-ins + Gemini scoring | NHAA intake simulator | Live NHAA 14566 SIP/SSO |
| Trend + MVP escalation risk | Multi-channel enum | True voice stress / prosody |
| Dual alerts + interventions | Exotel webhooks | Validated predictive model |
| Priority queue + case intelligence | District/state/national rollup | SHAP XAI |
| Official charts | — | WhatsApp CSP |

## Demo script (4 min)

1. Open `/` — Detect → Understand → Predict → Intervene  
2. Victim check-in (concerning message) — score + signals  
3. Counsellor `:3001` — priority queue + realtime toast  
4. Case intelligence — why / trend / escalation / interventions  
5. Official dashboard — risk + stage charts  
6. Admin — NHAA-sim intake + assign  

Admin: `admin@samvedna.demo` / `SamvednaAdmin@2024`
