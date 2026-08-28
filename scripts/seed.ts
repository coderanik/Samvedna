#!/usr/bin/env tsx
/**
 * Samvedna seed script — creates demo auth users, profiles, cases, check-ins,
 * distress scores, and alerts for local development.
 *
 * Usage:
 *   pnpm seed
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (root or apps/api).
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env") });
dotenv.config({ path: resolve(__dirname, "../apps/api/.env") });

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing Supabase credentials. Set in .env:\n" +
      "  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)\n" +
      "  SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PASSWORD = "Samvedna@2024";

interface SeedUser {
  email: string;
  role: "admin" | "official" | "counsellor" | "victim";
  full_name: string;
  preferred_language: string;
  phone_number?: string;
}

const USERS: SeedUser[] = [
  {
    email: "admin@samvedna.demo",
    role: "admin",
    full_name: "System Admin",
    preferred_language: "en",
  },
  {
    email: "official@samvedna.demo",
    role: "official",
    full_name: "Rajesh Kumar (District Nodal Officer)",
    preferred_language: "en",
    phone_number: "+919876543210",
  },
  {
    email: "counsellor1@samvedna.demo",
    role: "counsellor",
    full_name: "Dr. Priya Sharma",
    preferred_language: "hi",
    phone_number: "+919876543211",
  },
  {
    email: "counsellor2@samvedna.demo",
    role: "counsellor",
    full_name: "Dr. Ananya Iyer",
    preferred_language: "ta",
    phone_number: "+919876543212",
  },
  {
    email: "victim1@samvedna.demo",
    role: "victim",
    full_name: "Meera Devi",
    preferred_language: "hi",
    phone_number: "+919800000001",
  },
  {
    email: "victim2@samvedna.demo",
    role: "victim",
    full_name: "Lakshmi Rajan",
    preferred_language: "ta",
    phone_number: "+919800000002",
  },
  {
    email: "victim3@samvedna.demo",
    role: "victim",
    full_name: "Sunita Yadav",
    preferred_language: "hi",
    phone_number: "+919800000003",
  },
  {
    email: "victim4@samvedna.demo",
    role: "victim",
    full_name: "Fatima Khan",
    preferred_language: "en",
    phone_number: "+919800000004",
  },
];

async function createOrGetUser(user: SeedUser): Promise<string> {
  const { data: existing } = await supabase.auth.admin.listUsers();
  const found = existing?.users?.find((u) => u.email === user.email);
  if (found) {
    console.log(`  ✓ User exists: ${user.email}`);
    await supabase
      .from("profiles")
      .update({
        role: user.role,
        full_name: user.full_name,
        preferred_language: user.preferred_language,
        phone_number: user.phone_number ?? null,
      })
      .eq("id", found.id);
    return found.id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: user.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: {
      role: user.role,
      full_name: user.full_name,
      preferred_language: user.preferred_language,
      phone_number: user.phone_number,
    },
  });

  if (error) throw new Error(`Failed to create ${user.email}: ${error.message}`);
  console.log(`  + Created user: ${user.email}`);
  return data.user!.id;
}

interface CaseSeed {
  case_number: string;
  victim_email: string;
  counsellor_email: string;
  case_type: string;
  status: "investigation" | "trial" | "rehabilitation" | "closed";
  district: string;
  state: string;
}

const CASES: CaseSeed[] = [
  {
    case_number: "SAM-2024-001",
    victim_email: "victim1@samvedna.demo",
    counsellor_email: "counsellor1@samvedna.demo",
    case_type: "Atrocity Act — SC/ST",
    status: "investigation",
    district: "Jaipur",
    state: "Rajasthan",
  },
  {
    case_number: "SAM-2024-002",
    victim_email: "victim2@samvedna.demo",
    counsellor_email: "counsellor2@samvedna.demo",
    case_type: "Domestic Violence",
    status: "trial",
    district: "Chennai",
    state: "Tamil Nadu",
  },
  {
    case_number: "SAM-2024-003",
    victim_email: "victim3@samvedna.demo",
    counsellor_email: "counsellor1@samvedna.demo",
    case_type: "Sexual Assault",
    status: "rehabilitation",
    district: "Lucknow",
    state: "Uttar Pradesh",
  },
  {
    case_number: "SAM-2024-004",
    victim_email: "victim4@samvedna.demo",
    counsellor_email: "counsellor2@samvedna.demo",
    case_type: "Witness Protection",
    status: "investigation",
    district: "Jaipur",
    state: "Rajasthan",
  },
];

interface CheckinSeed {
  transcript: string;
  score: number;
  risk_level: "low" | "moderate" | "high" | "critical";
  signals: string[];
  reasoning: string;
  days_ago: number;
}

const CHECKIN_TEMPLATES: Record<string, CheckinSeed[]> = {
  "SAM-2024-001": [
    {
      transcript:
        "I'm doing okay today. Slept better last night. My neighbour checked on me.",
      score: 28,
      risk_level: "low",
      signals: ["mild_anxiety"],
      reasoning:
        "Victim reports improved sleep and social contact. Mild residual anxiety but overall stable.",
      days_ago: 14,
    },
    {
      transcript:
        "Thoda tension hai. Case ki hearing postpone ho gayi. Nahi pata kab hoga ab.",
      score: 45,
      risk_level: "moderate",
      signals: ["anxiety", "legal_stress", "uncertainty"],
      reasoning:
        "Adjournment causing increased anxiety and uncertainty about case timeline. Moderate distress indicators present.",
      days_ago: 7,
    },
    {
      transcript:
        "Bahut darr lag raha hai. Un log ne phir se message kiya. Main bahar nahi ja rahi.",
      score: 72,
      risk_level: "high",
      signals: ["fear", "threat_perception", "social_withdrawal", "safety_concern"],
      reasoning:
        "New threatening messages reported. Victim is isolating and expressing significant fear. Safety concerns elevated.",
      days_ago: 2,
    },
  ],
  "SAM-2024-002": [
    {
      transcript:
        "நான் சரியாக இருக்கிறேன். குழந்தைகள் நன்றாக படிக்கிறார்கள்.",
      score: 22,
      risk_level: "low",
      signals: [],
      reasoning: "Victim reports stable mood and positive focus on children. No distress signals detected.",
      days_ago: 10,
    },
    {
      transcript:
        "Court la enna nadakkum nu theriyala. Oru tension irukku.",
      score: 38,
      risk_level: "moderate",
      signals: ["anxiety", "legal_stress"],
      reasoning: "Trial uncertainty causing moderate anxiety. No acute safety concerns at this time.",
      days_ago: 5,
    },
  ],
  "SAM-2024-003": [
    {
      transcript: "Aaj thoda better feel ho raha hai. Counselling session achhi thi.",
      score: 35,
      risk_level: "moderate",
      signals: ["recovery_progress"],
      reasoning: "Positive response to counselling session. Score trending toward moderate-low range.",
      days_ago: 8,
    },
    {
      transcript:
        "Paise ki problem hai. Compensation abhi tak nahi aaya. Ghar ka kharcha mushkil ho raha hai.",
      score: 58,
      risk_level: "moderate",
      signals: ["financial_stress", "hopelessness"],
      reasoning:
        "Compensation delay causing financial stress and hopelessness. Trend warrants monitoring.",
      days_ago: 3,
    },
    {
      transcript:
        "Kabhi kabhi lagta hai kuch nahi badlega. Neend bhi nahi aati properly.",
      score: 81,
      risk_level: "critical",
      signals: [
        "hopelessness",
        "sleep_disturbance",
        "depression_indicators",
        "isolation",
      ],
      reasoning:
        "Critical indicators: persistent hopelessness, sleep disturbance, and emotional exhaustion. Immediate outreach recommended.",
      days_ago: 1,
    },
  ],
  "SAM-2024-004": [
    {
      transcript:
        "I'm managing. Taking things one day at a time. The support group helps.",
      score: 30,
      risk_level: "low",
      signals: ["coping_active"],
      reasoning: "Active coping strategies in place. Support group engagement is a protective factor.",
      days_ago: 6,
    },
  ],
};

async function main() {
  console.log("\n🌱 Samvedna seed script\n");

  // Create users
  console.log("Creating users...");
  const userIds: Record<string, string> = {};
  for (const user of USERS) {
    userIds[user.email] = await createOrGetUser(user);
  }

  const officialId = userIds["official@samvedna.demo"];

  // Create cases
  console.log("\nCreating cases...");
  const caseIds: Record<string, string> = {};

  for (const c of CASES) {
    const victimId = userIds[c.victim_email];
    const counsellorId = userIds[c.counsellor_email];

    const { data: existing } = await supabase
      .from("cases")
      .select("id")
      .eq("case_number", c.case_number)
      .single();

    if (existing) {
      caseIds[c.case_number] = existing.id;
      console.log(`  ✓ Case exists: ${c.case_number}`);
      continue;
    }

    const { data, error } = await supabase
      .from("cases")
      .insert({
        victim_id: victimId,
        case_number: c.case_number,
        case_type: c.case_type,
        status: c.status,
        assigned_counsellor_id: counsellorId,
        assigned_official_id: officialId,
        district: c.district,
        state: c.state,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create case ${c.case_number}: ${error.message}`);
    caseIds[c.case_number] = data.id;
    console.log(`  + Created case: ${c.case_number}`);
  }

  // Create check-ins and distress scores
  console.log("\nCreating check-ins and distress scores...");
  for (const [caseNumber, checkins] of Object.entries(CHECKIN_TEMPLATES)) {
    const caseId = caseIds[caseNumber];
    const caseSeed = CASES.find((c) => c.case_number === caseNumber)!;
    const victimId = userIds[caseSeed.victim_email];

    for (const checkin of checkins) {
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - checkin.days_ago);

      // Skip if check-in with similar transcript already exists
      const { data: existingCheckin } = await supabase
        .from("checkins")
        .select("id")
        .eq("case_id", caseId)
        .eq("raw_transcript", checkin.transcript)
        .single();

      if (existingCheckin) {
        console.log(`  ✓ Check-in exists for ${caseNumber}`);
        continue;
      }

      const { data: checkinRow, error: checkinError } = await supabase
        .from("checkins")
        .insert({
          case_id: caseId,
          victim_id: victimId,
          channel: "chat",
          raw_transcript: checkin.transcript,
          created_at: createdAt.toISOString(),
        })
        .select("id")
        .single();

      if (checkinError) {
        throw new Error(`Checkin insert failed: ${checkinError.message}`);
      }

      const { data: scoreRow, error: scoreError } = await supabase
        .from("distress_scores")
        .insert({
          checkin_id: checkinRow.id,
          case_id: caseId,
          score: checkin.score,
          risk_level: checkin.risk_level,
          reasoning: checkin.reasoning,
          signals_detected: checkin.signals,
          created_at: createdAt.toISOString(),
        })
        .select("id")
        .single();

      if (scoreError) {
        throw new Error(`Score insert failed: ${scoreError.message}`);
      }

      // Create alerts for high/critical
      if (checkin.risk_level === "high" || checkin.risk_level === "critical") {
        const counsellorId = userIds[caseSeed.counsellor_email];
        const { data: existingAlert } = await supabase
          .from("alerts")
          .select("id")
          .eq("distress_score_id", scoreRow.id)
          .single();

        if (!existingAlert) {
          await supabase.from("alerts").insert({
            case_id: caseId,
            distress_score_id: scoreRow.id,
            severity: checkin.risk_level,
            status: checkin.risk_level === "critical" ? "open" : "acknowledged",
            assigned_to: counsellorId,
            created_at: createdAt.toISOString(),
          });
          console.log(`  + Alert created for ${caseNumber} (${checkin.risk_level})`);
        }
      }

      console.log(`  + Check-in for ${caseNumber} (score: ${checkin.score})`);
    }
  }

  // Support recommendations for critical case
  const criticalCaseId = caseIds["SAM-2024-003"];
  const { data: existingRec } = await supabase
    .from("support_recommendations")
    .select("id")
    .eq("case_id", criticalCaseId)
    .limit(1);

  if (!existingRec?.length) {
    await supabase.from("support_recommendations").insert([
      {
        case_id: criticalCaseId,
        type: "counselling",
        description: "Schedule urgent in-person counselling session within 24 hours",
        status: "in_progress",
      },
      {
        case_id: criticalCaseId,
        type: "financial",
        description: "Expedite compensation disbursement — financial stress is primary trigger",
        status: "suggested",
      },
    ]);
    console.log("\n  + Support recommendations for SAM-2024-003");
  }

  // Intervention note
  const { data: existingNote } = await supabase
    .from("intervention_notes")
    .select("id")
    .eq("case_id", criticalCaseId)
    .limit(1);

  if (!existingNote?.length) {
    await supabase.from("intervention_notes").insert({
      case_id: criticalCaseId,
      counsellor_id: userIds["counsellor1@samvedna.demo"],
      note: "Attempted phone contact — victim answered briefly. Scheduled home visit for tomorrow morning. Coordinated with district official for compensation status update.",
    });
    console.log("  + Intervention note for SAM-2024-003");
  }

  // Timeline events
  for (const c of CASES) {
    const caseId = caseIds[c.case_number];
    const { data: existingEvent } = await supabase
      .from("case_timeline_events")
      .select("id")
      .eq("case_id", caseId)
      .eq("event_type", "case_opened")
      .limit(1);

    if (!existingEvent?.length) {
      await supabase.from("case_timeline_events").insert({
        case_id: caseId,
        event_type: "case_opened",
        description: `Case ${c.case_number} registered for ${c.case_type}`,
        created_by: officialId,
      });
    }
  }

  console.log("\n✅ Seed complete!\n");
  console.log("Demo credentials (password for all): " + DEMO_PASSWORD);
  console.log("─────────────────────────────────────");
  for (const u of USERS) {
    console.log(`  ${u.role.padEnd(12)} ${u.email}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("\n❌ Seed failed:", err.message);
  process.exit(1);
});
