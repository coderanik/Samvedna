import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import { PrimaryButton } from "@/components/PrimaryButton";
import { COLORS, API_URL } from "@/lib/config";

type TokenInfo = {
  invite_email?: string | null;
  invite_full_name?: string | null;
  invite_language?: string | null;
  cases?: { case_number: string; case_type: string };
};

/**
 * Deep link target: samvedna://onboard/[token]
 * In-app claim (signup/sign-in + judiciary claim) — falls back to web if needed.
 */
export default function MobileOnboardDeepLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const web = (
    process.env.EXPO_PUBLIC_WEB_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/admin/onboarding/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("invalid"))))
      .then((data: TokenInfo) => {
        setInfo(data);
        setEmail(data.invite_email ?? "");
        setFullName(data.invite_full_name ?? "");
      })
      .catch(() => setError("This invite link is invalid or has expired."));
  }, [token]);

  async function claim() {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      let accessToken: string | null = null;
      const signedIn = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signedIn.data.session) {
        accessToken = signedIn.data.session.access_token;
      } else {
        const { data: signedUp, error: authError } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: {
              full_name: fullName,
              role: "victim",
              preferred_language: info?.invite_language ?? "en",
              onboarding_required: true,
            },
          },
        });
        if (authError) throw new Error(authError.message);
        accessToken = signedUp.session?.access_token ?? null;
        if (!accessToken) {
          const again = await supabase.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          });
          accessToken = again.data.session?.access_token ?? null;
        }
      }
      if (!accessToken) {
        throw new Error("Account ready — confirm email if required, then sign in.");
      }

      await apiFetch("/judiciary/claim", {
        method: "POST",
        token: accessToken,
        body: JSON.stringify({ token }),
      });
      setDone(true);
      setTimeout(() => router.replace("/(tabs)/home"), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not claim invite");
    } finally {
      setLoading(false);
    }
  }

  if (!token) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.wrap}>
          <Text style={styles.brand}>Samvedna</Text>
          <Text style={styles.title}>Secure invite</Text>
          <Text style={styles.muted}>
            Deep link <Text style={styles.mono}>samvedna://onboard/…</Text>
            {info?.cases
              ? ` · Case ${info.cases.case_number}`
              : " · Complete signup to link your case."}
          </Text>

          {done ? (
            <Text style={styles.ok}>Invite claimed. Opening Home…</Text>
          ) : (
            <>
              <Text style={styles.label}>Full name</Text>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
              />
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              {error ? <Text style={styles.err}>{error}</Text> : null}
              <PrimaryButton
                label={loading ? "Claiming…" : "Claim invite"}
                onPress={claim}
                disabled={loading || !email || !password}
              />
              <View style={{ height: 12 }} />
              <PrimaryButton
                label="Open in browser instead"
                variant="outline"
                onPress={() => Linking.openURL(`${web}/onboard/${token}`)}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  wrap: { padding: 24, paddingBottom: 40 },
  brand: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: { fontSize: 28, fontWeight: "800", color: COLORS.primary, marginTop: 8 },
  muted: { color: COLORS.muted, marginTop: 8, marginBottom: 20, lineHeight: 20 },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12 },
  label: { fontSize: 13, fontWeight: "600", color: COLORS.muted, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    fontSize: 16,
    color: COLORS.primary,
  },
  err: { color: COLORS.danger, marginBottom: 12 },
  ok: { color: COLORS.success, fontWeight: "600", marginTop: 20 },
});
