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
  attrition_risk?: number | null;
  gone_quiet?: boolean;
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

// ─── v2: composite scoring, cadence, consent, audit ─────────────────────────
// Additive only. The pre-v2 types above are still imported by apps/web and
// apps/mobile, so extensions are declared as separate interfaces that extend
// them rather than as edits.

export type CompositeChannelName =
  | "clinical"
  | "text_sentiment"
  | "vocal_stress"
  | "behavioural"
  | "case_context";

export type ContributionDirection = "increases" | "decreases" | "neutral";

export type CadenceTier = "intensive" | "active" | "routine" | "maintenance";

export type OutreachChannel =
  | "chat"
  | "sms"
  | "ivrs"
  | "helpline_callback"
  | "app"
  | "ai_voice";

export type OutreachStatus = "scheduled" | "sent" | "responded" | "missed" | "cancelled";

export type OutreachGeneratedBy = "cadence" | "event" | "manual" | "escalation";

export type ClinicalInstrument =
  | "phq2"
  | "phq9"
  | "gad2"
  | "gad7"
  | "pcptsd5"
  | "pcl5"
  | "cssrs"
  | "who5";

export type ConsentScope =
  | "voice_recording"
  | "transcript_storage"
  | "llm_processing"
  | "family_contact"
  | "data_sharing_district"
  | "research_anonymised";

export type ReliefStage = string;

export type WitnessProtectionStatus = string;

// ─── v2 database rows ────────────────────────────────────────────────────────

export interface OutreachSchedule {
  id: string;
  case_id: string;
  scheduled_for: string;
  channel: OutreachChannel | string;
  status: OutreachStatus;
  reason: string | null;
  generated_by: OutreachGeneratedBy | string | null;
  attempt_count: number | null;
  responded_at: string | null;
  checkin_id: string | null;
  created_at: string;
}

export interface EngagementMetrics {
  id?: string;
  case_id: string;
  checkin_id: string;
  response_latency_seconds: number | null;
  message_char_count: number;
  message_word_count: number;
  session_duration_seconds: number | null;
  turns_in_session: number | null;
  abandoned: boolean;
  hour_of_day: number;
  day_of_week: number;
  days_since_last_checkin: number | null;
  missed_outreach_count_30d: number;
  engagement_score: number;
  created_at?: string;
}

export interface ClinicalAssessment {
  id: string;
  case_id: string;
  checkin_id: string | null;
  instrument: ClinicalInstrument | string;
  raw_responses: Record<string, unknown> | null;
  total_score: number | null;
  max_score: number | null;
  severity_band: string | null;
  positive_screen: boolean | null;
  administered_via: string | null;
  mapping_confidence: string | null;
  created_at: string;
}

export interface VoiceAnalysis {
  id: string;
  case_id: string;
  checkin_id: string | null;
  call_session_id: string | null;
  duration_seconds: number | null;
  f0_mean: number | null;
  f0_std: number | null;
  f0_range: number | null;
  jitter_local: number | null;
  shimmer_local: number | null;
  hnr_db: number | null;
  speech_rate: number | null;
  articulation_rate: number | null;
  pause_ratio: number | null;
  mean_pause_duration: number | null;
  intensity_mean: number | null;
  intensity_std: number | null;
  spectral_centroid_mean: number | null;
  vocal_stress_index: number | null;
  baseline_deviation: number | null;
  confidence: string | null;
  extractor: string | null;
  features_raw: Record<string, unknown> | null;
  created_at: string;
}

export interface VoiceBaseline {
  victim_id: string;
  sample_count: number;
  f0_mean: number | null;
  f0_std: number | null;
  jitter_mean: number | null;
  shimmer_mean: number | null;
  hnr_mean: number | null;
  speech_rate_mean: number | null;
  pause_ratio_mean: number | null;
  updated_at: string;
}

export interface ScoreContribution {
  id?: string;
  distress_score_id?: string;
  channel: CompositeChannelName | string;
  feature: string;
  feature_label: string;
  raw_value: number | null;
  weight: number;
  /** Points this feature added to (or removed from) the composite base. */
  contribution: number;
  direction: ContributionDirection;
  evidence: string;
  created_at?: string;
}

