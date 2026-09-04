/** Keep only digits and cap at 10 (Indian mobile). */
export function sanitizePhoneDigits(value: string, max = 10): string {
  return value.replace(/\D/g, "").slice(0, max);
}
