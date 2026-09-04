/** Offline / fallback comfort lines for Metal AI when the network is unavailable. */
export const METAL_AI_OFFLINE_SCRIPTS: Record<string, string[]> = {
  en: [
    "Hello. I am Metal AI, here with you. You are safe to speak at your own pace.",
    "I hear you. What you feel is valid. Take a slow breath with me.",
    "You do not have to face this alone. When you are ready, share a little more.",
    "Thank you for trusting me. You are showing courage by checking in.",
    "If things feel overwhelming, you can call KIRAN at 1800-599-0019 any time.",
  ],
  hi: [
    "नमस्ते। मैं मेटल एआई हूँ, आपके साथ हूँ। आप अपनी गति से बात कर सकते हैं।",
    "मैं सुन रहा हूँ। आपकी भावनाएँ सही हैं। मेरे साथ धीरे सांस लें।",
    "आप अकेले नहीं हैं। जब तैयार हों, थोड़ा और साझा करें।",
    "मुझ पर भरोसा करने के लिए धन्यवाद। जाँच करवाना साहस है।",
    "अगर बहुत भारी लगे, तो किरण हेल्पलाइन 1800-599-0019 पर कॉल करें।",
  ],
  ta: [
    "வணக்கம். நான் மெட்டல் ஏஐ. நீங்கள் பாதுகாப்பாகப் பேசலாம்.",
    "நான் கேட்கிறேன். உங்கள் உணர்வுகள் முக்கியம். மெதுவாக மூச்சு விடுங்கள்.",
    "நீங்கள் தனியாக இல்லை. தயாரானபோது மேலும் பகிருங்கள்.",
    "நம்பிக்கைக்கு நன்றி. சரிபார்ப்பு தைரியம்.",
    "அதிக அழுத்தம் இருந்தால் கிரன் 1800-599-0019 அழைக்கவும்.",
  ],
};

export function offlineMetalReply(locale: string, turnIndex: number): string {
  const list = METAL_AI_OFFLINE_SCRIPTS[locale] ?? METAL_AI_OFFLINE_SCRIPTS.en;
  return list[Math.min(turnIndex, list.length - 1)] ?? list[0];
}
