# SAMVEDNA — System Architecture

This document reproduces the layered, colour-coded, swimlane-style architecture of your reference diagram, mapped onto the mental-health monitoring problem. Diagram 0 is the **master architecture** (the direct analogue of the picture: coloured functional zones on the left/centre, a vertical **Security & Compliance rail** on the right, dashed control/audit flows crossing zones). Diagrams 1–7 zoom into each zone.

All diagrams are Mermaid — they render in Cursor/GitHub/Notion, and can be pasted into [mermaid.live](https://mermaid.live) to export SVG/PNG for a slide deck, or imported into draw.io via *Arrange → Insert → Advanced → Mermaid*.

---

## Zone legend (matches the reference diagram's colour language)

| Zone | Colour | Name | Role |
|---|---|---|---|
| ① | Orange | **Omnichannel Engagement Layer** | How we reach the victim — IVRS, SMS, WhatsApp, app, portal, field worker |
| ② | Green | **Victim Experience & Edge Layer** | Mobile/web clients, on-device inference, consent, panic, offline buffer |
| ③ | Purple | **AI Distress Intelligence Core** | ASR, NLP, voice stress, behavioural mining, fusion, DDS, forecasting, XAI |
| ④ | Blue | **Identity, Consent & Trust Ledger** | Pseudonymous ID, consent artifacts, permissioned ledger, encrypted vault |
| ⑤ | Cyan | **Command, Care & Governance Layer** | Counsellor console, district/state/national dashboards, govt integrations |
| ⑥ | Red | **Security, Privacy & Compliance Rail** | Crypto, SIEM, DPDP, RBAC, audit, retention, ethics — cross-cuts every zone |

---

## Diagram 0 — MASTER ARCHITECTURE

```mermaid
flowchart LR

%% ─────────────────────────── ZONE 1: OMNICHANNEL ENGAGEMENT ───────────────────────────
subgraph Z1["① OMNICHANNEL ENGAGEMENT LAYER"]
  direction TB
  N1["NHAA 14566 Helpline<br/>+ IVRS Outbound Campaign"]
  N2["SMS / USSD / Missed-Call<br/>for feature phones"]
  N3["WhatsApp / Telegram / RCS<br/>Chatbot"]
  N4["Field Counsellor Tablet<br/>offline-first"]
  N5["Asterisk / FreeSWITCH<br/>Telephony Gateway + SBC"]
  N6["Channel Normaliser<br/>one schema for all channels"]
  N7["Store-and-Forward Buffer<br/>network loss / 2G areas"]

  N1 -- "voice call audio 8 kHz" --> N5
  N2 -- "short text responses" --> N6
  N3 -- "chat turns + voice notes" --> N6
  N4 -- "in-person assessment" --> N7
  N5 -- "RTP stream + call metadata" --> N6
  N7 -- "sync on reconnect" --> N6
end

%% ─────────────────────────── ZONE 2: VICTIM EXPERIENCE / EDGE ───────────────────────────
subgraph Z2["② VICTIM EXPERIENCE & EDGE LAYER"]
  direction TB
  M1["Flutter Mobile App<br/>Victim + Counsellor builds"]
  M2["Next.js Integrated Web Portal"]
  M3["On-Device TFLite Pre-Screen<br/>tone + typing dynamics"]
  M4["Consent & Preference Manager<br/>DPDP consent artifact"]
  M5["Panic Button + Duress Safe-Word"]
  M6["Stealth Mode UI<br/>disguised app skin"]
  M7["Offline SQLite Queue<br/>encrypted at rest"]

  M1 --> M3
  M1 --> M4
  M1 --> M5
  M1 --> M6
  M1 --> M7
  M2 --> M4
end

%% ─────────────────────────── ZONE 3: AI DISTRESS INTELLIGENCE CORE ───────────────────────────
subgraph Z3["③ AI DISTRESS INTELLIGENCE CORE"]
  direction TB

  K1["Kafka / Redpanda<br/>Event Backbone"]
  K2["Flink Streaming<br/>Feature Computation"]
  K3["Feast Feature Store<br/>online + offline"]

  subgraph Z3A["MANN-MITRA · Conversational AI"]
    C1["Dialogue Orchestrator<br/>LangGraph + Rasa"]
    C2["Adaptive Instrument Engine<br/>PHQ-9 / GAD-7 / PSS-10 / C-SSRS via CAT"]
    C3["Indic TTS + Barge-in"]
  end

  subgraph Z3B["MULTIMODAL PERCEPTION"]
    P1["ASR — IndicConformer / IndicWhisper<br/>22 languages + code-mixed"]
    P2["SWAR — Voice Stress Analytics<br/>eGeMAPS + WavLM embeddings"]
    P3["BHAV — Indic NLP<br/>MuRIL: sentiment, emotion, ideation, threat"]
    P4["SANKET — Behavioural Signals<br/>latency, drop-off, missed calls, sleep-hour usage"]
    P5["NYAYA-PATRA — Case Context<br/>hearings, bail, adjournments, compensation delay"]
  end

  subgraph Z3C["FUSION · SCORING · FORECAST"]
    F1["Cross-Attention Multimodal Fusion<br/>modality-dropout robust"]
    F2["MANOBAL SCORE Engine<br/>Dynamic Distress Score 0-100"]
    F3["Longitudinal Analyser<br/>trend slope, volatility, CUSUM change-point"]
    F4["PURVABHAS Forecaster<br/>TFT + Cox survival: P crisis in 7/14/30 days"]
    F5["PARDARSHI XAI<br/>SHAP + attention + counterfactual Reason Card"]
  end

  T1["Threshold & Risk-Band Engine<br/>+ alert-fatigue damping"]

  K1 --> K2 --> K3
  K3 --> P2 & P3 & P4 & P5
  C1 --> C2 --> C3
  C1 -- "transcribed turns" --> P1
  P1 --> P3
  P2 --> F1
  P3 --> F1
  P4 --> F1
  P5 --> F1
  F1 --> F2 --> F3 --> F4
  F2 --> F5
  F4 --> F5
  F4 --> T1
  F2 --> T1
end

%% ─────────────────────────── ZONE 4: IDENTITY, CONSENT & TRUST LEDGER ───────────────────────────
subgraph Z4["④ IDENTITY, CONSENT & TRUST LEDGER"]
  direction TB
  B1["Keycloak OIDC<br/>victim, counsellor, officer realms"]
  B2["Pseudonymous Victim ID<br/>salted hash, no PII in ML store"]
  B3["Hyperledger Fabric<br/>permissioned, Raft ordering"]
  B4["Chaincode: Consent Artifact<br/>grant / scope / withdraw"]
  B5["Chaincode: Alert Acknowledgement SLA<br/>who saw it, when, what was done"]
  B6["Encrypted Vault<br/>MinIO + envelope encryption"]
  B7["Merkle Audit Root<br/>daily anchoring"]

  B1 --> B2
  B2 --> B3
  B3 --> B4
  B3 --> B5
  B4 --> B7
  B5 --> B7
  B2 --> B6
end

%% ─────────────────────────── ZONE 5: COMMAND, CARE & GOVERNANCE ───────────────────────────
subgraph Z5["⑤ COMMAND, CARE & GOVERNANCE LAYER"]
  direction TB
  D1["PRAHARI — Alert & Escalation Orchestrator<br/>Tier 1 / Tier 2 / Code Red"]
  D2["SAHARA — Intervention Recommender<br/>contextual bandit + statutory rule overlay"]
  D3["Counsellor Console<br/>DDS trend, transcript, Reason Card, safety plan"]
  D4["DRISHTI District Dashboard<br/>prioritised queue, heatmap, SLA breach"]
  D5["DRISHTI State Dashboard<br/>hotspots, scheme efficacy, caseload"]
  D6["DRISHTI National Dashboard<br/>policy analytics, cohort outcomes, digital twin"]
  D7["Notification Fabric<br/>SMS, WhatsApp, push, auto-dial, email"]
  D8["Govt System Connectors<br/>CCTNS/ICJS, e-Courts, PoA MIS, NALSA, Tele-MANAS, PFMS, 112 ERSS"]
  D9["OpenSearch + ELK<br/>traceability & case audit trail"]

  D1 --> D2
  D1 --> D7
  D2 --> D3
  D3 --> D4 --> D5 --> D6
  D8 --> D4
  D1 --> D9
end

%% ─────────────────────────── ZONE 6: SECURITY & COMPLIANCE RAIL ───────────────────────────
subgraph Z6["⑥ SECURITY, PRIVACY & COMPLIANCE RAIL — KAVACH"]
  direction TB
  S1["DPDP Act 2023<br/>consent, purpose limitation, erasure"]
  S2["AES-256-GCM at rest<br/>TLS 1.3 in transit"]
  S3["HashiCorp Vault + HSM<br/>key custody, field-level crypto"]
  S4["OPA / ABAC<br/>purpose-bound, break-glass logged"]
  S5["SIEM — Wazuh / Splunk<br/>UEBA on official access"]
  S6["Differential Privacy<br/>+ k-anonymity on dashboards"]
  S7["Retention Engine<br/>raw audio purged after 72 h"]
  S8["Bias & Fairness Monitor<br/>subgroup metrics, model cards"]
  S9["Human-in-the-Loop Gate<br/>no automated adverse decision"]
end

%% ─────────────────────────── PRIMARY DATA FLOWS ───────────────────────────
Z1 == "normalised interaction events" ==> K1
Z2 == "app telemetry, self-reports, panic" ==> K1
C3 -. "outbound check-in call / message" .-> Z1
D7 -. "schedules next interaction" .-> Z1
T1 == "risk-band crossing event" ==> D1
D2 == "recommended intervention set" ==> D7
Z4 -. "identity resolution + consent check" .-> K1
Z4 -. "consent scope gate" .-> Z3
D1 -. "write acknowledgement to ledger" .-> B5
Z5 -. "verify audit trail" .-> B7

%% ─────────────────────────── CROSS-CUTTING COMPLIANCE (dashed, like the reference) ───────────────────────────
Z6 -. "encrypt at rest and in transit" .-> Z1
Z6 -. "consent gate + purpose binding" .-> Z2
Z6 -. "DP noise, feature-only retention" .-> Z3
Z6 -. "key custody + ledger anchoring" .-> Z4
Z6 -. "RBAC, UEBA, k-anonymity" .-> Z5

%% ─────────────────────────── STYLES ───────────────────────────
classDef zone1 fill:#FDEBD3,stroke:#E8A33D,stroke-width:1px,color:#4A3212
classDef zone2 fill:#DFF3E2,stroke:#4FA463,stroke-width:1px,color:#1E3E27
classDef zone3 fill:#F1DDF7,stroke:#A45FC0,stroke-width:1px,color:#3D1B4A
classDef zone4 fill:#DCE4F8,stroke:#5B7BD5,stroke-width:1px,color:#1C2B52
classDef zone5 fill:#D6F1F6,stroke:#3FA5BC,stroke-width:1px,color:#123A44
classDef zone6 fill:#FADEDE,stroke:#D06565,stroke-width:1px,color:#4A1A1A

class Z1,N1,N2,N3,N4,N5,N6,N7 zone1
class Z2,M1,M2,M3,M4,M5,M6,M7 zone2
class Z3,Z3A,Z3B,Z3C,K1,K2,K3,C1,C2,C3,P1,P2,P3,P4,P5,F1,F2,F3,F4,F5,T1 zone3
class Z4,B1,B2,B3,B4,B5,B6,B7 zone4
class Z5,D1,D2,D3,D4,D5,D6,D7,D8,D9 zone5
class Z6,S1,S2,S3,S4,S5,S6,S7,S8,S9 zone6
```

---

## Diagram 1 — ① Omnichannel Engagement Layer (detail)

The hardest constraint in this problem is that a large share of beneficiaries under the SC/ST (PoA) Act are rural, low-literacy, and on feature phones. The channel strategy must degrade gracefully all the way down to a **missed call**.

```mermaid
flowchart TB
  subgraph CH["CHANNEL TIERS — graceful degradation"]
    direction LR
    T1["TIER A — Smartphone<br/>Flutter app, WhatsApp bot, web portal<br/>rich: voice notes, video counselling, self-report"]
    T2["TIER B — Any phone with SMS<br/>SMS check-in, USSD menu, IVRS outbound<br/>voice + DTMF responses"]
    T3["TIER C — No literacy / no network<br/>Missed-call trigger, ASHA / Panchayat volunteer<br/>tablet-assisted in-person assessment"]
  end

  T1 & T2 & T3 --> GW

  subgraph GW["INGESTION GATEWAY"]
    direction TB
    G1["Kamailio SBC + Asterisk / FreeSWITCH<br/>SIP trunk to 14566"]
    G2["Meta WhatsApp Business API / Gupshup"]
    G3["SMS Gateway — DLT-compliant templates"]
    G4["REST + WebSocket API Gateway — Kong"]
    G5["Channel Normaliser<br/>InteractionEvent v1 schema"]
    G6["Consent Pre-Check<br/>reject if scope withdrawn"]
    G7["Store-and-Forward Buffer — Redis + WAL"]
    G1 & G2 & G3 & G4 --> G5 --> G6 --> G7
  end

  GW == "InteractionEvent" ==> KAF["Kafka topic: interactions.raw"]

  subgraph SCHED["INTERACTION SCHEDULER"]
    direction TB
    Q1["Adaptive Cadence Policy<br/>Green 14d · Yellow 7d · Orange 72h · Red 24h"]
    Q2["Do-Not-Disturb & Safety Window<br/>never call when perpetrator likely present"]
    Q3["Language / dialect / gender-of-voice preference"]
    Q4["Frequency Cap — anti re-traumatisation"]
    Q1 --> Q2 --> Q3 --> Q4
  end

  SCHED -. "trigger outbound" .-> GW

  classDef a fill:#FDEBD3,stroke:#E8A33D,color:#4A3212
  class CH,GW,SCHED,T1,T2,T3,G1,G2,G3,G4,G5,G6,G7,Q1,Q2,Q3,Q4 a
```

---

## Diagram 2 — ③ AI Distress Intelligence Core (detail pipeline)

```mermaid
flowchart LR
  IN["InteractionEvent<br/>audio · text · DTMF · telemetry"] --> RT{"Modality<br/>Router"}

  RT -- audio --> A1["VAD + Diarisation<br/>Silero VAD + pyannote"]
  A1 --> A2["ASR — IndicConformer<br/>WER-aware confidence"]
  A1 --> A3["SWAR Acoustic Features<br/>eGeMAPSv02 88-dim + WavLM 768-dim"]
  A3 --> A4["Voice Stress Head<br/>arousal · tension · vocal fatigue · tremor"]

  RT -- text --> B1["Language ID + Transliteration<br/>code-mixed Hinglish normalisation"]
  A2 --> B1
  B1 --> B2["BHAV Multi-Task MuRIL Head"]
  B2 --> B3["Sentiment 3-class"]
  B2 --> B4["Emotion 11-class<br/>incl. shame, guilt, hopelessness"]
  B2 --> B5["Ideation Classifier<br/>C-SSRS-aligned, high-recall"]
  B2 --> B6["Threat / Intimidation Detector"]

  RT -- telemetry --> C1["SANKET Behavioural Features<br/>response latency · session abandonment ·<br/>missed-call streak · 2-5am activity ·<br/>typing speed variance · answer-length decay"]

  RT -- "case events" --> D1["NYAYA-PATRA Context Features<br/>days-to-hearing · adjournment count ·<br/>accused bail status · witness hostility ·<br/>compensation stage delay · relocation status"]

  A4 & B3 & B4 & B5 & B6 & C1 & D1 --> FUSE["Cross-Attention Fusion<br/>+ modality dropout + missing-mask"]

  FUSE --> DDS["MANOBAL SCORE<br/>DDS 0-100 with 5 sub-indices"]
  DDS --> TREND["Longitudinal Analyser<br/>slope · volatility · CUSUM change-point"]
  TREND --> FC["PURVABHAS<br/>TFT 7/14/30-day forecast<br/>+ Cox time-varying hazard"]
  DDS --> XAI["PARDARSHI Reason Card"]
  FC --> XAI
  FC --> TH{"Risk Band<br/>Threshold Engine"}
  XAI --> TH
  TH -- "band crossed OR forecast > τ" --> ALERT["PRAHARI Alert"]
  TH -- "stable" --> LOOP["Reschedule next check-in"]

  classDef p fill:#F1DDF7,stroke:#A45FC0,color:#3D1B4A
  class IN,RT,A1,A2,A3,A4,B1,B2,B3,B4,B5,B6,C1,D1,FUSE,DDS,TREND,FC,XAI,TH,ALERT,LOOP p
```

---

## Diagram 3 — Alert escalation & intervention (Zone ⑤ detail)

```mermaid
flowchart TB
  A["DDS band crossing / forecast breach"] --> TRI["PRAHARI Triage<br/>de-duplicate · suppress if open alert · confidence gate"]

  TRI --> L1{"Severity"}

  L1 -- "Yellow · Watch" --> Y["Auto-schedule earlier check-in<br/>psychoeducation nudge · self-help content<br/>no human alert"]
  L1 -- "Orange · Elevated" --> O["TIER 1: District Counsellor<br/>SLA 4 hours · call-back task created"]
  L1 -- "Red · High" --> R["TIER 2: District Nodal Officer + DSP + DLSA<br/>SLA 1 hour · case flagged priority in PoA MIS"]
  L1 -- "Crimson · Code Red" --> CR["TIER 3: CRISIS<br/>SLA 15 minutes"]

  CR --> CR1["Immediate crisis-counsellor outbound call"]
  CR --> CR2["Warm transfer to Tele-MANAS 14416"]
  CR --> CR3["Police welfare check via 112 ERSS"]
  CR --> CR4["Notify District Magistrate + SP + State cell"]

  O & R & CR --> ACK{"Acknowledged<br/>within SLA?"}
  ACK -- no --> ESC["Auto-escalate one tier<br/>+ write breach to ledger<br/>+ surface on State dashboard"]
  ACK -- yes --> SAH["SAHARA Intervention Recommender"]

  SAH --> I1["Counselling — tele / in-person / trauma-informed CBT"]
  SAH --> I2["Medical / psychiatric referral — ABDM linked"]
  SAH --> I3["Witness Protection Scheme 2018<br/>threat assessment request"]
  SAH --> I4["Relocation & safe-house support"]
  SAH --> I5["Compensation expedite — PoA Rules 1995 Rule 12(4)"]
  SAH --> I6["Legal aid — NALSA / DLSA panel lawyer"]
  SAH --> I7["Livelihood & rehabilitation scheme linkage"]

  I1 & I2 & I3 & I4 & I5 & I6 & I7 --> OUT["Outcome captured → active-learning label<br/>→ retrain SAHARA + recalibrate thresholds"]

  classDef c fill:#D6F1F6,stroke:#3FA5BC,color:#123A44
  class A,TRI,L1,Y,O,R,CR,CR1,CR2,CR3,CR4,ACK,ESC,SAH,I1,I2,I3,I4,I5,I6,I7,OUT c
```

---

## Diagram 4 — ④ Consent, identity & tamper-evident audit

```mermaid
flowchart LR
  V["Victim registers via 14566 / portal / FIR linkage"] --> ID["Pseudonymous ID<br/>VID = HMAC-SHA256 of case-id + salt in HSM"]
  ID --> SPLIT{"Data Split at source"}
  SPLIT -- "PII vault: name, phone, address, caste category" --> VAULT["PII Store — Postgres + pgcrypto<br/>field-level encryption, RLS"]
  SPLIT -- "signals only: features, scores, transcripts" --> MLDB["ML Store — keyed by VID only<br/>no direct identifiers"]

  V --> CON["Consent Capture<br/>voice-recorded in own language + e-sign"]
  CON --> CART["Consent Artifact<br/>scope · channels · cadence · sharing · expiry"]
  CART --> CC["Chaincode: ConsentRegistry"]

  ACC["Any read of victim data"] --> OPA["OPA Policy Check<br/>role + purpose + consent scope + case linkage"]
  OPA -- allow --> LOG["Append access record"]
  OPA -- deny --> DENY["Blocked · anomaly to SIEM"]
  LOG --> CH["Hyperledger Fabric channel"]
  CC --> CH
  ACKL["Officer alert acknowledgement + action taken"] --> CH
  CH --> MERK["Daily Merkle root<br/>published to State CISO + oversight body"]

  WD["Victim withdraws consent"] --> CC
  CC -. "propagate revocation" .-> MLDB
  CC -. "purge derived features" .-> MLDB

  classDef b fill:#DCE4F8,stroke:#5B7BD5,color:#1C2B52
  class V,ID,SPLIT,VAULT,MLDB,CON,CART,CC,ACC,OPA,LOG,DENY,CH,ACKL,MERK,WD b
```

---

## Diagram 5 — Deployment topology

```mermaid
flowchart TB
  subgraph EDGE["DISTRICT EDGE — optional, for low-connectivity districts"]
    E1["Local IVRS PoP"]
    E2["Cached content + offline sync"]
  end

  subgraph STATE["STATE DATA CENTRE — GPU zone, data localised"]
    direction TB
    S1["ASR + SWAR inference on A100 / L40S<br/>raw audio never leaves the state"]
    S2["State Kafka cluster"]
    S3["Federated Learning Client<br/>sends DP-noised gradients only"]
    S4["State dashboard services"]
  end

  subgraph NATIONAL["NATIONAL CLOUD — NIC MeghRaj / GI Cloud"]
    direction TB
    C1["Kubernetes — multi-AZ, Istio, ArgoCD"]
    C2["Federated Aggregation Server"]
    C3["Model Registry — MLflow + Triton"]
    C4["National DRISHTI dashboard + policy analytics"]
    C5["Hyperledger Fabric orderer + peers"]
    C6["Central Postgres / Timescale / OpenSearch — encrypted"]
  end

  subgraph DR["DR SITE — different seismic zone"]
    R1["Warm standby, RPO 5 min, RTO 30 min"]
  end

  EDGE --> STATE
  S3 -- "encrypted gradients" --> C2
  S4 --> C4
  S2 -. "aggregated, k-anonymised metrics only" .-> C6
  C2 --> C3 -. "updated global model" .-> S1
  NATIONAL --> DR

  classDef g fill:#EDEDED,stroke:#888,color:#222
  class EDGE,STATE,NATIONAL,DR,E1,E2,S1,S2,S3,S4,C1,C2,C3,C4,C5,C6,R1 g
```

---

## Diagram 6 — End-to-end sequence of a single check-in

```mermaid
sequenceDiagram
  autonumber
  participant SCH as Interaction Scheduler
  participant IVR as IVRS / Mann-Mitra
  participant V as Victim
  participant ING as Ingestion Bus
  participant AI as Distress Core
  participant PR as Prahari
  participant CN as Counsellor
  participant LG as Trust Ledger

  SCH->>IVR: due for check-in, band=Orange, lang=Bhojpuri, safe-window 11:00-13:00
  IVR->>LG: verify active consent scope
  LG-->>IVR: consent valid, voice-analysis allowed
  IVR->>V: outbound call, warm multilingual greeting
  V-->>IVR: spoken responses + 3 adaptive CAT items
  IVR->>ING: audio chunks, DTMF, call metadata, latency telemetry
  ING->>AI: normalised InteractionEvent
  AI->>AI: ASR, SWAR voice stress, BHAV emotion, SANKET behaviour, NYAYA-PATRA context
  AI->>AI: fusion, DDS = 78, trend +21 in 14 days, P(crisis 14d) = 0.62
  AI->>AI: PARDARSHI Reason Card generated
  AI->>PR: risk-band crossing Orange to Red
  PR->>PR: dedupe, confidence gate, resource-aware routing
  PR->>CN: Tier 2 alert with Reason Card, SLA 1 hour
  PR->>LG: alert issued, hash anchored
  CN-->>PR: acknowledged in 22 min, home visit scheduled
  PR->>LG: acknowledgement + action recorded
  CN->>AI: clinician label — true positive, severity confirmed
  AI->>AI: active-learning buffer, threshold recalibration
  AI->>SCH: raise cadence to 24h, unlock crisis playbook
```

---

## Diagram 7 — Data lifecycle & retention

```mermaid
flowchart LR
  RAW["Raw audio / chat"] -- "≤ 72 h, encrypted, access-logged" --> FEAT["Derived features<br/>eGeMAPS vectors, embeddings"]
  RAW -- "auto-purge job" --> DEL1["Cryptographic erasure"]
  FEAT -- "retained for model + clinical continuity" --> SCORE["DDS time series"]
  TRANS["Transcript"] -- "PII-redacted via Indic NER" --> RTRANS["Redacted transcript<br/>counsellor-visible only"]
  SCORE --> DASH["Dashboards<br/>k-anonymity ≥ 5, DP noise on exports"]
  SCORE -- "case closed + 1 year<br/>or consent withdrawn" --> DEL2["Erasure with ledger proof-of-deletion"]
  FEAT --> FL["Federated training<br/>DP-SGD, ε budget tracked"]

  classDef d fill:#FADEDE,stroke:#D06565,color:#4A1A1A
  class RAW,FEAT,DEL1,SCORE,TRANS,RTRANS,DASH,DEL2,FL d
```

---

## Architectural principles (the "why" behind the shape)

1. **Channel-agnostic core.** Every channel collapses into one `InteractionEvent` schema before it touches intelligence. Adding a new channel (RCS, a kiosk, a Panchayat volunteer app) is a connector, not a redesign.
2. **Signals over answers.** The system must work even when the victim says nothing. Passive engagement telemetry is a first-class input, not a fallback.
3. **Data gravity is local.** Raw audio and PII stay in the state; only DP-noised gradients and k-anonymised aggregates travel to the national tier. This is both a privacy control and a bandwidth control.
4. **Every score is a claim that must be defended.** No alert leaves the system without a Reason Card. If we cannot explain it, we do not fire it.
5. **Consent is a runtime object, not a checkbox at signup.** Scope is evaluated on every read, and revocation propagates to derived features.
6. **The human is the decision-maker.** The AI ranks, explains and reminds. It never denies, closes, or downgrades a case on its own.
7. **Fail safe, not silent.** Missing modality, low ASR confidence, or a model timeout must bias the system toward *escalating to a human*, never toward marking the victim as fine.
