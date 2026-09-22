import type { UserRole } from "@samvedna/shared-types";

/** Same ids as apps/web/src/lib/demo-fallback.ts */
export const IDS = {
  admin: "11111111-1111-4111-8111-111111111111",
  counsellor1: "22222222-2222-4222-8222-222222222221",
  counsellor2: "22222222-2222-4222-8222-222222222222",
  victim1: "33333333-3333-4333-8333-333333333331",
  victim3: "33333333-3333-4333-8333-333333333333",
  victim4: "33333333-3333-4333-8333-333333333334",
  official: "44444444-4444-4444-8444-444444444444",
  case1: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  case2: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  case3: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  case4: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
};

export type DemoUser = {
  id: string;
  email: string;
  role: UserRole;
  full_name: string;
  preferred_language: string;
  phone_number: string | null;
};

export const DEMO_USERS: DemoUser[] = [
  {
    id: IDS.admin,
    email: "admin@samvedna.demo",
    role: "admin",
    full_name: "System Admin",
    preferred_language: "en",
    phone_number: null,
  },
  {
    id: IDS.counsellor1,
    email: "counsellor1@samvedna.demo",
    role: "counsellor",
    full_name: "Dr. Priya Sharma",
    preferred_language: "hi",
    phone_number: "+919876543211",
  },
  {
    id: IDS.counsellor2,
    email: "counsellor2@samvedna.demo",
    role: "counsellor",
    full_name: "Dr. Ananya Iyer",
    preferred_language: "ta",
    phone_number: "+919876543212",
  },
  {
    id: IDS.victim1,
    email: "victim1@samvedna.demo",
    role: "victim",
    full_name: "Meera Devi",
    preferred_language: "hi",
    phone_number: "+919800000001",
  },
  {
    id: IDS.victim3,
    email: "victim3@samvedna.demo",
    role: "victim",
    full_name: "Sunita Yadav",
    preferred_language: "hi",
    phone_number: "+919800000003",
  },
  {
    id: IDS.victim4,
    email: "victim4@samvedna.demo",
    role: "victim",
    full_name: "Fatima Khan",
    preferred_language: "en",
    phone_number: "+919800000004",
  },
  {
    id: IDS.official,
    email: "official@samvedna.demo",
    role: "official",
    full_name: "District Desk Officer",
    preferred_language: "en",
    phone_number: "+919811111111",
  },
];

function ago(hours: number) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function profile(id: string) {
  const user = DEMO_USERS.find((u) => u.id === id)!;
  return {
    id: user.id,
    role: user.role,
    full_name: user.full_name,
    preferred_language: user.preferred_language,
    phone_number: user.phone_number,
    created_at: "2026-01-10T08:00:00.000Z",
    onboarding_completed_at: "2026-01-15T08:00:00.000Z",
  };
}

function score(partial: {
  id: string;
  checkin_id: string;
  case_id: string;
  score: number;
  risk_level: "low" | "moderate" | "high" | "critical";
  trend_direction: "rising" | "stable" | "improving";
  escalation_risk_7d: number;
  created_at: string;
  reasoning: string;
}) {
  return {
    ...partial,
    signals_detected: ["sleep disruption", "fear of hearing", "social withdrawal"],
    sentiment: partial.risk_level === "low" ? "cautious" : "distressed",
    emotion_indicators: ["fear", "exhaustion"],
    contributing_factors: ["upcoming hearing", "intimidation near home"],
    model_confidence: "medium",
    prediction_method: "demo-fallback",
    recommended_interventions: [
      { type: "counselling", description: "Priority check-in before the hearing." },
    ],
  };
}