export interface DistressForecast {
  id: string;
  case_id: string;
  distress_score_id: string | null;
  horizon_days: number;
  predicted_score: number;
  ci_lower: number | null;
  ci_upper: number | null;
  crisis_probability: number | null;
  method: string | null;
  model_version: string | null;
  backtest_mae: number | null;
  trajectory: Array<{ day: number; score: number; lower?: number; upper?: number }> | null;
  created_at: string;
}

export interface ConsentRecord {
  id: string;
  victim_id: string;
  scope: ConsentScope;
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  policy_version: string | null;
  created_at: string;
}

export interface ConsentState {
  scope: ConsentScope;
  label: string;
  granted: boolean;
  /** False when no record exists and the permissive default is in force. */
  explicit: boolean;
  granted_at: string | null;
  revoked_at: string | null;
  policy_version: string | null;
}

export interface AuditLogEntry {
  id: number;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  case_id: string | null;
  purpose: string | null;
  ip_hash: string | null;
  metadata: Record<string, unknown> | null;
  prev_hash: string | null;
  entry_hash: string | null;
  created_at: string;
}

export interface InterventionCatalogEntry {
  id: string;
  code: string;
  support_type: SupportType | string;
  title: string;
  statutory_basis: string;
  responsible_authority: string;
  sla_hours: number;
  description: string;
  eligibility_note: string | null;
  applies_to_case_types: string[] | null;
  trigger_signals: string[] | null;
  min_risk_level: RiskLevel | null;
  priority_weight: number | null;
  active: boolean;
}

export interface DistrictRegistryEntry {
  id: string;
  state: string;
  district: string;
  lgd_code: string | null;
  population_sc: number | null;
  population_st: number | null;
  atrocity_prone: boolean | null;
  sp_office_contact: string | null;
  dlsa_contact: string | null;
}

// ─── v2 extensions to existing rows ─────────────────────────────────────────

export interface DistressScoreV2 extends DistressScore {
  component_clinical?: number | null;
  component_text?: number | null;
  component_voice?: number | null;
  component_behavioural?: number | null;
  component_context?: number | null;
  active_channels?: ActiveChannelRecord[] | null;
  composite_version?: string | null;
  crisis_override?: boolean | null;
  crisis_override_reason?: string | null;
}

export interface ActiveChannelRecord {
  channel: CompositeChannelName;
  base_weight: number;
  /** Base weight after absent channels were redistributed. */
  effective_weight: number;
  score: number;
}

export interface CaseV2 extends Case {
  next_hearing_date?: string | null;
  fir_number?: string | null;
  poa_sections?: string[] | null;
  relief_stage?: ReliefStage | null;
  relief_amount_sanctioned?: number | null;
  relief_amount_disbursed?: number | null;
  relief_due_date?: string | null;
  witness_protection_status?: WitnessProtectionStatus | null;
  cadence_tier?: CadenceTier | null;
  last_contact_at?: string | null;
  consecutive_missed_outreach?: number | null;
}

export interface SupportRecommendationV2 extends SupportRecommendation {
  catalog_code?: string | null;
  statutory_basis?: string | null;
  responsible_authority?: string | null;
  sla_hours?: number | null;
  due_at?: string | null;
  sla_breached?: boolean | null;
  rationale?: string | null;
}

// ─── v2 API contracts ────────────────────────────────────────────────────────

export interface CrisisDetection {
  triggered: true;
  reason: string;
  source: "clinical_cssrs" | "transcript_language" | "ml_signal" | "active_threat";
}

export interface CompositeChannelResult {
  channel: CompositeChannelName;
  label: string;
  base_weight: number;
  weight: number;
  score: number;
  contribution: number;
  features: ScoreContribution[];
}

export interface CompositeScoreResult {
  score: number;
  risk_level: RiskLevel;
  base: number;
  components: {
    clinical: number | null;
    text: number;
    voice: number | null;
    behavioural: number | null;
    context: number;
  };
  channels: CompositeChannelResult[];
  active_channels: ActiveChannelRecord[];
  contributions: ScoreContribution[];
  composite_version: string;
  crisis_override: boolean;
  crisis_override_reason: string | null;
  absent_channels: CompositeChannelName[];
  redistribution_note: string;
}

