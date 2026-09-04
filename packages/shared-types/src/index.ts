// ─── Enums ───────────────────────────────────────────────────────────────────

export type UserRole = "victim" | "counsellor" | "official" | "admin";

export type CaseStatus =
  | "complaint_registration"
  | "investigation"
  | "trial"
  | "compensation"
  | "rehabilitation"
  | "protection_followup"
  | "closed";

export type CheckinChannel =
  | "chat"
  | "ivrs"
  | "sms"
  | "app"
  | "ai_voice"
  | "portal"
  | "chatbot"
  | "nhaa_14566"
  | "helpline";

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export type TrendDirection = "rising" | "stable" | "improving";

export type AlertStatus = "open" | "acknowledged" | "resolved";

export type SupportType =
  | "counselling"
  | "medical"
  | "legal"
  | "financial"
  | "protection"
  | "rehabilitation"
  | "relocation"
  | "witness_protection"
  | "follow_up";

export type SupportStatus = "suggested" | "in_progress" | "completed";

export type ModelConfidence = "high" | "medium" | "low" | "fallback";

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

export interface InterventionRecommendation {
  type: SupportType | string;
  description: string;
}

export interface DistressScore {
  id: string;
  checkin_id: string;
  case_id: string;
  score: number;
  risk_level: RiskLevel;
  reasoning: string;
  signals_detected: string[];
  trend_direction?: TrendDirection | null;
  escalation_risk_7d?: number | null;
  escalation_reasoning?: string | null;
  recommended_interventions?: InterventionRecommendation[];
  sentiment?: string | null;
  emotion_indicators?: string[];
  contributing_factors?: string[];
  model_confidence?: ModelConfidence | null;
  prediction_method?: string | null;
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
  alerts?: Alert[];
  intelligence?: {
    trend_direction: TrendDirection;
    escalation_risk_7d: number;
    contributing_factors: string[];
    priority_hint?: string;
  };
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
  sentiment?: string;
  emotion_indicators?: string[];
  trend_direction?: TrendDirection;
  escalation_risk_7d?: number;
  escalation_reasoning?: string;
  recommended_interventions?: InterventionRecommendation[];
  contributing_factors?: string[];
  model_confidence?: ModelConfidence;
  prediction_method?: string;
  disclaimer?: string;
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
    case_status?: string;
    channel?: string;
  };
}

export interface DashboardSummary {
  total_cases: number;
  total_beneficiaries?: number;
  cases_by_risk: Record<RiskLevel, number>;
  cases_by_stage?: Record<string, number>;
  cases_by_district?: Array<{ district: string; count: number; high_risk: number }>;
  cases_by_state?: Array<{ state: string; count: number; high_risk: number }>;
  rising_risk_cases?: number;
  average_distress?: number;
  open_alerts: number;
  high_risk_cases: Array<{
    case_id: string;
    case_number: string;
    victim_name: string;
    district: string;
    state?: string;
    current_risk: RiskLevel;
    current_score: number;
    trend_direction?: TrendDirection | null;
    escalation_risk_7d?: number | null;
  }>;
  scope?: "district" | "state" | "national";
}

export interface PrioritisedCase extends Case {
  victim?: Profile;
  assigned_counsellor?: Profile;
  assigned_official?: Profile;
  latest_score?: DistressScore | null;
  priority_score: number;
  trend_direction: TrendDirection;
  escalation_risk_7d: number;
  hours_since_interaction: number | null;
  recommended_action: string;
  anonymised_label: string;
}

export interface CaseWithDetails extends Case {
  victim?: Profile;
  assigned_counsellor?: Profile;
  assigned_official?: Profile;
  latest_score?: DistressScore;
  priority_score?: number;
}

export interface CaseTimeline {
  case: CaseWithDetails;
  checkins: Array<Checkin & { distress_score?: DistressScore }>;
  alerts: Alert[];
  intervention_notes: InterventionNote[];
  support_recommendations: SupportRecommendation[];
  timeline_events: CaseTimelineEvent[];
  intelligence?: {
    trend_direction: TrendDirection;
    escalation_risk_7d: number;
    average_score: number;
    consecutive_elevated: number;
    contributing_factors: string[];
    why_flagged: string[];
    recommended_action: string;
    prediction_method: string;
    disclaimer: string;
  };
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
  escalation_risk_7d?: number;
  trend_direction?: TrendDirection;
  recommended_action?: string;
}

export interface JoinCaseRoomPayload {
  case_id: string;
}

// ─── Call sessions ───────────────────────────────────────────────────────────

export type CallType = "counsellor" | "ai_voice";
export type CallStatus =
  | "requested"
  | "ringing"
  | "in_progress"
  | "completed"
  | "missed"
  | "cancelled";

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

export const PRIORITY_CASE_TYPES = [
  "rape",
  "gang_rape",
  "murder",
  "grievous_hurt",
  "arson",
  "witness_intimidation",
  "caste_based_violence",
] as const;

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  complaint_registration: "Complaint registration",
  investigation: "Investigation",
  trial: "Trial",
  compensation: "Compensation",
  rehabilitation: "Rehabilitation",
  protection_followup: "Protection / follow-up",
  closed: "Closed",
};