const SCORES = [
  score({
    id: "score-1",
    checkin_id: "chk-1",
    case_id: IDS.case1,
    score: 78,
    risk_level: "high",
    trend_direction: "rising",
    escalation_risk_7d: 74,
    created_at: ago(6),
    reasoning: "Fear and sleep loss increased ahead of the hearing.",
  }),
  score({
    id: "score-1b",
    checkin_id: "chk-1b",
    case_id: IDS.case1,
    score: 61,
    risk_level: "high",
    trend_direction: "rising",
    escalation_risk_7d: 62,
    created_at: ago(30),
    reasoning: "Elevated distress with some family support.",
  }),
  score({
    id: "score-1c",
    checkin_id: "chk-1c",
    case_id: IDS.case1,
    score: 48,
    risk_level: "moderate",
    trend_direction: "stable",
    escalation_risk_7d: 40,
    created_at: ago(72),
    reasoning: "Moderate worry, still engaging with check-ins.",
  }),
  score({
    id: "score-3",
    checkin_id: "chk-3",
    case_id: IDS.case3,
    score: 91,
    risk_level: "critical",
    trend_direction: "rising",
    escalation_risk_7d: 88,
    created_at: ago(20),
    reasoning: "Critical distress and missed outreach.",
  }),
  score({
    id: "score-2",
    checkin_id: "chk-2",
    case_id: IDS.case2,
    score: 44,
    risk_level: "moderate",
    trend_direction: "stable",
    escalation_risk_7d: 33,
    created_at: ago(18),
    reasoning: "Steady moderate distress during trial.",
  }),
  score({
    id: "score-4",
    checkin_id: "chk-4",
    case_id: IDS.case4,
    score: 22,
    risk_level: "low",
    trend_direction: "improving",
    escalation_risk_7d: 12,
    created_at: ago(10),
    reasoning: "Coping language and recent support.",
  }),
];

type DemoCase = {
  id: string;
  victim_id: string;
  case_number: string;
  case_type: string;
  status: string;
  assigned_counsellor_id: string;
  assigned_official_id: null;
  district: string;
  state: string;
  created_at: string;
  priority_score: number;
  recommended_action: string;
  anonymised_label: string;
  attrition_risk: number;
  gone_quiet: boolean;
};

const CASES: DemoCase[] = [
  {
    id: IDS.case1,
    victim_id: IDS.victim1,
    case_number: "SAM-2024-001",
    case_type: "Atrocity Act — SC/ST",
    status: "investigation",
    assigned_counsellor_id: IDS.counsellor1,
    assigned_official_id: null,
    district: "Jaipur",
    state: "Rajasthan",
    created_at: ago(24 * 40),
    priority_score: 86,
    recommended_action: "Priority counselling + follow-up",
    anonymised_label: "M. D.",
    attrition_risk: 28,
    gone_quiet: false,
  },
  {
    id: IDS.case2,
    victim_id: IDS.victim4,
    case_number: "SAM-2024-002",
    case_type: "Domestic violence",
    status: "trial",
    assigned_counsellor_id: IDS.counsellor2,
    assigned_official_id: null,
    district: "Chennai",
    state: "Tamil Nadu",
    created_at: ago(24 * 25),
    priority_score: 41,
    recommended_action: "Continue monitoring",
    anonymised_label: "F. K.",
    attrition_risk: 15,
    gone_quiet: false,
  },
  {
    id: IDS.case3,
    victim_id: IDS.victim3,
    case_number: "SAM-2024-003",
    case_type: "Sexual assault",
    status: "investigation",
    assigned_counsellor_id: IDS.counsellor1,
    assigned_official_id: null,
    district: "Lucknow",
    state: "Uttar Pradesh",
    created_at: ago(24 * 18),
    priority_score: 97,
    recommended_action: "Immediate counsellor call",
    anonymised_label: "S. Y.",
    attrition_risk: 71,
    gone_quiet: true,
  },
  {
    id: IDS.case4,
    victim_id: IDS.victim4,
    case_number: "SAM-2024-004",
    case_type: "Protection follow-up",
    status: "rehabilitation",
    assigned_counsellor_id: IDS.counsellor2,
    assigned_official_id: null,
    district: "Pune",
    state: "Maharashtra",
    created_at: ago(24 * 12),
    priority_score: 24,
    recommended_action: "Continue monitoring",
    anonymised_label: "F. K.",
    attrition_risk: 9,
    gone_quiet: false,
  },
];

function latestScore(caseId: string) {
  return SCORES.filter((s) => s.case_id === caseId).sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  )[0];
}

function enrichCase(c: DemoCase) {
  const latest = latestScore(c.id);
  return {
    ...c,
    victim: profile(c.victim_id),
    assigned_counsellor: profile(c.assigned_counsellor_id),
    assigned_official: null,
    latest_score: latest ?? null,
    trend_direction: latest?.trend_direction ?? "stable",
    escalation_risk_7d: latest?.escalation_risk_7d ?? 0,
    hours_since_interaction: latest
      ? Math.round((Date.now() - new Date(latest.created_at).getTime()) / 36e5)
      : null,
  };
}

