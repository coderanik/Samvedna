-- Sprint 1: judiciary intake metadata, email outbox, counselling series, emotion signals.

-- Invite payload on onboarding tokens (victim pre-fill)
ALTER TABLE onboarding_tokens
  ADD COLUMN IF NOT EXISTS invite_email TEXT,
  ADD COLUMN IF NOT EXISTS invite_full_name TEXT,
  ADD COLUMN IF NOT EXISTS invite_phone TEXT,
  ADD COLUMN IF NOT EXISTS invite_language TEXT DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS district_notify_email TEXT,
  ADD COLUMN IF NOT EXISTS official_notify_email TEXT;

-- Case authority contacts + playbook
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS district_notify_email TEXT,
  ADD COLUMN IF NOT EXISTS official_notify_email TEXT,
  ADD COLUMN IF NOT EXISTS playbook_id TEXT,
  ADD COLUMN IF NOT EXISTS intake_channel TEXT DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS intake_brief TEXT,
  ADD COLUMN IF NOT EXISTS judiciary_ref TEXT;

-- Email delivery log (production audit)
CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  template TEXT,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  alert_id UUID REFERENCES alerts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  provider_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_case ON email_outbox (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox (status, created_at DESC);

-- Daily counselling series
CREATE TABLE IF NOT EXISTS counselling_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  victim_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  counsellor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  consultant_id UUID,
  duration_minutes INT NOT NULL DEFAULT 60,
  days INT NOT NULL DEFAULT 7,
  starts_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, status) -- one active series per case (soft: app enforces)
);

CREATE TABLE IF NOT EXISTS counselling_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES counselling_series(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  victim_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  counsellor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'scheduled',
  video_room_url TEXT,
  meet_id UUID,
  reminder_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_counselling_sessions_victim
  ON counselling_sessions (victim_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_counselling_sessions_counsellor
  ON counselling_sessions (counsellor_id, scheduled_at);

-- Emotion / sentiment snapshot per distress score
CREATE TABLE IF NOT EXISTS emotion_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distress_score_id UUID REFERENCES distress_scores(id) ON DELETE CASCADE,
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  checkin_id UUID REFERENCES checkins(id) ON DELETE SET NULL,
  sentiment TEXT,
  valence NUMERIC,
  arousal NUMERIC,
  dominant_emotion TEXT,
  emotions JSONB NOT NULL DEFAULT '{}'::jsonb,
  voice_stress NUMERIC,
  speaking_rate NUMERIC,
  pause_ratio NUMERIC,
  source TEXT NOT NULL DEFAULT 'text_llm',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emotion_signals_case
  ON emotion_signals (case_id, created_at DESC);

-- Forecast snapshots
CREATE TABLE IF NOT EXISTS escalation_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  risk_7d INT NOT NULL,
  risk_14d INT,
  trend TEXT,
  drivers JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence TEXT NOT NULL DEFAULT 'medium',
  honesty_note TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT 'heuristic_v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalation_forecasts_case
  ON escalation_forecasts (case_id, created_at DESC);

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE counselling_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE counselling_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE emotion_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_forecasts ENABLE ROW LEVEL SECURITY;

-- Staff read policies (service role bypasses RLS for API)
DROP POLICY IF EXISTS "Staff read email_outbox" ON email_outbox;
CREATE POLICY "Staff read email_outbox" ON email_outbox FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'official', 'counsellor')));

DROP POLICY IF EXISTS "Victims read own counselling" ON counselling_sessions;
CREATE POLICY "Victims read own counselling" ON counselling_sessions FOR SELECT
  USING (auth.uid() = victim_id);

DROP POLICY IF EXISTS "Staff read counselling_sessions" ON counselling_sessions;
CREATE POLICY "Staff read counselling_sessions" ON counselling_sessions FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'official', 'counsellor')));

DROP POLICY IF EXISTS "Staff read emotion_signals" ON emotion_signals;
CREATE POLICY "Staff read emotion_signals" ON emotion_signals FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'official', 'counsellor')));

DROP POLICY IF EXISTS "Staff read escalation_forecasts" ON escalation_forecasts;
CREATE POLICY "Staff read escalation_forecasts" ON escalation_forecasts FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'official', 'counsellor')));
