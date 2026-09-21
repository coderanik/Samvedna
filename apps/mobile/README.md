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

## Development build (required for Android push)

Expo Go **cannot** receive Android remote push on SDK 53+. Use a development build instead.

### 1. One-time EAS setup

```bash
cd apps/mobile
npx eas-cli login          # Expo account
npx eas-cli init           # links project → writes extra.eas.projectId into app.json
```

### 2. Firebase / FCM (Android push credentials)

1. Create a Firebase project → add Android app with package `org.samvedna.victim`.
2. Download `google-services.json` into `apps/mobile/` (gitignored).
3. In `app.json` under `expo.android`, add:

```json
"googleServicesFile": "./google-services.json"
```

4. Upload the FCM V1 service-account JSON to EAS:

```bash
npx eas-cli credentials -p android
# → production / development → Google Service Account → upload key
```

Docs: [FCM credentials](https://docs.expo.dev/push-notifications/fcm-credentials/).

### 3. Build & install

**Option A — local (fastest if Android Studio is already set up):**

```bash
cd apps/mobile
pnpm android:build
# first run generates android/ and installs org.samvedna.victim on the emulator/device
```

**Option B — EAS cloud APK:**

```bash
cd apps/mobile
pnpm eas:build:android
# download/install the APK when the build finishes (or use Expo Orbit)
```

Use `pnpm eas:build:android:device` for a physical-device APK profile.

### 4. Run Metro against the installed build

```bash
# from repo root
pnpm dev:mobile:android:dev

# or from apps/mobile
pnpm android:dev
```

Open the **Samvedna** app on the emulator (not Expo Go). After login you should see a push token register (no Expo Go skip message).

Test a notification: [Expo push tool](https://expo.dev/notifications) with the Expo push token from logs / DB.
## Screens

- Login / Signup / **Onboard deep link** (`samvedna://onboard/[token]`)
- Home · Check-in · Call hub · History
- Home shows **next counselling session** + Join when in window
- Push: care notices (high/critical) + session reminders (Expo Push). Android remote push needs a **development build** (see above) — not Expo Go.
- Metal AI call · Video call · Helplines

Staff roles are redirected to a notice — use the **web app** for counsellor / admin.

## Deep links

Scheme: `samvedna` (see `app.json`).

| Link | Opens |
|------|--------|
| `samvedna://onboard/<token>` | In-app invite claim |
| `samvedna://auth/callback` | OAuth return |

Invite emails include both the web URL and the app deep link.

## Google sign-in

Enable **Authentication → Providers → Google** in the Supabase dashboard (Client ID + Secret from Google Cloud).

Add these **Redirect URLs** under Authentication → URL Configuration:

- `samvedna://auth/callback`
- `http://localhost:3000/auth/callback` (web)
- Expo Go: `exp://127.0.0.1:8081/--/auth/callback` (or your Metro host URL)

Google Cloud OAuth client authorized redirect: `https://YOUR_PROJECT.supabase.co/auth/v1/callback`