export function isDemoFallback() {
  if (process.env.DEMO_FALLBACK === "0") return false;
  if (process.env.DEMO_FALLBACK === "1") return true;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return !url || url.includes("your-project");
}

export function demoUserFromToken(token: string): DemoUser | null {
  if (!token.startsWith("demo.")) return null;
  return DEMO_USERS.find((u) => u.id === token.slice(5)) ?? null;
}

export function visibleCases(user: DemoUser) {
  const rows = CASES.filter((c) => {
    if (user.role === "victim") return c.victim_id === user.id;
    if (user.role === "counsellor") return c.assigned_counsellor_id === user.id;
    return true;
  });
  return rows.map(enrichCase).sort((a, b) => b.priority_score - a.priority_score);
}

export function goneQuiet(user: DemoUser) {
  return visibleCases(user)
    .filter((c) => c.gone_quiet)
    .map((c) => ({
      id: c.id,
      case_number: c.case_number,
      missed_count: 3,
      consecutive_missed: 3,
      days_since_contact: 9,
      case_type: c.case_type,
    }));
}

export function alertsFor(user: DemoUser) {
  const rows = [
    {
      id: "alert-1",
      case_id: IDS.case3,
      distress_score_id: "score-3",
      severity: "critical",
      status: "open",
      assigned_to: IDS.counsellor1,
      created_at: ago(20),
      resolved_at: null,
      case: {
        case_number: "SAM-2024-003",
        district: "Lucknow",
        state: "Uttar Pradesh",
        victim: { full_name: "Sunita Yadav" },
      },
    },
    {
      id: "alert-2",
      case_id: IDS.case1,
      distress_score_id: "score-1",
      severity: "high",
      status: "acknowledged",
      assigned_to: IDS.counsellor1,
      created_at: ago(6),
      resolved_at: null,
      case: {
        case_number: "SAM-2024-001",
        district: "Jaipur",
        state: "Rajasthan",
        victim: { full_name: "Meera Devi" },
      },
    },
  ];
  if (user.role === "victim") return [];
  if (user.role === "counsellor") return rows.filter((a) => a.assigned_to === user.id);
  if (user.role === "admin") return rows;
  return [];
}

export function dashboardSummary() {
  const enriched = CASES.map(enrichCase);
  const byRisk = { low: 0, moderate: 0, high: 0, critical: 0 };
  for (const c of enriched) {
    const level = c.latest_score?.risk_level ?? "low";
    byRisk[level] += 1;
  }
  const districtMap = new Map<string, { count: number; high_risk: number; state: string }>();
  for (const c of enriched) {
    const cur = districtMap.get(c.district) ?? { count: 0, high_risk: 0, state: c.state };
    cur.count += 1;
    if (c.latest_score?.risk_level === "high" || c.latest_score?.risk_level === "critical") {
      cur.high_risk += 1;
    }
    districtMap.set(c.district, cur);
  }
  return {
    total_cases: enriched.length,
    total_beneficiaries: new Set(enriched.map((c) => c.victim_id)).size,
    cases_by_risk: byRisk,
    cases_by_stage: {
      investigation: 2,
      trial: 1,
      rehabilitation: 1,
    },
    cases_by_district: [...districtMap.entries()].map(([district, v]) => ({
      district,
      ...v,
    })),
    cases_by_state: [
      { state: "Rajasthan", count: 1, high_risk: 1 },
      { state: "Tamil Nadu", count: 1, high_risk: 0 },
      { state: "Uttar Pradesh", count: 1, high_risk: 1 },
      { state: "Maharashtra", count: 1, high_risk: 0 },
    ],
    rising_risk_cases: enriched.filter((c) => c.trend_direction === "rising").length,
    average_distress: 59,
    open_alerts: 2,
    high_risk_cases: enriched
      .filter((c) => c.latest_score && ["high", "critical"].includes(c.latest_score.risk_level))
      .map((c) => ({
        case_id: c.id,
        case_number: c.case_number,
        victim_name: c.victim.full_name,
        district: c.district,
        state: c.state,
        current_risk: c.latest_score!.risk_level,
        current_score: c.latest_score!.score,
        trend_direction: c.trend_direction,
        escalation_risk_7d: c.escalation_risk_7d,
      })),
    scope: "national" as const,
    sla_breaches: 1,
    filters: { state: null, district: null },
    engagement_rate: 0.72,
    gone_quiet_count: 1,
  };
}

