import React, { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { COLORS } from "@/lib/config";

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const root = String(segments[0] ?? "");
    const inAuth = ["login", "signup", "onboard", "auth"].includes(root);

    if (!session && !inAuth) {
      router.replace("/login");
      return;
    }

    if (session && (root === "login" || root === "signup")) {
      router.replace("/(tabs)/home");
      return;
    }

    if (session && profile && profile.role !== "victim" && !inAuth) {
      // Staff should use the web app
      router.replace("/staff-notice");
    }
  }, [session, profile, loading, segments, router]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: COLORS.bg,
        }}
      >
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <AuthProvider>
          <AuthGate>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
              <Stack.Screen name="login" />
              <Stack.Screen name="signup" />
              <Stack.Screen name="onboard/[token]" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="metal-ai"
                options={{ presentation: "fullScreenModal", headerShown: false }}
              />
              <Stack.Screen
                name="video-call"
                options={{ presentation: "fullScreenModal", headerShown: false }}
              />
              <Stack.Screen
                name="helplines"
                options={{ presentation: "modal", headerShown: false }}
              />
              <Stack.Screen name="staff-notice" />
            </Stack>
          </AuthGate>
        </AuthProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
