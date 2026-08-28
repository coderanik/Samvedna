ALTER TYPE checkin_channel ADD VALUE IF NOT EXISTS 'ai_voice';

-- Call sessions: counsellor (high/critical) vs AI voice (low/moderate)

CREATE TYPE call_type AS ENUM ('counsellor', 'ai_voice');
CREATE TYPE call_status AS ENUM ('requested', 'ringing', 'in_progress', 'completed', 'missed', 'cancelled');

CREATE TABLE call_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  victim_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  counsellor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  call_type call_type NOT NULL,
  status call_status NOT NULL DEFAULT 'requested',
  risk_level_at_call risk_level NOT NULL,
  distress_score_at_call INTEGER,
  transcript TEXT,
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_call_sessions_case ON call_sessions(case_id);
CREATE INDEX idx_call_sessions_victim ON call_sessions(victim_id);
CREATE INDEX idx_call_sessions_counsellor ON call_sessions(counsellor_id);
CREATE INDEX idx_call_sessions_status ON call_sessions(status);

ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Victims can read own call sessions"
  ON call_sessions FOR SELECT
  USING (victim_id = auth.uid());

CREATE POLICY "Victims can insert own call sessions"
  ON call_sessions FOR INSERT
  WITH CHECK (victim_id = auth.uid());

CREATE POLICY "Counsellors can read assigned call sessions"
  ON call_sessions FOR SELECT
  USING (
    counsellor_id = auth.uid()
    OR case_id IN (SELECT id FROM cases WHERE assigned_counsellor_id = auth.uid())
  );

CREATE POLICY "Counsellors can update assigned call sessions"
  ON call_sessions FOR UPDATE
  USING (
    counsellor_id = auth.uid()
    OR case_id IN (SELECT id FROM cases WHERE assigned_counsellor_id = auth.uid())
  );

COMMENT ON TABLE call_sessions IS 'High/critical → counsellor call; low/moderate → AI voice call';
