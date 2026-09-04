-- Samvedna v2: multimodal distress intelligence, statutory intervention catalogue,
-- consent and audit substrate. Additive only and safe to re-run.
-- Run via Supabase SQL Editor or `supabase db push`.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE outreach_channel AS ENUM (
    'chat', 'ivrs', 'sms', 'app_push', 'whatsapp', 'helpline_callback'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE outreach_status AS ENUM (
    'scheduled', 'sent', 'responded', 'missed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE instrument_type AS ENUM (
    'phq2', 'phq9', 'gad2', 'gad7', 'pcptsd5', 'pcl5', 'cssrs', 'who5'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE consent_scope AS ENUM (
    'voice_recording', 'transcript_storage', 'llm_processing',
    'family_contact', 'data_sharing_district', 'research_anonymised'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Outreach schedule ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outreach_schedule (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  channel outreach_channel NOT NULL DEFAULT 'chat',
  status outreach_status NOT NULL DEFAULT 'scheduled',
  reason TEXT NOT NULL,
  generated_by TEXT NOT NULL DEFAULT 'cadence',
  attempt_count INT NOT NULL DEFAULT 0,
  responded_at TIMESTAMPTZ,
  checkin_id UUID REFERENCES checkins(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outreach_schedule_due
  ON outreach_schedule (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_outreach_schedule_case
  ON outreach_schedule (case_id, scheduled_for DESC);

-- ─── Engagement metrics ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engagement_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  checkin_id UUID UNIQUE REFERENCES checkins(id) ON DELETE CASCADE,
  response_latency_seconds INT,
  message_char_count INT,
  message_word_count INT,
  session_duration_seconds INT,
  turns_in_session INT,
  abandoned BOOLEAN NOT NULL DEFAULT false,
  hour_of_day INT,
  day_of_week INT,
  days_since_last_checkin NUMERIC,
  missed_outreach_count_30d INT NOT NULL DEFAULT 0,
  engagement_score INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_metrics_case
  ON engagement_metrics (case_id, created_at DESC);

-- ─── Clinical assessments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinical_assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  checkin_id UUID REFERENCES checkins(id) ON DELETE CASCADE,
  instrument instrument_type NOT NULL,
  raw_responses JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_score INT NOT NULL,
  max_score INT NOT NULL,
  severity_band TEXT NOT NULL,
  positive_screen BOOLEAN NOT NULL DEFAULT false,
  administered_via TEXT NOT NULL DEFAULT 'conversational',
  mapping_confidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clinical_assessments_case
  ON clinical_assessments (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinical_assessments_instrument
  ON clinical_assessments (instrument);

-- ─── Voice analyses ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_analyses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  checkin_id UUID REFERENCES checkins(id) ON DELETE CASCADE,
  call_session_id UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
  duration_seconds NUMERIC,
  f0_mean NUMERIC,
  f0_std NUMERIC,
  f0_range NUMERIC,
  jitter_local NUMERIC,
  shimmer_local NUMERIC,
  hnr_db NUMERIC,
  speech_rate NUMERIC,
  articulation_rate NUMERIC,
  pause_ratio NUMERIC,
  mean_pause_duration NUMERIC,
  intensity_mean NUMERIC,
  intensity_std NUMERIC,
  spectral_centroid_mean NUMERIC,
  vocal_stress_index INT,
  baseline_deviation NUMERIC,
  confidence TEXT,
  extractor TEXT,
  features_raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_analyses_case
  ON voice_analyses (case_id, created_at DESC);

-- ─── Voice baselines (one row per victim) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_baselines (
  victim_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  sample_count INT NOT NULL DEFAULT 0,
  f0_mean NUMERIC,
  f0_std NUMERIC,
  jitter_mean NUMERIC,
  shimmer_mean NUMERIC,
  hnr_mean NUMERIC,
  speech_rate_mean NUMERIC,
  pause_ratio_mean NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Score contributions (explainability ledger) ──────────────────────────────
CREATE TABLE IF NOT EXISTS score_contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  distress_score_id UUID NOT NULL REFERENCES distress_scores(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  feature TEXT NOT NULL,
  feature_label TEXT NOT NULL,
  raw_value NUMERIC,
  weight NUMERIC NOT NULL,
  contribution NUMERIC NOT NULL,
  direction TEXT NOT NULL,
  evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_contributions_score
  ON score_contributions (distress_score_id);

-- ─── Distress forecasts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS distress_forecasts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  distress_score_id UUID REFERENCES distress_scores(id) ON DELETE CASCADE,
  horizon_days INT NOT NULL DEFAULT 7,
  predicted_score NUMERIC NOT NULL,
  ci_lower NUMERIC,
  ci_upper NUMERIC,
  crisis_probability NUMERIC,
  method TEXT NOT NULL,
  model_version TEXT,
  backtest_mae NUMERIC,
  trajectory JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_distress_forecasts_case
  ON distress_forecasts (case_id, created_at DESC);

-- ─── Consent records ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  victim_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scope consent_scope NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT true,
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  policy_version TEXT NOT NULL DEFAULT 'v1.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (victim_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_consent_records_victim
  ON consent_records (victim_id);

-- ─── Audit log (append-only, hash-chained) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_role TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  case_id UUID,
  purpose TEXT,
  ip_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  entry_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_case
  ON audit_log (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
  ON audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_seq
  ON audit_log (id);

-- ─── Intervention catalogue (statutory entitlements) ──────────────────────────
CREATE TABLE IF NOT EXISTS intervention_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  support_type support_type NOT NULL,
  title TEXT NOT NULL,
  statutory_basis TEXT NOT NULL,
  responsible_authority TEXT NOT NULL,
  sla_hours INT NOT NULL,
  description TEXT NOT NULL,
  eligibility_note TEXT,
  applies_to_case_types TEXT[] NOT NULL DEFAULT '{}',
  trigger_signals TEXT[] NOT NULL DEFAULT '{}',
  min_risk_level risk_level NOT NULL DEFAULT 'moderate',
  priority_weight INT NOT NULL DEFAULT 50,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── District registry ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS district_registry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state TEXT NOT NULL,
  district TEXT NOT NULL,
  lgd_code TEXT,
  population_sc INT,
  population_st INT,
  atrocity_prone BOOLEAN DEFAULT false,
  sp_office_contact TEXT,
  dlsa_contact TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (state, district)
);

CREATE INDEX IF NOT EXISTS idx_district_registry_state
  ON district_registry (state, district);

-- ─── Constraint reconciliation ────────────────────────────────────────────────
-- Named CHECK constraints are (re)applied separately from CREATE TABLE so that a
-- database carrying an earlier revision of this migration converges on the same
-- shape. DROP + ADD is idempotent; ADD CONSTRAINT has no IF NOT EXISTS form.

ALTER TABLE outreach_schedule
  DROP CONSTRAINT IF EXISTS outreach_schedule_generated_by_check;
ALTER TABLE outreach_schedule
  ADD CONSTRAINT outreach_schedule_generated_by_check
  CHECK (generated_by IN ('cadence', 'event', 'manual', 'escalation'));

ALTER TABLE engagement_metrics
  DROP CONSTRAINT IF EXISTS engagement_metrics_engagement_score_check;
ALTER TABLE engagement_metrics
  ADD CONSTRAINT engagement_metrics_engagement_score_check
  CHECK (engagement_score IS NULL OR engagement_score BETWEEN 0 AND 100);

ALTER TABLE voice_analyses
  DROP CONSTRAINT IF EXISTS voice_analyses_vocal_stress_index_check;
ALTER TABLE voice_analyses
  ADD CONSTRAINT voice_analyses_vocal_stress_index_check
  CHECK (vocal_stress_index IS NULL OR vocal_stress_index BETWEEN 0 AND 100);

ALTER TABLE score_contributions
  DROP CONSTRAINT IF EXISTS score_contributions_channel_check;
ALTER TABLE score_contributions
  ADD CONSTRAINT score_contributions_channel_check
  CHECK (channel IN ('clinical', 'text_sentiment', 'vocal_stress', 'behavioural', 'case_context'));

ALTER TABLE score_contributions
  DROP CONSTRAINT IF EXISTS score_contributions_direction_check;
ALTER TABLE score_contributions
  ADD CONSTRAINT score_contributions_direction_check
  CHECK (direction IN ('increases', 'decreases', 'neutral'));

ALTER TABLE score_contributions
  ALTER COLUMN evidence DROP NOT NULL;

ALTER TABLE distress_forecasts
  DROP CONSTRAINT IF EXISTS distress_forecasts_crisis_probability_check;
ALTER TABLE distress_forecasts
  ADD CONSTRAINT distress_forecasts_crisis_probability_check
  CHECK (crisis_probability IS NULL OR crisis_probability BETWEEN 0 AND 1);

-- Columns absent from the earlier revision of intervention_catalog. The index
-- below depends on priority_weight, so it is created only after this point.
ALTER TABLE intervention_catalog
  ADD COLUMN IF NOT EXISTS trigger_signals TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS priority_weight INT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_intervention_catalog_active
  ON intervention_catalog (active, priority_weight DESC);

-- ─── Column additions on existing tables ──────────────────────────────────────
ALTER TABLE distress_scores
  ADD COLUMN IF NOT EXISTS component_clinical NUMERIC,
  ADD COLUMN IF NOT EXISTS component_text NUMERIC,
  ADD COLUMN IF NOT EXISTS component_voice NUMERIC,
  ADD COLUMN IF NOT EXISTS component_behavioural NUMERIC,
  ADD COLUMN IF NOT EXISTS component_context NUMERIC,
  ADD COLUMN IF NOT EXISTS active_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS composite_version TEXT DEFAULT 'v2.0',
  ADD COLUMN IF NOT EXISTS crisis_override BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crisis_override_reason TEXT;

UPDATE distress_scores SET crisis_override = false WHERE crisis_override IS NULL;
ALTER TABLE distress_scores ALTER COLUMN crisis_override SET DEFAULT false;
ALTER TABLE distress_scores ALTER COLUMN crisis_override SET NOT NULL;

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS next_hearing_date DATE,
  ADD COLUMN IF NOT EXISTS fir_number TEXT,
  ADD COLUMN IF NOT EXISTS poa_sections TEXT[],
  ADD COLUMN IF NOT EXISTS relief_stage TEXT,
  ADD COLUMN IF NOT EXISTS relief_amount_sanctioned NUMERIC,
  ADD COLUMN IF NOT EXISTS relief_amount_disbursed NUMERIC,
  ADD COLUMN IF NOT EXISTS relief_due_date DATE,
  ADD COLUMN IF NOT EXISTS witness_protection_status TEXT,
  ADD COLUMN IF NOT EXISTS cadence_tier TEXT DEFAULT 'routine',
  ADD COLUMN IF NOT EXISTS last_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consecutive_missed_outreach INT NOT NULL DEFAULT 0;

ALTER TABLE support_recommendations
  ADD COLUMN IF NOT EXISTS catalog_code TEXT,
  ADD COLUMN IF NOT EXISTS statutory_basis TEXT,
  ADD COLUMN IF NOT EXISTS responsible_authority TEXT,
  ADD COLUMN IF NOT EXISTS sla_hours INT,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_breached BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rationale TEXT;

CREATE INDEX IF NOT EXISTS idx_support_recommendations_sla
  ON support_recommendations (sla_breached, due_at);

-- ─── Seed: statutory intervention catalogue ───────────────────────────────────
INSERT INTO intervention_catalog (
  code, support_type, title, statutory_basis, responsible_authority, sla_hours,
  description, eligibility_note, applies_to_case_types, trigger_signals,
  min_risk_level, priority_weight
) VALUES
  (
    'POA_RELIEF_IMMEDIATE', 'financial', 'Immediate monetary relief',
    'SC/ST (PoA) Rules 1995, Rule 12(4) read with Annexure I',
    'District Magistrate / Collector', 168,
    'Cash relief payable to the victim or dependants as soon as the offence is reported, at the rate prescribed for the offence in Annexure I. The first instalment is due once the FIR is registered and the medical examination is complete, without waiting for the chargesheet.',
    'Available where the victim belongs to a Scheduled Caste or Scheduled Tribe and the FIR discloses an offence listed in Annexure I. Quantum varies by offence; payment is made in stages against the same annexure.',
    ARRAY['caste_based_violence', 'rape', 'gang_rape', 'murder', 'grievous_hurt', 'arson', 'social_boycott', 'land_dispossession'],
    ARRAY['financial_distress', 'relief_delay', 'loss_of_livelihood', 'displacement'],
    'moderate', 90
  ),
  (
    'POA_RELIEF_STAGED', 'financial', 'Staged relief on chargesheet and conviction',
    'SC/ST (PoA) Rules 1995, Annexure I',
    'District Magistrate / Collector', 720,
    'Second and third instalments of the Annexure I relief, released when the chargesheet is filed and again on conviction by the Special Court. Tracking these stages prevents the common failure where only the first instalment is ever paid.',
    'Applies to cases already sanctioned for immediate relief under Rule 12(4). Entitlement crystallises at chargesheet and at conviction, so eligibility should be rechecked at each case-status change.',
    ARRAY['caste_based_violence', 'rape', 'gang_rape', 'murder', 'grievous_hurt', 'arson'],
    ARRAY['relief_delay', 'financial_distress', 'case_stage_change'],
    'low', 60
  ),
  (
    'POA_WITNESS_PROTECT', 'witness_protection', 'Witness protection measures',
    'Witness Protection Scheme 2018; PoA Act s.15A(8) and s.15A(11)',
    'Superintendent of Police / District Witness Protection Committee', 24,
    'Threat analysis by the SP followed by protection measures ranging from call-record monitoring and patrolling to armed escort and identity concealment. The District Witness Protection Committee must decide on the application within the statutory timeline.',
    'Open to victims, informants and witnesses who report intimidation, inducement or threats, whether or not a separate FIR has been filed for the threat. Protection level is set by the threat-analysis report, not by the applicant.',
    ARRAY['caste_based_violence', 'witness_intimidation', 'rape', 'gang_rape', 'murder', 'grievous_hurt'],
    ARRAY['threat', 'intimidation', 'fear_for_safety', 'accused_on_bail', 'hostile_neighbourhood'],
    'moderate', 95
  ),
  (
    'POA_RELOCATION', 'relocation', 'Relocation and safe accommodation',
    'SC/ST (PoA) Rules 1995, Rule 11; Witness Protection Scheme 2018 Category A',
    'District Magistrate', 72,
    'Temporary or permanent relocation of the victim and family to a safe house or alternative accommodation, with transport and subsistence costs borne by the district administration. Used where continued residence in the locality is itself the source of risk.',
    'Considered where a threat analysis places the victim in Category A, or where the district administration records that the victim cannot safely return home. Requires the victim''s informed consent and, where children are involved, schooling continuity arrangements.',
    ARRAY['caste_based_violence', 'witness_intimidation', 'rape', 'gang_rape', 'social_boycott', 'land_dispossession'],
    ARRAY['threat', 'displacement', 'fear_for_safety', 'social_boycott', 'hostile_neighbourhood'],
    'high', 85
  ),
  (
    'POA_LEGAL_AID', 'legal', 'Free legal representation',
    'Legal Services Authorities Act 1987; PoA Act s.15A(2)',
    'District Legal Services Authority', 72,
    'Assignment of a panel advocate by the DLSA to advise the victim, assist during investigation and represent them before the Special Court. Includes help with bail-opposition, compensation applications and appeals.',
    'Members of Scheduled Castes and Scheduled Tribes are entitled to free legal services irrespective of income under s.12(a) of the 1987 Act. No means test applies.',
    ARRAY['caste_based_violence', 'rape', 'gang_rape', 'murder', 'grievous_hurt', 'arson', 'witness_intimidation', 'social_boycott', 'land_dispossession'],
    ARRAY['legal_confusion', 'court_anxiety', 'case_stage_change', 'accused_on_bail', 'no_representation'],
    'low', 70
  ),
  (
    'POA_SPECIAL_PP', 'legal', 'Special Public Prosecutor appointment',
    'SC/ST (PoA) Act 1989, s.15',
    'State Government / District Magistrate', 336,
    'Specification of a Public Prosecutor for the Special Court, or engagement of an advocate in practice for at least seven years as a Special Public Prosecutor for the case. Requested where prosecution quality is a live concern for the victim.',
    'Available for cases committed to the Special Court or Exclusive Special Court. The victim may make a representation to the District Magistrate; appointment remains a state government decision.',
    ARRAY['caste_based_violence', 'rape', 'gang_rape', 'murder', 'grievous_hurt'],
    ARRAY['case_stage_change', 'prosecution_concern', 'court_anxiety', 'witness_turning_hostile'],
    'moderate', 55
  ),
  (
    'POA_TRAVEL_MAINT', 'financial', 'Travel and maintenance for court attendance',
    'SC/ST (PoA) Rules 1995, Rule 11(1)-(4)',
    'District Magistrate', 48,
    'Reimbursement of travelling allowance, daily allowance, maintenance expenses and transport for the victim, dependants and witnesses attending investigation or trial. Payment is to be made on the day of attendance rather than in arrears.',
    'Payable to every victim and witness summoned in a PoA case, including an attendant where the person is unable to travel alone. Claims should be settled without insisting on the case reaching any particular stage.',
    ARRAY['caste_based_violence', 'rape', 'gang_rape', 'murder', 'grievous_hurt', 'arson', 'witness_intimidation'],
    ARRAY['hearing_scheduled', 'financial_distress', 'court_anxiety', 'travel_barrier'],
    'low', 45
  ),
  (
    'POA_MEDICAL', 'medical', 'Medical treatment and rehabilitation',
    'SC/ST (PoA) Rules 1995, Rule 12(4) proviso',
    'Chief Medical and Health Officer / District Hospital', 24,
    'Free medical examination, treatment and follow-up rehabilitation for injuries sustained in the atrocity, arranged through the district hospital at state cost. Covers physiotherapy, prosthetics and continuing care where injuries are lasting.',
    'Available to any victim of a listed offence; no separate sanction is needed before emergency treatment begins. Charges are recovered from the district relief head rather than from the victim.',
    ARRAY['caste_based_violence', 'rape', 'gang_rape', 'grievous_hurt', 'murder', 'arson'],
    ARRAY['physical_injury', 'somatic_complaints', 'sleep_disturbance', 'untreated_injury', 'medical_need'],
    'moderate', 80
  ),
  (
    'MHA_COUNSELLING', 'counselling', 'Psychiatric and psychological care',
    'Mental Healthcare Act 2017, s.18',
    'District Mental Health Programme', 48,
    'Structured psychiatric and psychological care through the District Mental Health Programme, including assessment, therapy and medication where indicated. Delivered close to the victim''s residence to avoid repeated travel.',
    'Every person has a right to access mental healthcare run or funded by the government under s.18; no diagnosis or referral is required to request an assessment. Care must be provided with informed consent and in a manner that protects privacy.',
    ARRAY['caste_based_violence', 'rape', 'gang_rape', 'murder', 'grievous_hurt', 'arson', 'witness_intimidation', 'social_boycott', 'land_dispossession'],
    ARRAY['anxiety', 'depressed_mood', 'sleep_disturbance', 'withdrawal', 'trauma_symptoms', 'hopelessness'],
    'moderate', 75
  ),
  (
    'MHA_CRISIS', 'counselling', 'Emergency mental health response',
    'Mental Healthcare Act 2017, s.18; Tele-MANAS 14416',
    'Tele-MANAS / District Mental Health Programme', 1,
    'Immediate crisis contact through Tele-MANAS 14416 or the district crisis team, with same-hour telephonic support and escalation to an in-person visit or emergency department where risk is imminent. Intended for suicidality, self-harm and acute agitation.',
    'Triggered by any indication of suicidal ideation, self-harm or acute crisis, without waiting for a formal assessment. Emergency care under s.18 cannot be refused for want of paperwork.',
    ARRAY['caste_based_violence', 'rape', 'gang_rape', 'murder', 'grievous_hurt', 'witness_intimidation', 'social_boycott'],
    ARRAY['suicidal_ideation', 'self_harm', 'hopelessness', 'crisis_language', 'acute_distress'],
    'high', 100
  ),
  (
    'POA_VM_ESCALATE', 'protection', 'Escalation to Vigilance and Monitoring Committee',
    'SC/ST (PoA) Rules 1995, Rule 16 (district) and Rule 17 (state)',
    'District Magistrate / Chief Secretary', 720,
    'Placement of the case before the District Vigilance and Monitoring Committee, and where unresolved before the State-level Committee, to review investigation progress, relief payment and prosecution. Committees are required to meet at fixed intervals.',
    'Appropriate where statutory timelines have lapsed — relief unpaid, investigation beyond the prescribed period, or protection measures not implemented. Escalation is administrative and does not affect the criminal proceedings.',
    ARRAY['caste_based_violence', 'rape', 'gang_rape', 'murder', 'grievous_hurt', 'social_boycott', 'land_dispossession'],
    ARRAY['relief_delay', 'sla_breach', 'investigation_stalled', 'protection_not_implemented'],
    'high', 65
  ),
  (
    'POA_ATROCITY_PRONE', 'protection', 'Atrocity-prone area protection measures',
    'SC/ST (PoA) Rules 1995, Rule 3',
    'Superintendent of Police / District Magistrate', 168,
    'Preventive measures for areas identified as atrocity-prone: police picketing, patrolling, cancellation of arms licences of likely offenders, provision of arms licences to vulnerable members, and deployment of special police force. Applied to the locality rather than the individual.',
    'Invoked where the district or a specific locality has been identified as atrocity-prone under Rule 3, or where a pattern of repeat incidents is recorded. Complements individual protection rather than replacing it.',
    ARRAY['caste_based_violence', 'social_boycott', 'land_dispossession', 'arson', 'witness_intimidation'],
    ARRAY['hostile_neighbourhood', 'repeat_incidents', 'social_boycott', 'collective_threat', 'atrocity_prone_district'],
    'moderate', 50
  ),
  (
    'BNSS_COMPENSATION', 'financial', 'Victim compensation scheme',
    'BNSS 2023 s.396 (formerly CrPC s.357A); NALSA Compensation Scheme',
    'District Legal Services Authority', 720,
    'Compensation from the state victim compensation fund, assessed by the DLSA on recommendation of the court or on the victim''s own application. Independent of, and additional to, relief paid under the PoA Rules.',
    'Available whether or not the accused is traced, tried or convicted, including where the trial ends in acquittal. Quantum follows the state scheme read with the NALSA model scheme, subject to the district authority''s inquiry.',
    ARRAY['caste_based_violence', 'rape', 'gang_rape', 'murder', 'grievous_hurt', 'arson', 'land_dispossession'],
    ARRAY['financial_distress', 'loss_of_livelihood', 'accused_untraced', 'acquittal', 'case_stage_change'],
    'low', 55
  )
ON CONFLICT (code) DO UPDATE SET
  support_type = EXCLUDED.support_type,
  title = EXCLUDED.title,
  statutory_basis = EXCLUDED.statutory_basis,
  responsible_authority = EXCLUDED.responsible_authority,
  sla_hours = EXCLUDED.sla_hours,
  description = EXCLUDED.description,
  eligibility_note = EXCLUDED.eligibility_note,
  applies_to_case_types = EXCLUDED.applies_to_case_types,
  trigger_signals = EXCLUDED.trigger_signals,
  min_risk_level = EXCLUDED.min_risk_level,
  priority_weight = EXCLUDED.priority_weight,
  active = true;

-- ─── Seed: district registry ──────────────────────────────────────────────────
-- LGD codes and population figures are indicative reference values for the pilot
-- districts, not an authoritative extract from the LGD directory or Census tables.
INSERT INTO district_registry (
  state, district, lgd_code, population_sc, population_st, atrocity_prone
) VALUES
  ('Rajasthan', 'Jaipur', '121', 1030000, 520000, false),
  ('Rajasthan', 'Nagaur', '116', 620000, 21000, true),
  ('Rajasthan', 'Alwar', '112', 640000, 290000, true),
  ('Rajasthan', 'Bharatpur', '113', 530000, 8000, false),
  ('Rajasthan', 'Ajmer', '110', 460000, 60000, false),
  ('Tamil Nadu', 'Chennai', '603', 830000, 30000, false),
  ('Tamil Nadu', 'Villupuram', '616', 890000, 41000, true),
  ('Tamil Nadu', 'Cuddalore', '604', 690000, 22000, false),
  ('Tamil Nadu', 'Madurai', '610', 460000, 12000, false),
  ('Uttar Pradesh', 'Lucknow', '158', 950000, 8000, false),
  ('Uttar Pradesh', 'Azamgarh', '175', 1130000, 4000, true),
  ('Uttar Pradesh', 'Gorakhpur', '168', 950000, 6000, false),
  ('Uttar Pradesh', 'Varanasi', '181', 540000, 5000, false),
  ('Uttar Pradesh', 'Meerut', '135', 570000, 2000, false),
  ('Bihar', 'Patna', '231', 930000, 15000, false),
  ('Bihar', 'Gaya', '225', 1240000, 12000, true),
  ('Bihar', 'Nalanda', '230', 580000, 6000, false),
  ('Madhya Pradesh', 'Bhopal', '442', 350000, 80000, false),
  ('Madhya Pradesh', 'Gwalior', '425', 380000, 60000, false),
  ('Madhya Pradesh', 'Morena', '421', 380000, 6000, true),
  ('Madhya Pradesh', 'Sagar', '435', 460000, 210000, false),
  ('Maharashtra', 'Pune', '522', 1050000, 400000, false),
  ('Maharashtra', 'Nagpur', '505', 900000, 400000, false),
  ('Maharashtra', 'Ahmednagar', '521', 540000, 380000, true),
  ('Karnataka', 'Bengaluru Urban', '572', 1100000, 240000, false),
  ('Karnataka', 'Kalaburagi', '556', 570000, 130000, false),
  ('Karnataka', 'Bidar', '555', 380000, 100000, true),
  ('Gujarat', 'Ahmedabad', '474', 730000, 130000, false)
ON CONFLICT (state, district) DO UPDATE SET
  lgd_code = EXCLUDED.lgd_code,
  population_sc = EXCLUDED.population_sc,
  population_st = EXCLUDED.population_st,
  atrocity_prone = EXCLUDED.atrocity_prone;

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE outreach_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE distress_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE intervention_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE district_registry ENABLE ROW LEVEL SECURITY;

-- ─── Outreach schedule policies ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Victims can read own outreach schedule" ON outreach_schedule;
CREATE POLICY "Victims can read own outreach schedule"
  ON outreach_schedule FOR SELECT
  USING (
    case_id IN (SELECT id FROM cases WHERE victim_id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff can read assigned outreach schedule" ON outreach_schedule;
CREATE POLICY "Staff can read assigned outreach schedule"
  ON outreach_schedule FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can read all outreach schedule" ON outreach_schedule;
CREATE POLICY "Admins can read all outreach schedule"
  ON outreach_schedule FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── Engagement metrics policies ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Victims can read own engagement metrics" ON engagement_metrics;
CREATE POLICY "Victims can read own engagement metrics"
  ON engagement_metrics FOR SELECT
  USING (
    case_id IN (SELECT id FROM cases WHERE victim_id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff can read assigned engagement metrics" ON engagement_metrics;
CREATE POLICY "Staff can read assigned engagement metrics"
  ON engagement_metrics FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can read all engagement metrics" ON engagement_metrics;
CREATE POLICY "Admins can read all engagement metrics"
  ON engagement_metrics FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── Clinical assessments policies ────────────────────────────────────────────
DROP POLICY IF EXISTS "Victims can read own clinical assessments" ON clinical_assessments;
CREATE POLICY "Victims can read own clinical assessments"
  ON clinical_assessments FOR SELECT
  USING (
    case_id IN (SELECT id FROM cases WHERE victim_id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff can read assigned clinical assessments" ON clinical_assessments;
CREATE POLICY "Staff can read assigned clinical assessments"
  ON clinical_assessments FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can read all clinical assessments" ON clinical_assessments;
CREATE POLICY "Admins can read all clinical assessments"
  ON clinical_assessments FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── Voice analyses policies ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Victims can read own voice analyses" ON voice_analyses;
CREATE POLICY "Victims can read own voice analyses"
  ON voice_analyses FOR SELECT
  USING (
    case_id IN (SELECT id FROM cases WHERE victim_id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff can read assigned voice analyses" ON voice_analyses;
CREATE POLICY "Staff can read assigned voice analyses"
  ON voice_analyses FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can read all voice analyses" ON voice_analyses;
CREATE POLICY "Admins can read all voice analyses"
  ON voice_analyses FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── Voice baselines policies ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Victims can read own voice baseline" ON voice_baselines;
CREATE POLICY "Victims can read own voice baseline"
  ON voice_baselines FOR SELECT
  USING (victim_id = auth.uid());

DROP POLICY IF EXISTS "Staff can read assigned voice baselines" ON voice_baselines;
CREATE POLICY "Staff can read assigned voice baselines"
  ON voice_baselines FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND victim_id IN (
      SELECT victim_id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can read all voice baselines" ON voice_baselines;
CREATE POLICY "Admins can read all voice baselines"
  ON voice_baselines FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── Score contributions policies (joined through distress_scores) ────────────
DROP POLICY IF EXISTS "Victims can read own score contributions" ON score_contributions;
CREATE POLICY "Victims can read own score contributions"
  ON score_contributions FOR SELECT
  USING (
    distress_score_id IN (
      SELECT ds.id FROM distress_scores ds
      JOIN cases c ON c.id = ds.case_id
      WHERE c.victim_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Staff can read assigned score contributions" ON score_contributions;
CREATE POLICY "Staff can read assigned score contributions"
  ON score_contributions FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND distress_score_id IN (
      SELECT ds.id FROM distress_scores ds
      JOIN cases c ON c.id = ds.case_id
      WHERE c.assigned_counsellor_id = auth.uid()
         OR c.assigned_official_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can read all score contributions" ON score_contributions;
CREATE POLICY "Admins can read all score contributions"
  ON score_contributions FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── Distress forecasts policies ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Victims can read own distress forecasts" ON distress_forecasts;
CREATE POLICY "Victims can read own distress forecasts"
  ON distress_forecasts FOR SELECT
  USING (
    case_id IN (SELECT id FROM cases WHERE victim_id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff can read assigned distress forecasts" ON distress_forecasts;
CREATE POLICY "Staff can read assigned distress forecasts"
  ON distress_forecasts FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND case_id IN (
      SELECT id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can read all distress forecasts" ON distress_forecasts;
CREATE POLICY "Admins can read all distress forecasts"
  ON distress_forecasts FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── Consent records policies ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Victims can manage own consent records" ON consent_records;
CREATE POLICY "Victims can manage own consent records"
  ON consent_records FOR ALL
  USING (victim_id = auth.uid())
  WITH CHECK (victim_id = auth.uid());

DROP POLICY IF EXISTS "Staff can read assigned consent records" ON consent_records;
CREATE POLICY "Staff can read assigned consent records"
  ON consent_records FOR SELECT
  USING (
    public.get_my_role() IN ('counsellor', 'official')
    AND victim_id IN (
      SELECT victim_id FROM cases
      WHERE assigned_counsellor_id = auth.uid()
         OR assigned_official_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can read all consent records" ON consent_records;
CREATE POLICY "Admins can read all consent records"
  ON consent_records FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── Audit log policies ───────────────────────────────────────────────────────
-- SELECT-only by design. No INSERT, UPDATE or DELETE policy exists for any
-- authenticated role: entries are written exclusively by the service role, which
-- bypasses RLS. The absence of write policies is what makes the table
-- append-only from the application's perspective, and it must stay that way for
-- the prev_hash / entry_hash chain to remain a meaningful tamper-evidence
-- record. Do not add a write policy here.
DROP POLICY IF EXISTS "Victims can read audit entries for own cases" ON audit_log;
CREATE POLICY "Victims can read audit entries for own cases"
  ON audit_log FOR SELECT
  USING (
    case_id IN (SELECT id FROM cases WHERE victim_id = auth.uid())
  );

DROP POLICY IF EXISTS "Admins can read all audit entries" ON audit_log;
CREATE POLICY "Admins can read all audit entries"
  ON audit_log FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── Reference table policies (read-only for authenticated users) ─────────────
DROP POLICY IF EXISTS "Authenticated users can read intervention catalog" ON intervention_catalog;
CREATE POLICY "Authenticated users can read intervention catalog"
  ON intervention_catalog FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can read district registry" ON district_registry;
CREATE POLICY "Authenticated users can read district registry"
  ON district_registry FOR SELECT
  TO authenticated
  USING (true);

-- ─── Admin read access on existing tables ─────────────────────────────────────
-- The initial schema granted the admin role almost no policies, leaving admin
-- dashboards dependent on the service role. These restore read access.
DROP POLICY IF EXISTS "Admins can read all cases" ON cases;
CREATE POLICY "Admins can read all cases"
  ON cases FOR SELECT
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins can read all alerts" ON alerts;
CREATE POLICY "Admins can read all alerts"
  ON alerts FOR SELECT
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins can read all distress scores" ON distress_scores;
CREATE POLICY "Admins can read all distress scores"
  ON distress_scores FOR SELECT
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins can read all checkins" ON checkins;
CREATE POLICY "Admins can read all checkins"
  ON checkins FOR SELECT
  USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins can read all support recommendations" ON support_recommendations;
CREATE POLICY "Admins can read all support recommendations"
  ON support_recommendations FOR SELECT
  USING (public.get_my_role() = 'admin');

-- ─── Table comments ───────────────────────────────────────────────────────────
COMMENT ON TABLE outreach_schedule IS 'Planned and attempted proactive contacts with a survivor, one row per scheduled touchpoint';
COMMENT ON TABLE engagement_metrics IS 'Behavioural signals derived from how a check-in was completed, not from what it said';
COMMENT ON TABLE clinical_assessments IS 'Scored screening instruments (PHQ, GAD, PC-PTSD, C-SSRS) mapped from conversation or self-report';
COMMENT ON TABLE voice_analyses IS 'Acoustic features and derived vocal stress index for a single voice check-in or call';
COMMENT ON TABLE voice_baselines IS 'Rolling per-victim acoustic baseline used to judge deviation in later voice analyses';
COMMENT ON TABLE score_contributions IS 'Per-feature explainability ledger showing how each signal moved a distress score';
COMMENT ON TABLE distress_forecasts IS 'Forward-looking distress trajectory and crisis probability for a case horizon';
COMMENT ON TABLE consent_records IS 'Granular, revocable consent held by the survivor for each processing purpose';
COMMENT ON TABLE audit_log IS 'Append-only hash-chained record of access and action on sensitive resources; written by service role only';
COMMENT ON TABLE intervention_catalog IS 'Statutory entitlements under the PoA Act, Rules and allied law with responsible authority and SLA';
COMMENT ON TABLE district_registry IS 'Reference data for pilot districts including SC/ST population and atrocity-prone flag';

-- ─── Phase 1 extensions: attrition risk, victim confidence, statutory factors ─
-- Additive ALTER TABLE columns — safe to re-run.

DO $$ BEGIN
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS accused_bail_status TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS bail_granted_date DATE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS accused_village_same_as_victim BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS protection_order_active BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS village_or_cluster_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS attrition_risk INT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS victim_confidence_index INT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS incident_date DATE;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS adjournment_count INT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD COLUMN IF NOT EXISTS protection_requested BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Constraints
DO $$ BEGIN
  ALTER TABLE cases ADD CONSTRAINT cases_attrition_risk_range CHECK (attrition_risk BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD CONSTRAINT cases_victim_confidence_range CHECK (victim_confidence_index BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cases ADD CONSTRAINT cases_adjournment_count_nonnegative CHECK (adjournment_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN cases.accused_bail_status IS 'Bail status of the accused: pending, granted, denied, revoked';
COMMENT ON COLUMN cases.bail_granted_date IS 'Date when bail was granted, if applicable';
COMMENT ON COLUMN cases.accused_village_same_as_victim IS 'Whether accused resides in the same village/locality as victim — proximity risk factor';
COMMENT ON COLUMN cases.protection_order_active IS 'Whether a protection order under PoA Act is currently active';
COMMENT ON COLUMN cases.village_or_cluster_id IS 'Victim village or cluster identifier for spatial risk analysis';
COMMENT ON COLUMN cases.attrition_risk IS 'Case attrition risk score 0-100: likelihood of withdrawal or abandonment';
COMMENT ON COLUMN cases.victim_confidence_index IS 'Victim confidence in justice system 0-100: based on responsiveness and progress';
COMMENT ON COLUMN cases.incident_date IS 'Date of the alleged incident, if known and distinct from FIR date';
COMMENT ON COLUMN cases.adjournment_count IS 'Number of court adjournments to date';
COMMENT ON COLUMN cases.protection_requested IS 'Whether victim requested a protection order';
