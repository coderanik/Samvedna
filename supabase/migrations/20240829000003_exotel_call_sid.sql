-- Exotel call tracking on call_sessions

ALTER TABLE call_sessions
  ADD COLUMN IF NOT EXISTS exotel_call_sid TEXT;

CREATE INDEX IF NOT EXISTS idx_call_sessions_exotel_sid ON call_sessions(exotel_call_sid);

COMMENT ON COLUMN call_sessions.exotel_call_sid IS 'Exotel Call Sid for bridged/IVRS calls';
