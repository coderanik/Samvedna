import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { COLORS } from "@/lib/config";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

/** Prevents white-screen crashes; shows a recovery UI instead. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || "Something went wrong",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Samvedna ErrorBoundary]", error, info.componentStack);
  }

  private reset = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.title}>
            {this.props.fallbackTitle ?? "Samvedna hit a snag"}
          </Text>
          <Text style={styles.body}>
            The app stayed open so you can keep going. Tap below to try again.
          </Text>
          <Text style={styles.detail} numberOfLines={3}>
            {this.state.message}
          </Text>
          <Pressable style={styles.btn} onPress={this.reset}>
            <Text style={styles.btnText}>Try again</Text>
          </Pressable>
          <Text style={styles.help}>
            Emergency: dial 112 · KIRAN: 1800-599-0019
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: COLORS.bg,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.primary,
    marginBottom: 8,
  },
  body: { fontSize: 15, color: COLORS.muted, marginBottom: 12, lineHeight: 22 },
  detail: { fontSize: 12, color: COLORS.muted, marginBottom: 20 },
  btn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  help: { marginTop: 24, textAlign: "center", color: COLORS.accent, fontSize: 13 },
});
