import React from "react";
import { View, Text, StyleSheet, FlatList, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { HELPLINES, COLORS } from "@/lib/config";
import { openPhoneDialer } from "@/lib/phone";
import { PrimaryButton } from "@/hooks/useVictimData";

/**
 * High / critical path — opens the native Phone app with number pre-filled.
 */
export default function HelplinesScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Helpline numbers</Text>
        <Text style={styles.sub}>
          For high or critical distress. Tap any row — your Phone app opens with
          the number already pasted, ready to call.
        </Text>
      </View>

      <FlatList
        data={[...HELPLINES]}
        keyExtractor={(h) => h.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => openPhoneDialer(item.number)}
            accessibilityRole="button"
            accessibilityLabel={`Call ${item.name} ${item.display}`}
          >
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.number}>{item.display}</Text>
            <Text style={styles.meta}>
              {item.hours} · {item.description}
            </Text>
            <Text style={styles.cta}>Tap to open Phone app →</Text>
          </Pressable>
        )}
      />

      <View style={styles.footer}>
        <PrimaryButton label="Close" variant="outline" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.dangerSoft },
  header: { padding: 20, paddingBottom: 8 },
  title: { fontSize: 26, fontWeight: "800", color: COLORS.danger },
  sub: { color: COLORS.muted, marginTop: 8, lineHeight: 20 },
  list: { padding: 16 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  name: { fontWeight: "700", color: COLORS.primary, fontSize: 16 },
  number: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.danger,
    marginTop: 6,
    letterSpacing: 0.5,
  },
  meta: { color: COLORS.muted, marginTop: 6, lineHeight: 18 },
  cta: { marginTop: 10, color: COLORS.accent, fontWeight: "700" },
  footer: { padding: 16 },
});