export function timeline(caseId: string) {
  const raw = CASES.find((c) => c.id === caseId);
  if (!raw) return null;
  const caseRow = enrichCase(raw);
  const checkins = [
    {
      id: "chk-1c",
      case_id: caseId,
      victim_id: raw.victim_id,
      channel: "app",
      raw_transcript: "I am managing the day, but the notice still makes my chest tight.",
      created_at: ago(72),
      distress_score: SCORES.find((s) => s.checkin_id === "chk-1c" && s.case_id === caseId) ?? null,
    },
    {
      id: "chk-1",
      case_id: caseId,
      victim_id: raw.victim_id,
      channel: "chat",
      raw_transcript:
        "The hearing is next week. I could not sleep. Someone waited near the lane again.",
      created_at: ago(6),
      distress_score: latestScore(caseId) ?? null,
    },
  ].filter((c) => c.distress_score);
  return {
    case: caseRow,
    checkins,
    alerts: alertsFor({ ...DEMO_USERS[0], role: "admin" }).filter((a) => a.case_id === caseId),
    intervention_notes: [
      {
        id: "note-1",
        case_id: caseId,
        counsellor_id: raw.assigned_counsellor_id,
        note: "Agreed a morning check-in before the hearing. Safety plan reviewed.",
        created_at: ago(26),
      },
    ],
    support_recommendations: [
      {
        id: "sup-1",
        case_id: caseId,
        alert_id: null,
        type: "counselling",
        description: "Priority counselling session before the next hearing date.",
        status: "in_progress",
        created_at: ago(20),
        catalog_code: "POA-COUNSEL",
        due_at: new Date(Date.now() + 36 * 3600_000).toISOString(),
        sla_breached: false,
        sla_hours: 72,
        responsible_authority: "District counselling cell",
      },
      {
        id: "sup-2",
        case_id: caseId,
        alert_id: null,
        type: "protection",
        description: "Review police protection near the residence before the hearing.",
        status: "suggested",
        created_at: ago(8),
        catalog_code: "POA-PROTECT",
        due_at: ago(4),
        sla_breached: true,
        sla_hours: 48,
        responsible_authority: "District magistrate",
      },
    ],
    timeline_events: [
      {
        id: "evt-1",
        case_id: caseId,
        event_type: "checkin",
        description: "Survivor completed a chat check-in.",
        created_by: raw.victim_id,
        created_at: ago(6),
      },
    ],
    intelligence: {
      trend_direction: caseRow.trend_direction,
      escalation_risk_7d: caseRow.escalation_risk_7d,
      average_score: caseRow.latest_score?.score ?? 0,
      consecutive_elevated: caseRow.latest_score?.risk_level === "critical" ? 3 : 2,
      contributing_factors: ["upcoming hearing", "intimidation near home", "sleep disruption"],
      why_flagged: [
        "Distress score is elevated",
        "Trend is not improving",
        caseRow.gone_quiet ? "Outreach has gone quiet" : "Recent check-in received",
      ],
      recommended_action: caseRow.recommended_action,
      prediction_method: "demo-fallback",
      disclaimer: "Decision-support estimate for authorised professionals — not a clinical diagnosis.",
    },
  };
}

