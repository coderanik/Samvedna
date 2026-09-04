import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Pressable,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { signInWithGoogle } from "@/lib/google-auth";
import { COLORS } from "@/lib/config";
import { PrimaryButton } from "@/hooks/useVictimData";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function onLogin() {
    if (!email.trim() || !password) {
      Alert.alert("Missing details", "Enter email and password.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        const msg = error.message;
        if (/email not confirmed/i.test(msg)) {
          Alert.alert(
            "Email not confirmed",
            "Check your inbox for the confirmation link. You can also tap Resend below.",
            [
              { text: "OK" },
              {
                text: "Resend email",
                onPress: () => resendConfirmation(email.trim().toLowerCase()),
              },
            ]
          );
          return;
        }
        Alert.alert("Login failed", msg);
        return;
      }
      router.replace("/(tabs)/home");
    } catch (err) {
      Alert.alert(
        "Login failed",
        err instanceof Error ? err.message : "Unexpected error"
      );
    } finally {
      setLoading(false);
    }
  }

  async function resendConfirmation(targetEmail: string) {
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: targetEmail,
      });
      if (error) {
        Alert.alert("Could not resend", error.message);
        return;
      }
      Alert.alert("Sent", `Confirmation email sent to ${targetEmail}`);
    } catch (err) {
      Alert.alert(
        "Could not resend",
        err instanceof Error ? err.message : "Unexpected error"
      );
    }
  }

  async function onGoogle() {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      router.replace("/(tabs)/home");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Google sign-in failed";
      if (!/cancelled/i.test(msg)) {
        Alert.alert("Google sign-in failed", msg);
      }
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.wrap}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.brand}>Samvedna</Text>
            <Text style={styles.sub}>Victim care · listening beyond words</Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={COLORS.muted}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={COLORS.muted}
            />

            <PrimaryButton
              label={loading ? "Signing in…" : "Sign in"}
              onPress={onLogin}
              disabled={loading || googleLoading}
            />

            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.or}>or</Text>
              <View style={styles.divider} />
            </View>

            <Pressable
              style={[styles.googleBtn, (loading || googleLoading) && { opacity: 0.5 }]}
              disabled={loading || googleLoading}
              onPress={onGoogle}
            >
              <Text style={styles.googleText}>
                {googleLoading ? "Opening Google…" : "Continue with Google"}
              </Text>
            </Pressable>

            <Link href="/signup" style={styles.link}>
              New here? Create an account
            </Link>

            <Text style={styles.crisis}>
              Emergency 112 · KIRAN 1800-599-0019
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  flex: { flex: 1 },
  wrap: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  brand: {
    fontSize: 36,
    fontWeight: "800",
    color: COLORS.primary,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  sub: {
    color: COLORS.muted,
    marginBottom: 28,
    marginTop: 4,
    textAlign: "center",
  },
  label: { fontWeight: "600", color: COLORS.primary, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
    fontSize: 16,
    color: COLORS.primary,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 18,
    gap: 10,
  },
  divider: { flex: 1, height: 1, backgroundColor: COLORS.border },
  or: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
  googleBtn: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  googleText: {
    color: COLORS.primary,
    fontWeight: "700",
    fontSize: 16,
  },
  link: {
    marginTop: 20,
    textAlign: "center",
    color: COLORS.primarySoft,
    fontWeight: "600",
  },
  crisis: {
    marginTop: 28,
    textAlign: "center",
    color: COLORS.accent,
    fontSize: 12,
  },
});
