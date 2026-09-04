import Constants from "expo-constants";
import { Platform } from "react-native";

const extra = Constants.expoConfig?.extra ?? {};

function pick(key: string, fallback: string): string {
  const fromEnv = process.env[key];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const fromExtra = (extra as Record<string, string>)[key];
  if (fromExtra && fromExtra.length > 0) return fromExtra;
  return fallback;
}

/** Android emulator cannot use localhost for host machine services. */
function localizeHost(url: string): string {
  if (Platform.OS === "android" && url.includes("localhost")) {
    return url.replace("localhost", "10.0.2.2");
  }
  return url;
}

export const SUPABASE_URL = pick(
  "EXPO_PUBLIC_SUPABASE_URL",
  pick("NEXT_PUBLIC_SUPABASE_URL", "")
);

export const SUPABASE_ANON_KEY = pick(
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  pick("EXPO_PUBLIC_SUPABASE_ANON_KEY", "")
);

export const API_URL = localizeHost(
  pick("EXPO_PUBLIC_API_URL", "http://localhost:4000")
);

export const SOCKET_URL = localizeHost(
  pick("EXPO_PUBLIC_SOCKET_URL", API_URL)
);

export const HELPLINES = [
  {
    id: "kiran",
    name: "KIRAN Mental Health Helpline",
    number: "18005990019",
    display: "1800-599-0019",
    hours: "24×7",
    description: "Government of India mental health support",
  },
  {
    id: "emergency",
    name: "Emergency",
    number: "112",
    display: "112",
    hours: "24×7",
    description: "Police / medical / fire emergency",
  },
  {
    id: "women",
    name: "Women Helpline",
    number: "181",
    display: "181",
    hours: "24×7",
    description: "Women in distress helpline",
  },
  {
    id: "child",
    name: "Childline",
    number: "1098",
    display: "1098",
    hours: "24×7",
    description: "Child protection helpline",
  },
] as const;

export const COLORS = {
  bg: "#F7F4EF",
  surface: "#FFFFFF",
  primary: "#0F3D3E",
  primarySoft: "#1A5C5E",
  accent: "#C45C26",
  muted: "#6B7280",
  border: "#E5E0D8",
  danger: "#B42318",
  dangerSoft: "#FEF3F2",
  success: "#067647",
  warning: "#B54708",
  warningSoft: "#FFFAEB",
};
