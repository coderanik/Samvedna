// ─── Enums ───────────────────────────────────────────────────────────────────

export type UserRole = "victim" | "counsellor" | "official" | "admin";

export type CaseStatus = "investigation" | "trial" | "rehabilitation" | "closed";

export type CheckinChannel = "chat" | "ivrs" | "sms" | "app" | "ai_voice";

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export type AlertStatus = "open" | "acknowledged" | "resolved";

export type SupportType =
  | "counselling"
  | "medical"
  | "legal"
  | "financial"
  | "protection"
  | "rehabilitation";

export type SupportStatus = "suggested" | "in_progress" | "completed";

// ─── Database row types ──────────────────────────────────────────────────────

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  preferred_language: string;
  phone_number: string | null;
  created_at: string;
}

export interface Case {
  id: string;
  victim_id: string;
  case_number: string;
  case_type: string;
  status: CaseStatus;
  assigned_counsellor_id: string | null;
  assigned_official_id: string | null;
  district: string;
  state: string;
  created_at: string;
}

export interface Checkin {
  id: string;
  case_id: string;
  victim_id: string;
  channel: CheckinChannel;
  raw_transcript: string;
  created_at: string;
}

export interface DistressScore {
  id: string;
  checkin_id: string;
  case_id: string;
  score: number;
  risk_level: RiskLevel;
  reasoning: string;
  signals_detected: string[];
  created_at: string;
}

export interface Alert {
  id: string;
  case_id: string;
  distress_score_id: string;
  severity: RiskLevel;
  status: AlertStatus;
  assigned_to: string;
  created_at: string;
  resolved_at: string | null;
}

export interface SupportRecommendation {
  id: string;
  case_id: string;
  alert_id: string | null;
  type: SupportType;
  description: string;
  status: SupportStatus;
  created_at: string;
}

export interface CaseTimelineEvent {
  id: string;
  case_id: string;
  event_type: string;
  description: string;
  created_by: string;
  created_at: string;
}

export interface InterventionNote {
  id: string;
  case_id: string;
  counsellor_id: string;
  note: string;
  created_at: string;
}

// ─── API contracts ───────────────────────────────────────────────────────────

export interface CreateCheckinRequest {
  case_id: string;
  message: string;
  channel?: CheckinChannel;
}

export interface CreateCheckinResponse {
  checkin: Checkin;
  distress_score: DistressScore;
  alert?: Alert;
}

export interface CreateNoteRequest {
  note: string;
}

export interface UpdateAlertRequest {
  status: AlertStatus;
}

export interface DistressScoreResult {
  score: number;
  risk_level: RiskLevel;
  signals_detected: string[];
  reasoning: string;
}

export interface ScoreCheckinPayload {
  transcript: string;
  recent_history: Array<{
    transcript: string;
    score: number;
    risk_level: RiskLevel;
    created_at: string;
  }>;
  case_metadata: {
    case_type: string;
    days_since_opened: number;
    preferred_language: string;
  };
}

export interface DashboardSummary {
  total_cases: number;
  cases_by_risk: Record<RiskLevel, number>;
  open_alerts: number;
  high_risk_cases: Array<{
    case_id: string;
    case_number: string;
    victim_name: string;
    district: string;
    current_risk: RiskLevel;
    current_score: number;
  }>;
}

export interface CaseWithDetails extends Case {
  victim?: Profile;
  assigned_counsellor?: Profile;
  assigned_official?: Profile;
  latest_score?: DistressScore;
}

export interface CaseTimeline {
  case: CaseWithDetails;
  checkins: Array<Checkin & { distress_score?: DistressScore }>;
  alerts: Alert[];
  intervention_notes: InterventionNote[];
  support_recommendations: SupportRecommendation[];
  timeline_events: CaseTimelineEvent[];
}

export interface HealthResponse {
  status: "ok";
  service: string;
  timestamp: string;
}

// ─── Socket.io events ────────────────────────────────────────────────────────

export interface NewAlertEvent {
  alert: Alert;
  case_id: string;
  case_number: string;
  victim_name: string;
  severity: RiskLevel;
  reasoning: string;
}

export interface JoinCaseRoomPayload {
  case_id: string;
}

// ─── Call sessions ───────────────────────────────────────────────────────────

export type CallType = "counsellor" | "ai_voice";
export type CallStatus = "requested" | "ringing" | "in_progress" | "completed" | "missed" | "cancelled";

export interface CallSession {
  id: string;
  case_id: string;
  victim_id: string;
  counsellor_id: string | null;
  call_type: CallType;
  status: CallStatus;
  risk_level_at_call: RiskLevel;
  distress_score_at_call: number | null;
  transcript: string | null;
  duration_seconds: number | null;
  exotel_call_sid?: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface CallRouting {
  call_type: CallType;
  risk_level: RiskLevel;
  distress_score: number | null;
  reason: string;
  counsellor?: {
    id: string;
    full_name: string;
    phone_number: string | null;
  };
  case_id: string;
  case_number: string;
}

export interface IncomingCallEvent {
  call_session: CallSession;
  case_number: string;
  victim_name: string;
  call_type: CallType;
}
