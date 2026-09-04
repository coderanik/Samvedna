import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Alert,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { openPhoneDialer } from "@/lib/phone";
import { PrimaryButton } from "@/hooks/useVictimData";
import { COLORS } from "@/lib/config";
import type { CallRouting, CallSession } from "@samvedna/shared-types";

/**
 * Online-only optional video call with counsellor.
 * Shows local camera preview + session signaling via API/Socket.
 * Falls back to phone dialer if video path fails — never crashes.
 */
export default function VideoCallScreen() {
  const router = useRouter();
  const { session, isOnline } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [routing, setRouting] = useState<CallRouting | null>(null);
  const [callSession, setCallSession] = useState<CallSession | null>(null);
  const [status, setStatus] = useState("Preparing secure video…");
  const [cameraOn, setCameraOn] = useState(true);

  useEffect(() => {
    if (!isOnline) {
      Alert.alert(
        "Offline",
        "Video calls need internet. Use a normal phone call instead.",
        [
          {
            text: "OK",
            onPress: () => router.back(),
          },
        ]
      );
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        if (!permission?.granted) {
          const res = await requestPermission();
          if (!res.granted) {
            setStatus("Camera permission denied — you can still use phone call.");
            setCameraOn(false);
          }
        }

        const token = session?.access_token;
        if (!token) throw new Error("Not signed in");

        const r = await apiFetch<CallRouting>("/calls/routing", { token });
        if (cancelled) return;
        setRouting(r);

        const s = await apiFetch<CallSession>("/calls/start", {
          method: "POST",
          token,
        });
        if (cancelled) return;
        setCallSession(s);
        setStatus(
          r.counsellor
            ? `Waiting for ${r.counsellor.full_name}…`
            : "Waiting for counsellor…"
        );
      } catch (err) {
        if (cancelled) return;
        setStatus(
          err instanceof Error
            ? err.message
            : "Could not start video session"
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOnline, permission?.granted, requestPermission, router, session?.access_token]);

  async function endAndClose() {
    try {
      if (callSession && session?.access_token) {
        await apiFetch(`/calls/${callSession.id}/status`, {
          method: "PATCH",
          token: session.access_token,
          body: JSON.stringify({ status: "cancelled" }),
        }).catch(() => undefined);
      }
    } finally {
      router.back();
    }
  }

  function fallBackToPhone() {
    const phone = routing?.counsellor?.phone_number;
    if (!phone) {
      Alert.alert("No number", "Counsellor phone is not on file.");
      return;
    }
    openPhoneDialer(phone);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.stage}>
        {cameraOn && permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="front" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
            <Text style={styles.placeholderText}>Camera off</Text>
          </View>
        )}

        <View style={styles.remoteCard}>
          <Text style={styles.remoteName}>
            {routing?.counsellor?.full_name ?? "Counsellor"}
          </Text>
          <Text style={styles.remoteStatus}>{status}</Text>
          <Text style={styles.hint}>
            Video is available only while online. Counsellor is notified of your request.
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable
          style={styles.ctrl}
          onPress={() => setCameraOn((v) => !v)}
        >
          <Text style={styles.ctrlText}>{cameraOn ? "Cam off" : "Cam on"}</Text>
        </Pressable>
        <Pressable style={[styles.ctrl, styles.end]} onPress={endAndClose}>
          <Text style={styles.ctrlText}>End</Text>
        </Pressable>
      </View>

      <View style={styles.fallback}>
        <PrimaryButton
          label="Switch to phone call"
          variant="outline"
          onPress={fallBackToPhone}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#111" },
  stage: { flex: 1, overflow: "hidden" },
  placeholder: {
    backgroundColor: "#1f1f1f",
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: { color: "#aaa", fontSize: 16 },
  remoteCard: {
    position: "absolute",
    top: 24,
    left: 16,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 14,
    padding: 14,
  },
  remoteName: { color: "#fff", fontWeight: "800", fontSize: 18 },
  remoteStatus: { color: "#A7F3D0", marginTop: 4 },
  hint: { color: "#ccc", marginTop: 8, fontSize: 12, lineHeight: 18 },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 16,
  },
  ctrl: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 999,
  },
  end: { backgroundColor: COLORS.danger },
  ctrlText: { color: "#fff", fontWeight: "700" },
  fallback: { paddingHorizontal: 20, paddingBottom: 20 },
});
