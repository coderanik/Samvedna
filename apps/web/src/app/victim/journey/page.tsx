import { redirect } from "next/navigation";

/** MASTER_PROMPT D4: /victim/journey replaces history — keep the old path working. */
export default function VictimJourneyPage() {
  redirect("/victim/history");
}
