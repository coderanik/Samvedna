/** Normalize to last 10 digits (India mobile). */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/** E.164 for Exotel (+91XXXXXXXXXX). */
export function toE164Indian(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith("091")) return `+91${digits.slice(3)}`;
  if (phone.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

/** Exotel legacy format with leading 0 for 10-digit mobile. */
export function toExotelFrom(phone: string): string | null {
  const e164 = toE164Indian(phone);
  if (!e164) return null;
  return `0${e164.slice(3)}`;
}
