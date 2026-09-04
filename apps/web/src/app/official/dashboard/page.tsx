import { redirect } from "next/navigation";

/** Official surfaces are merged into the combined control plane at /admin. */
export default function OfficialDashboardRedirect() {
  redirect("/admin#overview");
}
