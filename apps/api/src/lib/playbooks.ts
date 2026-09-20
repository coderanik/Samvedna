/**
 * Case-type playbooks for PS priority use cases.
 */
export type PlaybookId =
  | "rape_gang_rape"
  | "murder_hurt_arson"
  | "witness_intimidation"
  | "caste_family_violence"
  | "general_atrocity";

export type Playbook = {
  id: PlaybookId;
  label: string;
  case_types: string[];
  default_interventions: string[];
  cadence_hours_high: number;
  auto_daily_counselling: boolean;
  alert_district_on: Array<"high" | "critical" | "escalation">;
};

export const PLAYBOOKS: Playbook[] = [
  {
    id: "rape_gang_rape",
    label: "Rape / gang rape survivor pathway",
    case_types: ["rape", "gang_rape", "sexual_violence"],
    default_interventions: ["counselling", "medical", "protection", "legal", "witness_protection"],
    cadence_hours_high: 24,
    auto_daily_counselling: true,
    alert_district_on: ["high", "critical", "escalation"],
  },
  {
    id: "murder_hurt_arson",
    label: "Murder / grievous hurt / arson pathway",
    case_types: ["murder", "grievous_hurt", "arson", "attempt_to_murder"],
    default_interventions: ["counselling", "financial", "rehabilitation", "legal", "medical"],
    cadence_hours_high: 48,
    auto_daily_counselling: true,
    alert_district_on: ["critical", "escalation"],
  },
  {
    id: "witness_intimidation",
    label: "Witness intimidation / threat pathway",
    case_types: ["witness_intimidation", "threat", "intimidation"],
    default_interventions: ["witness_protection", "protection", "relocation", "legal", "counselling"],
    cadence_hours_high: 24,
    auto_daily_counselling: true,
    alert_district_on: ["high", "critical", "escalation"],
  },
  {
    id: "caste_family_violence",
    label: "Caste-based / family violence pathway",
    case_types: ["caste_based_violence", "atrocity", "family_violence", "social_boycott"],
    default_interventions: ["counselling", "protection", "rehabilitation", "financial", "legal"],
    cadence_hours_high: 48,
    auto_daily_counselling: false,
    alert_district_on: ["critical", "escalation"],
  },
  {
    id: "general_atrocity",
    label: "General PoA support pathway",
    case_types: ["*"],
    default_interventions: ["counselling", "legal", "follow_up"],
    cadence_hours_high: 72,
    auto_daily_counselling: false,
    alert_district_on: ["critical", "escalation"],
  },
];

export function resolvePlaybook(caseType: string | null | undefined): Playbook {
  const t = (caseType ?? "").toLowerCase().trim();
  for (const p of PLAYBOOKS) {
    if (p.case_types.includes("*")) continue;
    if (p.case_types.some((ct) => t === ct || t.includes(ct))) return p;
  }
  return PLAYBOOKS.find((p) => p.id === "general_atrocity")!;
}
