# Samvedna Victim Mobile (React Native / Expo)

Victim-facing mobile app with **online + offline** care paths.

## Features

| Situation | What happens |
|-----------|----------------|
| **High / critical** distress | Helpline numbers (KIRAN, 112, 181, 1098) — tap opens the **Phone app** with the number pre-filled |
| **Low / moderate** distress | **Metal AI** wellness call — dial animation, then patient listening + comforting replies (online via Gemini; offline via on-device scripts) |
| **Online** | Optional **video call** with counsellor (camera preview + session notify) |
| **Offline** | Video disabled; **normal phone call** to counsellor (`tel:`) only; check-ins queue on device and sync later |

Crash safety: root `ErrorBoundary`, safe dialer helpers, timeouts on API calls, speech/camera failures never take down the app.

## Run on Android Studio emulator

Your Expo Go is **SDK 57** — this app is now on **Expo SDK 57** as well.

```bash
# 1) Emulator must be running (Android Studio → Device Manager → ▶ Medium_Phone)
# 2) From repo root:
pnpm dev:mobile:android
```

Or manually in Terminal:

```bash
cd apps/mobile
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH
adb reverse tcp:8081 tcp:8081
adb reverse tcp:4000 tcp:4000
npx expo start --android --clear
```

If you see a red Metro error, press **`r`** in the Expo terminal (or shake device → Reload) after Metro finishes starting.


### Device networking

| Device | API URL |
|--------|---------|
| iOS simulator | `http://localhost:4000` |
| Android emulator | `http://10.0.2.2:4000` (auto-rewritten from localhost) |
| Physical phone | `http://YOUR_LAN_IP:4000` in `EXPO_PUBLIC_API_URL` |

## Screens

- Login / Signup  
- Home · Check-in · Call hub · History  
- Metal AI call · Video call · Helplines  

Staff roles are redirected to a notice — use the **web app** for counsellor / official / admin.

## Google sign-in

Enable **Authentication → Providers → Google** in the Supabase dashboard (Client ID + Secret from Google Cloud).

Add these **Redirect URLs** under Authentication → URL Configuration:

- `samvedna://auth/callback`
- `http://localhost:3000/auth/callback` (web)
- Expo Go: `exp://127.0.0.1:8081/--/auth/callback` (or your Metro host URL)

Google Cloud OAuth client authorized redirect: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
