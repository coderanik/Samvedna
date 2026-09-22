# Samvedna — Sprint / Task Plan (PS + Krish)

## Sprint 1 — Demo spine ✅

| ID | Task | Status |
|----|------|--------|
| S1T1 | Judiciary / NHAA desk intake → invite token → victim light onboard | Done |
| S1T2 | Risk alerts → counsellor + district + official **via email** (+ socket) | Done |
| S1T3 | Auto daily 1hr counselling series for high/critical | Done |
| S1T4 | Sentiment + emotion signals + escalation forecast (LIVE + honesty) | Done |
| S1T5 | Case-type playbooks + mobile deep-link claim | Done |

## Sprint 2 — Intelligence harden ✅

| ID | Task | Status |
|----|------|--------|
| S2T1 | sklearn escalation model trained on synthetic longitudinal features | Done |
| S2T2 | Voice note upload → prosody features (librosa) | Done |
| S2T3 | Personal voice baseline after ≥3 samples | Done |
| S2T4 | Forecast cone UI honesty + counsellor copy | Done |

## Sprint 3 — Authority ops ✅

| ID | Task | Status |
|----|------|--------|
| S3T1 | District / state filter dashboards | Done |
| S3T2 | Recommendation SLA countdown + breach email | Done |
| S3T3 | Witness intimidation bail-event auto-playbook | Done |

## Sprint 4 — Mobile parity ✅

| ID | Task | Status |
|----|------|--------|
| S4T1 | Expo deep link `samvedna://onboard/[token]` | Done |
| S4T2 | Push notifications for alerts + session reminders | Done |
| S4T3 | Next counselling session + Join on Home | Done |

---

**Production rules**

- Never claim live NHAA/gov API — label desk intake as simulated connector.
- Email requires `RESEND_API_KEY` (or logs to outbox in demo).
- Predictive models carry honesty notes until prospectively validated.
- Voice baseline is personal after ≥3 samples; until then population norms.
- Apply migrations `20260905000003`–`00008` on remote Supabase (incl. `push_tokens`).
- Bail playbook is a simulated judiciary signal — not a live court feed.
- Expo push requires a physical device or Expo Go; simulators log and skip.
