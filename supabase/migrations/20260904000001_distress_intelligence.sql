-- Samvedna NHAA presentation upgrade: channels, stages, distress intelligence fields

-- Case lifecycle aligned to justice journey
ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'complaint_registration';
ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'compensation';
ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'protection_followup';

-- Multi-channel intake
ALTER TYPE checkin_channel ADD VALUE IF NOT EXISTS 'portal';
ALTER TYPE checkin_channel ADD VALUE IF NOT EXISTS 'chatbot';
ALTER TYPE checkin_channel ADD VALUE IF NOT EXISTS 'nhaa_14566';
ALTER TYPE checkin_channel ADD VALUE IF NOT EXISTS 'helpline';

-- Intervention types
ALTER TYPE support_type ADD VALUE IF NOT EXISTS 'relocation';
ALTER TYPE support_type ADD VALUE IF NOT EXISTS 'witness_protection';
ALTER TYPE support_type ADD VALUE IF NOT EXISTS 'follow_up';

-- Distress intelligence columns (nullable for backward compatibility)
ALTER TABLE distress_scores
  ADD COLUMN IF NOT EXISTS trend_direction TEXT
    CHECK (trend_direction IS NULL OR trend_direction IN ('rising', 'stable', 'improving')),
  ADD COLUMN IF NOT EXISTS escalation_risk_7d INTEGER
    CHECK (escalation_risk_7d IS NULL OR (escalation_risk_7d >= 0 AND escalation_risk_7d <= 100)),
  ADD COLUMN IF NOT EXISTS escalation_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS recommended_interventions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sentiment TEXT,
  ADD COLUMN IF NOT EXISTS emotion_indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS contributing_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS model_confidence TEXT
    CHECK (model_confidence IS NULL OR model_confidence IN ('high', 'medium', 'low', 'fallback')),
  ADD COLUMN IF NOT EXISTS prediction_method TEXT NOT NULL DEFAULT 'mvp_rules_plus_llm';

CREATE INDEX IF NOT EXISTS idx_distress_scores_escalation
  ON distress_scores (escalation_risk_7d DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases (status);
CREATE INDEX IF NOT EXISTS idx_cases_state_district ON cases (state, district);

COMMENT ON COLUMN distress_scores.escalation_risk_7d IS
  'MVP predictive-risk band 0-100 (rules + LLM). Not a clinically validated forecast.';
COMMENT ON COLUMN distress_scores.prediction_method IS
  'mvp_rules_plus_llm | llm_only | rules_only — honest labelling for demos.';
