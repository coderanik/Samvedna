import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { COLORS } from "@/lib/config";

export function PrimaryButton({
  label,
  onPress,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "accent" | "danger" | "outline";
}) {
  const bg =
    variant === "accent"
      ? COLORS.accent
      : variant === "danger"
        ? COLORS.danger
        : variant === "outline"
          ? "transparent"
          : COLORS.primary;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        try {
          onPress();
        } catch (err) {
          console.warn("[button]", err);
        }
      }}
      style={[
        styles.base,
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1 },
        variant === "outline" && styles.outline,
      ]}
    >
      <Text
        style={[styles.text, variant === "outline" && { color: COLORS.primary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: "center",
  },
  outline: {
    borderWidth: 1.5,
    borderColor: COLORS.primary,
  },
  text: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
