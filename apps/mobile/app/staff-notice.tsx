import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { PrimaryButton } from "@/hooks/useVictimData";
import { COLORS } from "@/lib/config";

export default function StaffNoticeScreen() {
  const { profile, signOut } = useAuth();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.wrap}>
        <Text style={styles.title}>Staff account</Text>
        <Text style={styles.body}>
          This mobile app is for victims only. Your role is{" "}
          <Text style={{ fontWeight: "700" }}>{profile?.role ?? "staff"}</Text>.
          Please use the Samvedna web app for counsellor, official, or admin work.
        </Text>
        <PrimaryButton label="Sign out" onPress={() => signOut()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  wrap: { flex: 1, justifyContent: "center", padding: 24 },
  title: { fontSize: 24, fontWeight: "800", color: COLORS.primary, marginBottom: 12 },
  body: { color: COLORS.muted, lineHeight: 22, marginBottom: 24 },
});
