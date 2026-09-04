import { Redirect } from "expo-router";

/** Deep-link landing for OAuth; session is usually set in google-auth before navigation. */
export default function AuthCallback() {
  return <Redirect href="/(tabs)/home" />;
}
