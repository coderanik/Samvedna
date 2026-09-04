import { redirect } from "next/navigation";

/** Alerts live in the combined control plane. */
export default function OfficialAlertsRedirect() {
  redirect("/admin#alerts");
}
