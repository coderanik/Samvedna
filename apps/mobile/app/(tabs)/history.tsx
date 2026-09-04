import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { OnlineBadge, ScreenLoader } from "@/hooks/useVictimData";
import { COLORS } from "@/lib/config";
import type { CaseWithDetails } from "@samvedna/shared-types";

interface HistoryItem {
  id: string;
  created_at: string;
  channel: string;
  raw_transcript: string;
  score?: number;
  risk_level?: string;
}

export default function HistoryScreen() {
  const { session, isOnline } = useAuth();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError("");
    try {
      if (!isOnline) {
        setError("History needs internet. Showing nothing while offline.");
        setItems([]);
        return;
      }
      const cases = await apiFetch<CaseWithDetails[]>("/cases", {
        token: session.access_token,
      });
      const c = cases?.[0];
      if (!c) {
        setItems([]);
        return;
      }
      // Prefer case detail if API embeds checkins; else build from case list fields
      const detail = await apiFetch<CaseWithDetails & { checkins?: Array<{
        id: string;
        created_at: string;
        channel: string;
        raw_transcript: string;
        distress_scores?: Array<{ score: number; risk_level: string }>;
      }> }>(`/cases/${c.id}`, { token: session.access_token }).catch(() => null);

      const checkins = detail?.checkins ?? [];
      setItems(
        checkins.map((ch) => ({
          id: ch.id,
          created_at: ch.created_at,
          channel: ch.channel,
          raw_transcript: ch.raw_transcript,
          score: ch.distress_scores?.[0]?.score,
          risk_level: ch.distress_scores?.[0]?.risk_level,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token, isOnline]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading && items.length === 0) return <ScreenLoader />;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <OnlineBadge online={isOnline} />
      </View>
      {error ? <Text style={styles.err}>{error}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.empty}>No check-ins yet. Start from the Check-in tab.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.meta}>
              {new Date(item.created_at).toLocaleString()} · {item.channel}
              {item.risk_level ? ` · ${item.risk_level}` : ""}
              {item.score != null ? ` (${item.score})` : ""}
            </Text>
            <Text style={styles.body} numberOfLines={4}>
              {item.raw_transcript}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 22, fontWeight: "800", color: COLORS.primary },
  list: { padding: 16 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  meta: { fontSize: 12, color: COLORS.muted, marginBottom: 6 },
  body: { color: COLORS.primary, lineHeight: 20 },
  empty: { textAlign: "center", color: COLORS.muted, marginTop: 40 },
  err: { color: COLORS.danger, paddingHorizontal: 20, marginBottom: 8 },
});
