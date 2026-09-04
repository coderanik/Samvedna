import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Speech from "expo-speech";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { PrimaryButton } from "@/hooks/useVictimData";
import { offlineMetalReply } from "@/lib/metal-ai-scripts";
import { COLORS } from "@/lib/config";

type Phase = "request" | "dialing" | "connected" | "ended";

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export default function MetalAiScreen() {
  const router = useRouter();
  const { session, profile, isOnline } = useAuth();
  const locale = profile?.preferred_language ?? "en";
  const [phase, setPhase] = useState<Phase>("request");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const turnIdx = useRef(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (phase !== "dialing" && phase !== "connected") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  const speak = useCallback(
    (text: string) => {
      try {
        Speech.stop();
        Speech.speak(text, {
          language: locale === "hi" ? "hi-IN" : locale === "ta" ? "ta-IN" : "en-IN",
          rate: 0.92,
        });
      } catch (err) {
        console.warn("[speech]", err);
      }
    },
    [locale]
  );

  async function requestCall() {
    setPhase("dialing");
    startedAt.current = Date.now();

    // Create backend session when online; never block dialing UX
    if (isOnline && session?.access_token) {
      try {
        const s = await apiFetch<{ id: string }>("/calls/start", {
          method: "POST",
          token: session.access_token,
        });
        setSessionId(s.id);
      } catch (err) {
        console.warn("[metal start]", err);
      }
    }

    // Simulated dial → connect
    await new Promise((r) => setTimeout(r, 2200));
    const greeting =
      locale === "hi"
        ? "नमस्ते। मैं मेटल एआई हूँ। मैं धैर्य से सुनूँगा। आप कैसे हैं?"
        : locale === "ta"
          ? "வணக்கம். நான் மெட்டல் ஏஐ. நான் பொறுமையாகக் கேட்பேன். நீங்கள் எப்படி இருக்கிறீர்கள்?"
          : "Hello. I am Metal AI. I will listen patiently. How are you feeling right now?";

    setTurns([{ id: "a0", role: "assistant", content: greeting }]);
    setPhase("connected");
    speak(greeting);
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || busy || phase !== "connected") return;
    setInput("");
    const userTurn: Turn = { id: `u${Date.now()}`, role: "user", content: text };
    const next = [...turns, userTurn];
    setTurns(next);
    setBusy(true);

    try {
      let reply: string;
      if (isOnline && session?.access_token) {
        try {
          const data = await apiFetch<{ response: string }>("/chat", {
            method: "POST",
            token: session.access_token,
            body: JSON.stringify({
              message: text,
              preferred_language: locale,
              conversation_history: next.map((t) => ({
                role: t.role,
                content: t.content,
              })),
            }),
          });
          reply = data.response;
        } catch {
          reply = offlineMetalReply(locale, turnIdx.current++);
        }
      } else {
        reply = offlineMetalReply(locale, turnIdx.current++);
      }
      setTurns((prev) => [
        ...prev,
        { id: `a${Date.now()}`, role: "assistant", content: reply },
      ]);
      speak(reply);
    } finally {
      setBusy(false);
    }
  }

  async function endCall() {
    try {
      Speech.stop();
    } catch {
      /* ignore */
    }
    const transcript = turns
      .filter((t) => t.role === "user")
      .map((t) => t.content)
      .join("\n");
    const duration = Math.round((Date.now() - startedAt.current) / 1000);

    if (sessionId && session?.access_token && isOnline) {
      try {
        await apiFetch(`/calls/${sessionId}/complete`, {
          method: "POST",
          token: session.access_token,
          body: JSON.stringify({
            transcript:
              transcript || "Metal AI wellness call — victim listened and spoke briefly.",
            duration_seconds: duration,
          }),
        });
      } catch (err) {
        console.warn("[metal complete]", err);
      }
    }

    setPhase("ended");
    Alert.alert(
      "Call ended",
      isOnline
        ? "Your Metal AI session was saved when possible."
        : "Offline session ended. Connect later to sync if needed."
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {phase === "request" && (
        <View style={styles.center}>
          <Text style={styles.brand}>Metal AI</Text>
          <Text style={styles.sub}>
            A calm AI wellness call. Metal AI listens first, then responds with
            careful, comforting words.
          </Text>
          <Text style={styles.meta}>
            {isOnline ? "Online · Gemini-backed replies" : "Offline · on-device comfort scripts"}
          </Text>
          <PrimaryButton label="Request call" onPress={requestCall} />
          <View style={{ height: 12 }} />
          <PrimaryButton label="Cancel" variant="outline" onPress={() => router.back()} />
        </View>
      )}

      {phase === "dialing" && (
        <View style={styles.center}>
          <Animated.View style={[styles.avatar, { transform: [{ scale: pulse }] }]}>
            <Text style={styles.avatarText}>AI</Text>
          </Animated.View>
          <Text style={styles.brand}>Dialing Metal AI…</Text>
          <Text style={styles.sub}>Connecting your wellness line</Text>
        </View>
      )}

      {phase === "connected" && (
        <View style={{ flex: 1 }}>
          <View style={styles.topBar}>
            <Text style={styles.live}>Metal AI · live</Text>
            <Pressable onPress={endCall}>
              <Text style={styles.end}>End</Text>
            </Pressable>
          </View>
          <FlatList
            data={turns}
            keyExtractor={(t) => t.id}
            contentContainerStyle={{ padding: 16 }}
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
              placeholder="Speak by typing — Metal AI is listening…"
              placeholderTextColor={COLORS.muted}
              editable={!busy}
            />
            <PrimaryButton label="Send" onPress={sendMessage} disabled={busy || !input.trim()} />
          </View>
        </View>
      )}

      {phase === "ended" && (
        <View style={styles.center}>
          <Text style={styles.brand}>Thank you</Text>
          <Text style={styles.sub}>Take care. You can call again anytime.</Text>
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B2A2B" },
  center: {
    flex: 1,
    justifyContent: "center",
    padding: 28,
  },
  brand: {
    fontSize: 28,
    fontWeight: "800",
    color: "#F7F4EF",
    marginBottom: 10,
    textAlign: "center",
  },
  sub: {
    color: "#C5D4D4",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  meta: { color: "#8FB3B4", textAlign: "center", marginBottom: 24, fontSize: 13 },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.primarySoft,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  avatarText: { color: "#fff", fontWeight: "800", fontSize: 28 },
  topBar: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  live: { color: "#A7F3D0", fontWeight: "700" },
  end: { color: "#FCA5A5", fontWeight: "700", fontSize: 16 },
  bubble: {
    maxWidth: "85%",
    padding: 12,
    borderRadius: 16,
    marginBottom: 10,
  },
  user: {
    alignSelf: "flex-end",
    backgroundColor: COLORS.accent,
  },
  bot: {
    alignSelf: "flex-start",
    backgroundColor: "#143D3E",
  },
  bubbleText: { color: "#F7F4EF", lineHeight: 20 },
  composer: { padding: 16, gap: 8 },
  input: {
    backgroundColor: "#143D3E",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 16,
  },
});
