import { Linking, Alert, Platform } from "react-native";

/** Open the native phone dialer with the number pre-filled. Never throws. */
export async function openPhoneDialer(rawNumber: string): Promise<boolean> {
  const digits = rawNumber.replace(/[^\d+]/g, "");
  if (!digits) {
    Alert.alert("Invalid number", "No phone number available.");
    return false;
  }

  const url = Platform.select({
    ios: `telprompt:${digits}`,
    android: `tel:${digits}`,
    default: `tel:${digits}`,
  })!;

  try {
    const can = await Linking.canOpenURL(url);
    if (!can) {
      // Still try — some devices return false incorrectly for tel:
      await Linking.openURL(`tel:${digits}`);
      return true;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    try {
      await Linking.openURL(`tel:${digits}`);
      return true;
    } catch {
      Alert.alert(
        "Cannot open Phone",
        "Please dial this number manually: " + digits
      );
      return false;
    }
  }
}
