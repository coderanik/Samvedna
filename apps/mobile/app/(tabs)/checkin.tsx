import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { OnlineBadge, PrimaryButton, useVictimData } from "@/hooks/useVictimData";
import { apiFetch } from "@/lib/api";
import { COLORS } from "@/lib/config";
import { offlineMetalReply } from "@/lib/metal-ai-scripts";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export default function CheckinScreen() {
  const { session, profile, isOnline } = useAuth();
  const { cases, saveCheckin } = useVictimData();
  const locale = profile?.preferred_language ?? "en";
  const [messages, setMessages] = useState<Msg[]>([
    {
      id: "g0",
      role: "assistant",
      content:
        locale === "hi"
          ? "नमस्ते। मैं मन-मित्र हूँ। आप कैसा महसूस कर रहे हैं?"
          : locale === "ta"
            ? "வணக்கம். நான் மன்-மித்ரா. நீங்கள் எப்படி உணர்கிறீர்கள்?"
            : "Hello. I'm Mann-Mitra. How have you been feeling lately?",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const turn = useRef(0);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const userMsg: Msg = { id: `u${Date.now()}`, role: "user", content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setBusy(true);

    try {
      let reply: string;
      if (!isOnline) {
        reply = offlineMetalReply(locale, turn.current++);
      } else {
        try {
          const data = await apiFetch<{ response: string }>("/chat", {
            method: "POST",
            token: session?.access_token,
            body: JSON.stringify({
              message: text,
              preferred_language: locale,
              conversation_history: history
                .filter((m) => m.id !== "g0")
                .map((m) => ({ role: m.role, content: m.content })),
            }),
          });
          reply = data.response;
        } catch {
          reply = offlineMetalReply(locale, turn.current++);
        }
      }
      setMessages((prev) => [
        ...prev,
        { id: `a${Date.now()}`, role: "assistant", content: reply },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    const userParts = messages.filter((m) => m.role === "user").map((m) => m.content);
    if (!userParts.length) {
      Alert.alert("Nothing to save", "Share a message first.");
      return;
    }
    if (!cases[0]) {
      Alert.alert("No case", "Ask your counsellor to link a case to your account.");
      return;
    }
    setBusy(true);
    try {
      const result = await saveCheckin(userParts.join("\n"));
      Alert.alert(
        result.offline ? "Saved offline" : "Check-in saved",
        result.offline
          ? "We'll sync when you're back online."
          : "Thank you for checking in."
      );
    } catch (err) {
      Alert.alert("Could not save", err instanceof Error ? err.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Check-in</Text>
        <OnlineBadge online={isOnline} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === "user" ? styles.user : styles.bot,
              ]}
            >
              <Text
                style={[
                  styles.bubbleText,
                  item.role === "user" && { color: "#fff" },
                ]}
              >
                {item.content}
              </Text>
            </View>
          )}
        />
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={isOnline ? "Type how you feel…" : "Offline — still saved on device"}
            placeholderTextColor={COLORS.muted}
            editable={!busy}
            multiline
          />
          <PrimaryButton label="Send" onPress={send} disabled={busy || !input.trim()} />
        </View>
        <View style={styles.footer}>
          <PrimaryButton
            label="Save check-in"
            variant="outline"
            onPress={finish}
            disabled={busy}
          />
        </View>
      </KeyboardAvoidingView>
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
  list: { padding: 16, paddingBottom: 8 },
  bubble: {
    maxWidth: "85%",
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
  },
  user: {
    alignSelf: "flex-end",
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
  },
  bot: {
    alignSelf: "flex-start",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { color: COLORS.primary, lineHeight: 20, fontSize: 15 },
  composer: { paddingHorizontal: 16, gap: 8 },
  input: {
    minHeight: 48,
    maxHeight: 120,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.primary,
  },
  footer: { padding: 16, paddingTop: 8 },
});
