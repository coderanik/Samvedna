import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { apiFetch } from "./api";

/** Expo Go (SDK 53+) cannot register Android remote push tokens. */
function isExpoGo(): boolean {
  return Constants.appOwnership === "expo";
}

function remotePushSupported(): boolean {
  if (isExpoGo() && Platform.OS === "android") return false;
  return true;
}

if (remotePushSupported()) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/** Request permission + register Expo push token with API. */
export async function registerForPushNotificationsAsync(
  accessToken: string
): Promise<string | null> {
  if (!remotePushSupported()) {
    console.info(
      "[push] Android remote push is not available in Expo Go (SDK 53+). Use a development build to test notifications."
    );
    return null;
  }

  if (!Device.isDevice) {
    console.info(
      "[push] Simulator — Expo push requires a physical device or a development build."
    );
    return null;
  }

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let final = existing;
    if (existing !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      final = asked.status;
    }
    if (final !== "granted") return null;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("care", {
        name: "Care & sessions",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    const tokenRes = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenRes.data;

    await apiFetch("/victim/push-token", {
      method: "POST",
      token: accessToken,
      body: JSON.stringify({
        token,
        platform: Platform.OS,
        app_version: Constants.expoConfig?.version ?? "1.0.0",
      }),
    }).catch((err) => console.warn("[push] register", err));

    return token;
  } catch (err) {
    console.warn("[push] registration skipped", err);
    return null;
  }
}
