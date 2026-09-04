import React from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { OnlineBadge, PrimaryButton, ScreenLoader, useVictimData } from "@/hooks/useVictimData";
import { callModeForRisk, riskLabel } from "@/lib/call-mode";
import { COLORS } from "@/lib/config";

export default function HomeScreen() {
  const { profile, isOnline, signOut } = useAuth();
  const { cases, routing, queueCount, loading, error, reload } = useVictimData();
  const router = useRouter();
  const caseRow = cases[0];
  const mode = callModeForRisk(routing?.risk_level);

  if (loading && !caseRow && !error) return <ScreenLoader />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.wrap}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
      >
        <View style={styles.top}>
          <View>
            <Text style={styles.hello}>Hello,</Text>
            <Text style={styles.name}>{profile?.full_name ?? "there"}</Text>
          </View>
          <OnlineBadge online={isOnline} />
        </View>

        {queueCount > 0 && (
          <View style={styles.queueBox}>
            <Text style={styles.queueText}>
              {queueCount} check-in{queueCount > 1 ? "s" : ""} saved offline — will sync when online.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your case</Text>
          {caseRow ? (
            <>
              <Text style={styles.caseNum}>{caseRow.case_number}</Text>
              <Text style={styles.muted}>
                {caseRow.case_type} · {caseRow.district}
              </Text>
            </>
          ) : (
            <Text style={styles.muted}>
              No case linked yet. Ask your counsellor or official to assign one.
            </Text>
          )}
          {error ? <Text style={styles.err}>{error}</Text> : null}
        </View>

        <View style={[styles.card, mode === "helpline" ? styles.cardAlert : styles.cardCalm]}>
          <Text style={styles.cardTitle}>Care path</Text>
          <Text style={styles.risk}>
            Distress: {riskLabel(routing?.risk_level)}
            {routing?.distress_score != null ? ` (${routing.distress_score})` : ""}
          </Text>
          <Text style={styles.muted}>
            {mode === "helpline"
              ? "High or critical distress — open real helpline numbers in your Phone app."
              : "Low or moderate distress — request a Metal AI wellness call."}
          </Text>
        </View>

        <PrimaryButton
          label={mode === "helpline" ? "Open helplines" : "Request Metal AI call"}
          variant={mode === "helpline" ? "danger" : "primary"}
          onPress={() =>
            router.push(mode === "helpline" ? "/helplines" : "/metal-ai")
          }
        />
        <View style={{ height: 10 }} />
        <PrimaryButton
          label="Go to check-in chat"
          variant="outline"
          onPress={() => router.push("/(tabs)/checkin")}
        />
        <View style={{ height: 10 }} />
        <PrimaryButton label="Sign out" variant="outline" onPress={() => signOut()} />

        <Text style={styles.foot}>
          Samvedna is a support tool, not an emergency service. Dial 112 in danger.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  wrap: { padding: 20, paddingBottom: 40 },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
  },
  hello: { color: COLORS.muted, fontSize: 14 },
  name: { fontSize: 26, fontWeight: "800", color: COLORS.primary },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardAlert: { borderColor: "#FECACA", backgroundColor: COLORS.dangerSoft },
  cardCalm: { borderColor: "#A7F3D0", backgroundColor: "#ECFDF3" },
  cardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  caseNum: { fontSize: 20, fontWeight: "700", color: COLORS.primary },
  risk: { fontSize: 18, fontWeight: "700", color: COLORS.primary, marginBottom: 4 },
  muted: { color: COLORS.muted, lineHeight: 20 },
  err: { color: COLORS.danger, marginTop: 8 },
  queueBox: {
    backgroundColor: COLORS.warningSoft,
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  queueText: { color: COLORS.warning, fontWeight: "600" },
  foot: {
    marginTop: 28,
    textAlign: "center",
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
  },
});
