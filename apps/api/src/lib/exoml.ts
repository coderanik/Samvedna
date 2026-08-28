function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function exomlResponse(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

export function say(text: string, lang = "en-IN"): string {
  return `<Say voice="woman" language="${xmlEscape(lang)}">${xmlEscape(text)}</Say>`;
}

export function dialNumber(number: string, record = true): string {
  const e164 = number.startsWith("+") ? number : `+91${number.replace(/\D/g, "").slice(-10)}`;
  const attrs = record ? ' record="true" recordingChannels="dual"' : "";
  return `<Dial${attrs}><Number>${xmlEscape(e164)}</Number></Dial>`;
}

export function recordCheckin(actionUrl: string, maxLength = 120): string {
  return `<Record action="${xmlEscape(actionUrl)}" maxLength="${maxLength}" finishOnKey="#" playBeep="true" />`;
}

export function hangup(): string {
  return "<Hangup/>";
}

/** Greeting + bridge to counsellor for high/critical IVRS callers. */
export function counsellorBridgeExoml(counsellorPhone: string, counsellorName: string): string {
  return exomlResponse(
    say(`Connecting you to your counsellor, ${counsellorName}. Please hold.`) +
      dialNumber(counsellorPhone, true)
  );
}

/** Greeting + voice note for low/moderate IVRS callers. */
export function recordCheckinExoml(recordingCallbackUrl: string, lang: "en" | "hi" | "ta" = "en"): string {
  const prompts: Record<string, string> = {
    en: "Welcome to Samvedna Mann-Mitra. After the beep, please share how you have been feeling. Press hash when done.",
    hi: "सम्वेदना मन-मित्र में आपका स्वागत है। बीप के बाद बताएं कि आप कैसा महसूस कर रहे हैं। समाप्त करने के लिए हैश दबाएं।",
    ta: "சம்வேதனா மன்-மித்ராவுக்கு வரவேற்கிறோம். பீப் sound-க்குப் பிறகு நீங்கள் எப்படி உணர்கிறீர்கள் என்று பகிருங்கள்.",
  };
  const language = lang === "hi" ? "hi-IN" : lang === "ta" ? "ta-IN" : "en-IN";
  return exomlResponse(say(prompts[lang] ?? prompts.en, language) + recordCheckin(recordingCallbackUrl));
}

export function unknownCallerExoml(): string {
  return exomlResponse(
    say(
      "We could not find your number in Samvedna. Please contact your counsellor or use the mobile app to register."
    ) + hangup()
  );
}
