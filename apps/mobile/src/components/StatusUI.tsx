import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { COLORS } from "@/lib/config";

export function OnlineBadge({ online }: { online: boolean }) {
  return (
    <View style={[badge.wrap, online ? badge.on : badge.off]}>
      <View style={[badge.dot, online ? badge.dotOn : badge.dotOff]} />
      <Text style={badge.text}>{online ? "Online" : "Offline"}</Text>
    </View>
  );
}

export function ScreenLoader() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={COLORS.primary} size="large" />
    </View>
  );
}

const badge = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  on: { backgroundColor: "#ECFDF3" },
  off: { backgroundColor: COLORS.warningSoft },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: COLORS.success },
  dotOff: { backgroundColor: COLORS.warning },
  text: { fontSize: 12, fontWeight: "600", color: COLORS.primary },
});
