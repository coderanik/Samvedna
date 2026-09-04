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
} from "react-native";
import { Link, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { sanitizePhoneDigits } from "@/lib/phone-input";
import { COLORS } from "@/lib/config";
import { PrimaryButton } from "@/hooks/useVictimData";

export default function SignupScreen() {
  const router = useRouter();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    phone_number: "",
    preferred_language: "en",
  });
  const [loading, setLoading] = useState(false);

  async function onSignup() {
    if (!form.email.trim() || !form.password || !form.full_name.trim()) {
      Alert.alert("Missing details", "Name, email, and password are required.");
      return;
    }
    if (form.password.length < 8) {
      Alert.alert("Weak password", "Use at least 8 characters.");
      return;
    }
    if (form.phone_number && form.phone_number.length !== 10) {
      Alert.alert("Invalid phone", "Enter a 10-digit mobile number.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        options: {
          data: {
            full_name: form.full_name.trim(),
            role: "victim",
            preferred_language: form.preferred_language,
            phone_number: form.phone_number ? `+91${form.phone_number}` : null,
          },
        },
      });
      if (error) {
        Alert.alert("Signup failed", error.message);
        return;
      }
      Alert.alert(
        "Check your email",
        "We sent a confirmation link. Confirm your email, then sign in.",
        [{ text: "OK", onPress: () => router.replace("/login") }]
      );
    } catch (err) {
      Alert.alert(
        "Signup failed",
        err instanceof Error ? err.message : "Unexpected error"
      );
    } finally {
      setLoading(false);
    }
  }

  function updateField(key: keyof typeof form, value: string) {
    if (key === "phone_number") {
      setForm((f) => ({ ...f, phone_number: sanitizePhoneDigits(value) }));
      return;
    }
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.wrap}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.sub}>Victim registration for Samvedna</Text>

            <Text style={styles.label}>Full name</Text>
            <TextInput
              style={styles.input}
              value={form.full_name}
              onChangeText={(v) => updateField("full_name", v)}
              autoCapitalize="words"
              placeholderTextColor={COLORS.muted}
            />

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={form.email}
              onChangeText={(v) => updateField("email", v)}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholderTextColor={COLORS.muted}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={form.password}
              onChangeText={(v) => updateField("password", v)}
              secureTextEntry
              placeholderTextColor={COLORS.muted}
            />

            <Text style={styles.label}>Phone (10 digits)</Text>
            <TextInput
              style={styles.input}
              value={form.phone_number}
              onChangeText={(v) => updateField("phone_number", v)}
              keyboardType="number-pad"
              maxLength={10}
              placeholder="9876543210"
              placeholderTextColor={COLORS.muted}
            />
            <Text style={styles.hint}>
              {form.phone_number.length}/10 digits · letters and symbols blocked
            </Text>

            <Text style={styles.label}>Language</Text>
            <View style={styles.langRow}>
              {(
                [
                  ["en", "English"],
                  ["hi", "हिंदी"],
                  ["ta", "தமிழ்"],
                ] as const
              ).map(([code, label]) => (
                <PrimaryButton
                  key={code}
                  label={label}
                  variant={form.preferred_language === code ? "primary" : "outline"}
                  onPress={() =>
                    setForm((f) => ({ ...f, preferred_language: code }))
                  }
                />
              ))}
            </View>

            <View style={{ height: 12 }} />
            <PrimaryButton
              label={loading ? "Creating…" : "Create account"}
              onPress={onSignup}
              disabled={loading}
            />
            <Link href="/login" style={styles.link}>
              Already have an account? Sign in
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  wrap: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.primary,
    textAlign: "center",
  },
  sub: {
    color: COLORS.muted,
    marginBottom: 24,
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
    marginBottom: 14,
    fontSize: 16,
    color: COLORS.primary,
  },
  hint: {
    marginTop: -8,
    marginBottom: 14,
    fontSize: 12,
    color: COLORS.muted,
  },
  langRow: { gap: 8, marginBottom: 8 },
  link: {
    marginTop: 20,
    textAlign: "center",
    color: COLORS.primarySoft,
    fontWeight: "600",
  },
});