export function victimDashboard(userId: string) {
  const user = DEMO_USERS.find((u) => u.id === userId);
  const cases = CASES.filter((c) => c.victim_id === userId).map(enrichCase);
  const primary = cases[0];
  const trendScores = SCORES.filter((s) => s.case_id === primary?.id).sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
  const latest = trendScores.at(-1) ?? null;
  return {
    welcome: {
      first_name: user?.full_name.split(" ")[0] ?? "there",
      full_name: user?.full_name ?? "Survivor",
      preferred_language: user?.preferred_language ?? "en",
    },
    summary: {
      instant_calls_made: 2,
      consultant_meets: 1,
      latest_score: latest
        ? { id: latest.id, score: latest.score, source: "chat", created_at: latest.created_at }
        : null,
      score_trend: trendScores.map((s) => ({ score: s.score, at: s.created_at, source: "chat" })),
    },
    last_call_summary: {
      id: "call-last",
      summary: "You asked for a quiet morning before the hearing. Breathing practice was offered.",
      created_at: ago(28),
      duration_seconds: 420,
    },
    case: primary
      ? { id: primary.id, case_number: primary.case_number, status: primary.status }
      : null,
  };
}

export function callRouting(userId: string) {
  const c = CASES.find((row) => row.victim_id === userId);
  if (!c) return null;
  const latest = latestScore(c.id);
  const risk = latest?.risk_level ?? "low";
  const counsellor = DEMO_USERS.find((u) => u.id === c.assigned_counsellor_id)!;
  const callType = risk === "high" || risk === "critical" ? "counsellor" : "ai_voice";
  return {
    call_type: callType,
    risk_level: risk,
    distress_score: latest?.score ?? null,
    reason:
      callType === "counsellor"
        ? `Distress is ${risk} (score ${latest?.score ?? "—"}) → counsellor call required.`
        : `Distress is ${risk} (score ${latest?.score ?? "—"}) → AI voice wellness call.`,
    case_id: c.id,
    case_number: c.case_number,
    counsellor:
      callType === "counsellor"
        ? {
            id: counsellor.id,
            full_name: counsellor.full_name,
            phone_number: counsellor.phone_number,
          }
        : undefined,
  };
}

export function pendingCalls(counsellorId: string) {
  return CASES.filter(
    (c) => c.assigned_counsellor_id === counsellorId && (c.id === IDS.case1 || c.id === IDS.case3)
  ).map((c) => {
    const latest = latestScore(c.id)!;
    const victim = DEMO_USERS.find((u) => u.id === c.victim_id)!;
    return {
      id: `call-${c.id}`,
      case_id: c.id,
      victim_id: c.victim_id,
      counsellor_id: counsellorId,
      call_type: "counsellor",
      status: "requested",
      risk_level_at_call: latest.risk_level,
      distress_score_at_call: latest.score,
      created_at: ago(1),
      case: { case_number: c.case_number },
      victim: { full_name: victim.full_name, phone_number: victim.phone_number },
    };
  });
}

const CONSULTANTS = [
  {
    id: IDS.counsellor1,
    name: "Dr. Priya Sharma",
    photo_url: null,
    specialization: "Trauma-informed counselling",
    bio: "Supports survivors through hearings, protection, and day-to-day safety planning.",
    availability_note: "Morning slots, Hindi and English",
    active_case_count: 2,
    profile_id: IDS.counsellor1,
  },
  {
    id: IDS.counsellor2,
    name: "Dr. Ananya Iyer",
    photo_url: null,
    specialization: "Rehabilitation and family support",
    bio: "Focuses on recovery routines, family conversations, and follow-up after court dates.",
    availability_note: "Afternoon slots, Tamil and English",
    active_case_count: 2,
    profile_id: IDS.counsellor2,
  },
];

export function consultantPayload(userId: string) {
  const assigned = CASES.find((c) => c.victim_id === userId);
  const consultant =
    CONSULTANTS.find((c) => c.profile_id === assigned?.assigned_counsellor_id) ?? CONSULTANTS[0];
  return {
    allotted: {
      assignment_id: "case-link",
      assigned_at: ago(24 * 10),
      consultant,
    },
    consultant_count: CONSULTANTS.length,
    pending_message: null,
    directory: CONSULTANTS,
    meets: [
      {
        id: "meet-1",
        consultant_id: consultant.id,
        status: "completed",
        scheduled_at: ago(24 * 7),
        report: "Reviewed the safety plan and sleep routine before the hearing.",
        recommendations: "Short daily check-in. Call the counsellor if intimidation repeats.",
        created_at: ago(24 * 7),
      },
    ],
    updates: [
      {
        id: "upd-1",
        event_type: "note",
        message: "Your counsellor left a note after the last meeting.",
        created_at: ago(24 * 6),
        consultant_id: consultant.id,
        meet_id: "meet-1",
      },
    ],
    browse_note: "You can change your allotted consultant anytime by choosing another below.",
    can_choose: true,
  };
}

