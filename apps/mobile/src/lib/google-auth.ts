import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";
import * as QueryParams from "expo-auth-session/build/QueryParams";
import { supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

export function getAuthRedirectUri() {
  return makeRedirectUri({
    scheme: "samvedna",
    path: "auth/callback",
  });
}

async function createSessionFromUrl(url: string) {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  if (errorCode) throw new Error(errorCode);

  const access_token = params.access_token;
  const refresh_token = params.refresh_token;
  if (!access_token || !refresh_token) {
    throw new Error("No session tokens returned from Google sign-in");
  }

  const { error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (error) throw error;
}

/** Opens Google OAuth in system browser and stores the Supabase session. */
export async function signInWithGoogle(): Promise<void> {
  const redirectTo = getAuthRedirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error) throw error;
  if (!data?.url) throw new Error("Could not start Google sign-in");

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== "success") {
    throw new Error(
      result.type === "cancel" || result.type === "dismiss"
        ? "Google sign-in was cancelled"
        : "Google sign-in failed"
    );
  }

  await createSessionFromUrl(result.url);
}
