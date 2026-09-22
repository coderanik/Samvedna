-- Victim first-login onboarding: questionnaire → distress score → counsellor allotment.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.onboarding_completed_at IS
  'Set when a victim finishes the first-login onboarding questionnaire.';

CREATE TABLE IF NOT EXISTS victim_onboarding_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  transcript TEXT,
  distress_score_id UUID REFERENCES distress_scores(id) ON DELETE SET NULL,
  consultant_id UUID REFERENCES consultants(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_victim_onboarding_user
  ON victim_onboarding_responses (user_id);

ALTER TABLE victim_onboarding_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Victims read own onboarding" ON victim_onboarding_responses;
CREATE POLICY "Victims read own onboarding"
  ON victim_onboarding_responses FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Staff read onboarding" ON victim_onboarding_responses;
CREATE POLICY "Staff read onboarding"
  ON victim_onboarding_responses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role IN ('counsellor', 'admin')
    )
  );

-- Existing victims with a case or check-in already skipped the new gate.
UPDATE profiles p
SET onboarding_completed_at = COALESCE(p.created_at, now())
WHERE p.role = 'victim'
  AND p.onboarding_completed_at IS NULL
  AND (
    EXISTS (SELECT 1 FROM cases c WHERE c.victim_id = p.id)
    OR EXISTS (SELECT 1 FROM checkins ch WHERE ch.victim_id = p.id)
  );