export interface ScoreExplanationFeature {
  feature: string;
  feature_label: string;
  raw_value: number | null;
  contribution: number;
  direction: ContributionDirection;
  evidence: string;
}

export interface ScoreExplanationChannel {
  channel: CompositeChannelName;
  label: string;
  weight: number;
  base_weight: number;
  score: number;
  contribution: number;
  features: ScoreExplanationFeature[];
}

export interface ScoreCounterfactual {
  channel: CompositeChannelName;
  label: string;
  observed_channel_score: number;
  baseline_channel_score: number;
  baseline_source: string;
  counterfactual_score: number;
  delta: number;
  statement: string;
}

export interface ScoreExplanation {
  score: number;
  risk_level: RiskLevel;
  crisis_override: boolean;
  crisis_override_reason: string | null;
  base: number;
  channels: ScoreExplanationChannel[];
  top_factors: Array<ScoreExplanationFeature & { channel: string }>;
  counterfactuals: ScoreCounterfactual[];
  model_confidence: ModelConfidence | null;
  composite_version: string;
  active_channels: ActiveChannelRecord[] | null;
  what_this_is_not: string[];
  arithmetic_check: {
    base_plus_contributions: number;
    stored_score: number;
    agrees: boolean;
  };
  degraded: boolean;
  contributions: ScoreContribution[];
  arithmetic_note: string;
  disclaimer: string;
}

export interface InterventionMatch {
  catalog_code: string;
  support_type: SupportType;
  title: string;
  statutory_basis: string;
  responsible_authority: string;
  sla_hours: number;
  description: string;
  eligibility_note: string | null;
  match_score: number;
  rationale: string;
  summary: string;
}

export interface EngagementPenalty {
  key: string;
  label: string;
  points: number;
  raw_value: number | null;
  evidence: string;
}

export interface EngagementResult {
  engagement_score: number;
  penalty_total: number;
  penalties: EngagementPenalty[];
  metrics: EngagementMetrics;
  baselines: {
    message_char_baseline: number | null;
    latency_mean_seconds: number | null;
    latency_std_seconds: number | null;
    typical_hour: number | null;
    cadence_interval_days: number;
  };
  prior_checkin_count: number;
  persisted: boolean;
}

export interface GoneQuietCase {
  id: string;
  case_number: string;
  case_type: string;
  status: string;
  district: string | null;
  cadence_tier: CadenceTier | null;
  last_contact_at: string | null;
  consecutive_missed_outreach: number;
  missed_count: number;
  days_since_contact: number | null;
  cadence_interval_days: number;
  overdue_multiple: number | null;
  severity_rank: number;
  victim?: { full_name?: string } | null;
  reason: string;
  honesty: string;
}

export interface CadenceTickResult {
  sent: number;
  missed: number;
  disengagement_alerts: number;
  relapse_checks: number;
  status_transitions: number;
  sla_breaches: number;
  degraded: boolean;
}

export interface ConsentStateResponse {
  victim_id?: string;
  case_id?: string;
  case_number?: string;
  policy_version: string;
  consent_state: ConsentState[];
  read_only?: boolean;
  honesty: string;
}

export interface AuditChainVerification {
  valid: boolean;
  entries_checked: number;
  first_broken_id: number | null;
  reason: string | null;
  method: string;
}

export interface AuditCaseTrail {
  case_id: string;
  entries: Array<AuditLogEntry | Partial<AuditLogEntry>>;
  degraded: boolean;
  honesty?: string;
}

export interface RedactionStats {
  calls: number;
  entities_redacted: number;
  by_type: Record<"NAME" | "PHONE" | "EMAIL" | "AADHAAR" | "VILLAGE" | "ID", number>;
  last_redaction_at: string | null;
  placeholders?: string[];
  honesty?: string;
}

export interface DistrictAnomaly {
  district: string;
  state: string;
  /** Standard deviations above the national mean of district slopes. */
  z_score: number;
  /** Distress points per day. */
  slope: number;
  case_count: number;
  mean_score: number;
}

