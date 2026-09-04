-- Samvedna v2 additive schema (safe to re-run). Apply in Supabase SQL Editor.

DO $$ BEGIN
  CREATE TYPE outreach_channel AS ENUM ('chat','ivrs','sms','app_push','whatsapp','helpline_callback');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE outreach_status AS ENUM ('scheduled','sent','responded','missed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS outreach_schedule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  channel outreach_channel NOT NULL DEFAULT 'chat',
  status outreach_status NOT NULL DEFAULT 'scheduled',
  reason TEXT,
  generated_by TEXT NOT NULL DEFAULT 'cadence',
  attempt_count INT NOT NULL DEFAULT 0,
  responded_at TIMESTAMPTZ,
  checkin_id UUID REFERENCES checkins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_due ON outreach_schedule (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_outreach_case ON outreach_schedule (case_id, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS score_contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  distress_score_id UUID NOT NULL REFERENCES distress_scores(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  feature TEXT NOT NULL,
  feature_label TEXT NOT NULL,
  raw_value NUMERIC,
  weight NUMERIC,
  contribution NUMERIC NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('increases','decreases')),
  evidence TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_score_contrib ON score_contributions (distress_score_id);

CREATE TABLE IF NOT EXISTS intervention_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  support_type support_type NOT NULL,
  title TEXT NOT NULL,
  statutory_basis TEXT NOT NULL,
  responsible_authority TEXT NOT NULL,
  sla_hours INT NOT NULL,
  description TEXT NOT NULL,
  eligibility_note TEXT,
  applies_to_case_types TEXT[] DEFAULT '{}',
  min_risk_level risk_level DEFAULT 'moderate',
  active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE distress_scores
  ADD COLUMN IF NOT EXISTS component_clinical numeric,
  ADD COLUMN IF NOT EXISTS component_text numeric,
  ADD COLUMN IF NOT EXISTS component_voice numeric,
  ADD COLUMN IF NOT EXISTS component_behavioural numeric,
  ADD COLUMN IF NOT EXISTS component_context numeric,
  ADD COLUMN IF NOT EXISTS composite_version text DEFAULT 'v2.0',
  ADD COLUMN IF NOT EXISTS crisis_override boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS crisis_override_reason text;

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS next_hearing_date date,
  ADD COLUMN IF NOT EXISTS fir_number text,
  ADD COLUMN IF NOT EXISTS poa_sections text[],
  ADD COLUMN IF NOT EXISTS relief_stage text,
  ADD COLUMN IF NOT EXISTS witness_protection_status text,
  ADD COLUMN IF NOT EXISTS cadence_tier text,
  ADD COLUMN IF NOT EXISTS last_contact_at timestamptz;

INSERT INTO intervention_catalog (code, support_type, title, statutory_basis, responsible_authority, sla_hours, description, applies_to_case_types, min_risk_level)
VALUES
  ('POA_RELIEF_IMMEDIATE','financial','Immediate monetary relief','SC/ST (PoA) Rules 1995, Rule 12(4) + Annexure I','District Magistrate',168,'Immediate relief payment for eligible POA beneficiaries.','{rape,gang_rape,murder,grievous_hurt,arson,caste_based_violence}','high'),
  ('POA_WITNESS_PROTECT','witness_protection','Witness protection measures','Witness Protection Scheme 2018; PoA Act s.15A','SP / District Committee',24,'Protection review for intimidation / threat.','{witness_intimidation,rape,gang_rape,murder,caste_based_violence}','moderate'),
  ('POA_RELOCATION','relocation','Relocation / safe accommodation','Rules 1995 Rule 11; WPS 2018','District Magistrate',72,'Safe accommodation / relocation assessment.','{rape,gang_rape,witness_intimidation,caste_based_violence}','high'),
  ('POA_LEGAL_AID','legal','Free legal representation','Legal Services Authorities Act 1987; PoA s.15A(2)','DLSA Secretary',72,'Free legal aid for survivors and witnesses.','{rape,gang_rape,murder,grievous_hurt,arson,witness_intimidation,caste_based_violence}','moderate'),
  ('POA_MEDICAL','medical','Medical treatment & rehabilitation','Rules 1995 Rule 12(4) proviso','CMHO / District Hospital',24,'Medical / psychological care referral.','{rape,gang_rape,grievous_hurt,murder,caste_based_violence}','moderate'),
  ('MHA_COUNSELLING','counselling','Psychiatric / psychological care','Mental Healthcare Act 2017 s.18','DMHP / District',48,'Counselling and mental-health support.','{rape,gang_rape,murder,grievous_hurt,arson,witness_intimidation,caste_based_violence}','moderate'),
  ('MHA_CRISIS','counselling','Emergency mental-health response','MHCA 2017; Tele-MANAS 14416','Tele-MANAS / DMHP',1,'Immediate crisis mental-health response.','{rape,gang_rape,murder,witness_intimidation,caste_based_violence}','critical'),
  ('POA_TRAVEL_MAINT','financial','Travel & maintenance for court','Rules 1995 Rule 11','District Magistrate',48,'Travel/maintenance for hearing attendance.','{rape,gang_rape,murder,grievous_hurt,arson,witness_intimidation,caste_based_violence}','low'),
  ('BNSS_COMPENSATION','financial','Victim compensation scheme','BNSS s.396; NALSA scheme','DLSA',720,'Compensation scheme processing.','{rape,gang_rape,murder,grievous_hurt,arson,caste_based_violence}','moderate'),
  ('POA_VM_ESCALATE','protection','Escalate to Vigilance & Monitoring Cttee','Rules 1995 Rule 16/17','DM / Chief Secretary',720,'District/state monitoring committee escalation.','{caste_based_violence,murder,rape,gang_rape}','high')
ON CONFLICT (code) DO NOTHING;
