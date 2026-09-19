-- Chat handoff: AI → live counsellor + shared video room
-- Additive; safe if chat_messages already exists.

CREATE TABLE IF NOT EXISTS chat_handoffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  victim_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  counsellor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'joined', 'ended')),
  video_room_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_handoffs_counsellor
  ON chat_handoffs (counsellor_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_handoffs_victim
  ON chat_handoffs (victim_id, created_at DESC);

-- Allow counsellor messages in the shared thread
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_role_check;
ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_role_check
  CHECK (role IN ('user', 'assistant', 'system', 'counsellor'));

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS handoff_id UUID REFERENCES chat_handoffs(id) ON DELETE SET NULL;

ALTER TABLE chat_handoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Victims read own handoffs" ON chat_handoffs;
CREATE POLICY "Victims read own handoffs"
  ON chat_handoffs FOR SELECT USING (victim_id = auth.uid());

DROP POLICY IF EXISTS "Counsellors read assigned handoffs" ON chat_handoffs;
CREATE POLICY "Counsellors read assigned handoffs"
  ON chat_handoffs FOR SELECT
  USING (
    counsellor_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );
