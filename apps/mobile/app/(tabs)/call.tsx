import React from "react";
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { OnlineBadge, PrimaryButton, ScreenLoader, useVictimData } from "@/hooks/useVictimData";
import { callModeForRisk, riskLabel } from "@/lib/call-mode";
import { openPhoneDialer } from "@/lib/phone";
import { COLORS } from "@/lib/config";

export default function CallHubScreen() {
  const router = useRouter();
  const { isOnline } = useAuth();
  const { routing, loading, reload } = useVictimData();
  const mode = callModeForRisk(routing?.risk_level);
  const counsellorPhone = routing?.counsellor?.phone_number;

  if (loading && !routing) return <ScreenLoader />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <View style={styles.top}>
          <Text style={styles.title}>Call support</Text>
          <OnlineBadge online={isOnline} />
        </View>

        <Text style={styles.lead}>
          Based on your latest distress level ({riskLabel(routing?.risk_level)}),
          Samvedna chooses the safest path.
        </Text>

        {mode === "helpline" ? (
          <View style={[styles.card, styles.alert]}>
            <Text style={styles.cardTitle}>High / critical — real helplines</Text>
            <Text style={styles.muted}>
              Tap a number and your Phone app opens with it already filled in.
              Speak to a trained helpline now.
            </Text>
            <View style={{ height: 12 }} />
            <PrimaryButton
              label="View helpline numbers"
              variant="danger"
              onPress={() => router.push("/helplines")}
            />
          </View>
        ) : (
          <View style={[styles.card, styles.calm]}>
            <Text style={styles.cardTitle}>Low / moderate — Metal AI</Text>
            <Text style={styles.muted}>
              Request a call. The app will connect you to Metal AI, who listens
              patiently and responds with comforting words.
              {isOnline
                ? " Works with your internet connection."
                : " Offline mode uses on-device comfort scripts."}
            </Text>
            <View style={{ height: 12 }} />
            <PrimaryButton
              label="Request Metal AI call"
              onPress={() => router.push("/metal-ai")}
            />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Counsellor</Text>
          {isOnline ? (
            <>
              <Text style={styles.muted}>
                Online: you may start an optional video call with your counsellor
                if you want to.
              </Text>
              <View style={{ height: 12 }} />
              <PrimaryButton
                label="Video call counsellor"
                variant="accent"
                onPress={() => {
                  if (!routing?.counsellor) {
                    Alert.alert(
                      "No counsellor assigned",
                      "Ask your official to assign a counsellor to your case."
                    );
                    return;
                  }
                  router.push("/video-call");
                }}
              />
            </>
          ) : (
            <>
              <Text style={styles.muted}>
                Offline: video is unavailable. You can place a normal phone call
                only.
              </Text>
              <View style={{ height: 12 }} />
              <PrimaryButton
                label={
                  counsellorPhone
                    ? `Phone call counsellor (${counsellorPhone})`
                    : "Phone call unavailable"
                }
                variant="outline"
                disabled={!counsellorPhone}
                onPress={() => {
                  if (counsellorPhone) openPhoneDialer(counsellorPhone);
                }}
              />
            </>
          )}
        </View>

        <PrimaryButton label="Refresh status" variant="outline" onPress={reload} />
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
    alignItems: "center",
    marginBottom: 8,
  },
  title: { fontSize: 26, fontWeight: "800", color: COLORS.primary },
  lead: { color: COLORS.muted, marginBottom: 16, lineHeight: 21 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  alert: { backgroundColor: COLORS.dangerSoft, borderColor: "#FECACA" },
  calm: { backgroundColor: "#ECFDF3", borderColor: "#A7F3D0" },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.primary,
    marginBottom: 6,
  },
  muted: { color: COLORS.muted, lineHeight: 20 },
});