export function victimProfile(userId: string) {
  const user = DEMO_USERS.find((u) => u.id === userId)!;
  const cases = CASES.filter((c) => c.victim_id === userId);
  const scores = SCORES.filter((s) => cases.some((c) => c.id === s.case_id));
  return {
    profile: {
      id: user.id,
      full_name: user.full_name,
      preferred_language: user.preferred_language,
      phone_number: user.phone_number,
      case_reference: cases[0]?.case_number ?? null,
      bio: "Demo profile for screenshots.",
      instant_call_count: 2,
      consultant_meet_count: 1,
      created_at: "2026-01-10T08:00:00.000Z",
    },
    cases: cases.map((c) => ({
      id: c.id,
      case_number: c.case_number,
      case_type: c.case_type,
      status: c.status,
      district: c.district,
      state: c.state,
    })),
    score_history: scores.map((s) => ({
      id: s.id,
      score: s.score,
      source: "chat",
      created_at: s.created_at,
    })),
    meet_reports: [
      {
        id: "meet-1",
        status: "completed",
        scheduled_at: ago(24 * 7),
        report: "Reviewed the safety plan and sleep routine before the hearing.",
        recommendations: "Short daily check-in.",
        consultant: { name: "Dr. Priya Sharma", specialization: "Trauma-informed counselling" },
      },
    ],
    instant_call_history: [
      {
        id: "call-last",
        summary: "Breathing practice offered before the hearing.",
        created_at: ago(28),
        duration_seconds: 420,
        status: "completed",
      },
    ],
    tags: [{ tag: "anxiety" }, { tag: "sleep" }],
  };
}

export function explain(scoreId: string) {
  const row = SCORES.find((s) => s.id === scoreId);
  return {
    contributions: [
      {
        feature_label: "Sleep disruption",
        contribution: 18,
        direction: "up",
        evidence: row?.reasoning ?? "Recent check-in",
        channel: "chat",
      },
      {
        feature_label: "Fear of hearing",
        contribution: 22,
        direction: "up",
        evidence: "Mentioned the upcoming court date",
        channel: "chat",
      },
      {
        feature_label: "Family support",
        contribution: -6,
        direction: "down",
        evidence: "Spoke with a sibling",
        channel: "chat",
      },
    ],
  };
}

export function forecast(caseId: string) {
  const latest = latestScore(caseId);
  const base = latest?.score ?? 40;
  return {
    forecast: {
      predicted_score: Math.min(100, base + 4),
      ci_lower: Math.max(0, base - 8),
      ci_upper: Math.min(100, base + 12),
      crisis_probability: base > 70 ? 0.62 : 0.21,
      risk_7d: latest?.escalation_risk_7d ?? 20,
      method: "demo-fallback",
      trajectory: [1, 3, 7].map((day) => ({
        day,
        score: Math.min(100, base + day),
        lower: Math.max(0, base - 6),
        upper: Math.min(100, base + day + 8),
      })),
      disclaimer: "Illustrative forecast for screenshots — not a clinical prediction.",
      escalation_model: { method: "demo-fallback", risk_7d: latest?.escalation_risk_7d ?? 20 },
    },
    honesty: "DEMO",
    history_points: SCORES.filter((s) => s.case_id === caseId).length,
  };
}

export function chatHistory(userId: string) {
  const user = DEMO_USERS.find((u) => u.id === userId);
  return [
    {
      id: "msg-1",
      role: "assistant",
      content:
        "I'm Mann-Mitra. Whenever you're ready, share how today has been — only what feels safe.",
      created_at: ago(7),
    },
    {
      id: "msg-2",
      role: "user",
      content:
        user?.id === IDS.victim4
          ? "I felt anxious about the court date, but I am coping."
          : "I could not sleep. The hearing is next week and someone waited near the lane.",
      created_at: ago(6.5),
    },
    {
      id: "msg-3",
      role: "assistant",
      content:
        "Thank you for telling me. That sounds heavy. You do not have to solve it in this chat. If you want, we can stay with one small thing that helped even a little today.",
      created_at: ago(6.4),
    },
  ];
}
