import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { OnlineBadge, PrimaryButton, ScreenLoader, useVictimData } from "@/hooks/useVictimData";
import { callModeForRisk, riskLabel } from "@/lib/call-mode";
import { COLORS } from "@/lib/config";
import { apiFetch } from "@/lib/api";

type NextSession = {
  id: string;
  case_id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  video_room_url: string | null;
  counsellor_name: string | null;
  joinable: boolean;
  starts_in_minutes: number;
};

export default function HomeScreen() {
  const { profile, session, isOnline, signOut } = useAuth();
  const { cases, routing, queueCount, loading, error, reload } = useVictimData();
  const router = useRouter();
  const caseRow = cases[0];
  const mode = callModeForRisk(routing?.risk_level);
  const [nextSession, setNextSession] = useState<NextSession | null>(null);

  const loadSession = useCallback(async () => {
    if (!session?.access_token || !isOnline) return;
    try {
      const data = await apiFetch<{ session: NextSession | null }>(
        "/victim/counselling/next",
        { token: session.access_token }
      );
      setNextSession(data.session);
    } catch {
      setNextSession(null);
    }
  }, [session?.access_token, isOnline]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function onRefresh() {
    await Promise.all([reload(), loadSession()]);
  }

  if (loading && !caseRow && !error) return <ScreenLoader />;

  const sessionWhen = nextSession
    ? new Date(nextSession.scheduled_at).toLocaleString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.wrap}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
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

        {nextSession && (
          <View style={[styles.card, styles.cardSession]}>
            <Text style={styles.cardTitle}>Next counselling</Text>
            <Text style={styles.caseNum}>{sessionWhen}</Text>
            <Text style={styles.muted}>
              {nextSession.duration_minutes} minutes
              {nextSession.counsellor_name
                ? ` · ${nextSession.counsellor_name}`
                : ""}
              {nextSession.starts_in_minutes > 0
                ? ` · in ~${nextSession.starts_in_minutes} min`
                : nextSession.joinable
                  ? " · join window open"
                  : ""}
            </Text>
            <View style={{ height: 12 }} />
            <PrimaryButton
              label={nextSession.joinable ? "Join session" : "Open call hub"}
              onPress={() => {
                if (nextSession.joinable && nextSession.video_room_url) {
                  void Linking.openURL(nextSession.video_room_url);
                } else {
                  router.push("/(tabs)/call");
                }
              }}
            />
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
              No case linked yet. Open an invite link (samvedna://onboard/…) or ask your
              counsellor.
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
  cardSession: { borderColor: "#93C5FD", backgroundColor: "#EFF6FF" },
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