export interface SlaBreach {
  id: string;
  case_id: string;
  case_number: string | null;
  district: string | null;
  state: string | null;
  type: string;
  description: string;
  status: SupportStatus | string;
  catalog_code: string | null;
  statutory_basis: string | null;
  responsible_authority: string | null;
  sla_hours: number | null;
  due_at: string | null;
  hours_overdue: number | null;
  created_at: string;
}

export interface SlaBreachResponse {
  total: number;
  breaches: SlaBreach[];
}

export interface StageFunnelEntry {
  case_status: CaseStatus;
  case_count: number;
  scored_case_count: number;
  mean_distress: number | null;
}

export interface StageFunnelResponse {
  funnel: StageFunnelEntry[];
  order: CaseStatus[];
}

export interface DashboardSummaryV2 extends DashboardSummary {
  sla_breaches: number;
  /** Outreach responses ÷ (responses + misses) over 30 days, or null if none due. */
  engagement_rate: number | null;
  engagement_basis?: {
    responded: number;
    missed: number;
    window_days: number;
  };
  gone_quiet_count: number;
  district_anomalies: DistrictAnomaly[];
  anomaly_method?: string;
}

export interface CheckinIntelligenceV2 {
  trend_direction: TrendDirection;
  escalation_risk_7d: number;
  contributing_factors: string[];
  priority_hint?: string;
  composite_version?: string;
  active_channels?: CompositeChannelName[];
  absent_channels?: CompositeChannelName[];
  redistribution_note?: string;
  crisis_override?: boolean;
  crisis_override_reason?: string | null;
  engagement_score?: number | null;
  cadence_tier?: CadenceTier | null;
  next_outreach_at?: string | null;
}

export interface CreateCheckinResponseV2 extends Omit<CreateCheckinResponse, "intelligence"> {
  distress_score: DistressScoreV2;
  intelligence?: CheckinIntelligenceV2;
}

export interface OutreachUpdateEvent {
  type: "scheduled" | "sent" | "responded" | "missed" | "disengagement_alert";
  outreach?: OutreachSchedule;
  case_id?: string;
  case_number?: string;
  alert_id?: string;
  reason?: string;
  consecutive_missed?: number;
  behavioural_penalty?: number;
  delivered?: boolean;
}

export const CONSENT_SCOPE_LIST: ConsentScope[] = [
  "voice_recording",
  "transcript_storage",
  "llm_processing",
  "family_contact",
  "data_sharing_district",
  "research_anonymised",
];

export const COMPOSITE_CHANNEL_WEIGHTS: Record<CompositeChannelName, number> = {
  clinical: 0.3,
  text_sentiment: 0.25,
  vocal_stress: 0.2,
  behavioural: 0.15,
  case_context: 0.1,
};

export const CADENCE_TIER_INTERVAL_HOURS: Record<CadenceTier, number> = {
  intensive: 24,
  active: 48,
  routine: 168,
  maintenance: 336,
};

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  complaint_registration: "Complaint registration",
  investigation: "Investigation",
  trial: "Trial",
  compensation: "Compensation",
  rehabilitation: "Rehabilitation",
  protection_followup: "Protection / follow-up",
  closed: "Closed",
};

// ─── Victim dashboard module ─────────────────────────────────────────────────

export type MeetStatus = "scheduled" | "completed" | "cancelled";
export type DistressSource = "chat" | "call" | "manual";

export interface InstantCall {
  id: string;
  user_id: string;
  twilio_call_sid: string | null;
  transcript: string | null;
  summary: string | null;
  distress_score_id: string | null;
  created_at: string;
  duration_seconds?: number | null;
  status?: string;
}

export interface Consultant {
  id: string;
  name: string;
  photo_url: string | null;
  specialization: string;
  bio: string | null;
  active_case_count: number;
  availability_note?: string | null;
}

export interface ConsultantAssignment {
  id: string;
  user_id: string;
  consultant_id: string;
  assigned_at: string;
}

export interface ConsultantMeet {
  id: string;
  user_id: string;
  consultant_id: string;
  status: MeetStatus;
  scheduled_at: string;
  report: string | null;
  recommendations: string | null;
  created_at: string;
}

export interface ExerciseRecommendation {
  id: string;
  tag: string;
  title: string;
  description: string;
  steps: string[];
  content_url: string | null;
  duration_minutes: number | null;
}

