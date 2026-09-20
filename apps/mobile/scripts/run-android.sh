#!/usr/bin/env bash
# Start Android Studio emulator (if needed) then open Expo on it.
# Usage:
#   ./scripts/run-android.sh              # Expo Go / default
#   ./scripts/run-android.sh --dev-client # Development build (required for Android push)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/android-env.sh"

DEV_CLIENT=0
for arg in "$@"; do
  case "$arg" in
    --dev-client|-d) DEV_CLIENT=1 ;;
  esac
done

if [ ! -x "$ANDROID_HOME/platform-tools/adb" ]; then
  echo "Android SDK not found at $ANDROID_HOME"
  echo "Install Android Studio → SDK + create an emulator (AVD)."
  exit 1
fi

ensure_emulator() {
  if adb devices | grep -qE 'emulator-.*device$'; then
    echo "Emulator already running."
    return 0
  fi

  AVD="${ANDROID_AVD:-}"
  if [ -z "$AVD" ]; then
    AVD="$("$ANDROID_HOME/emulator/emulator" -list-avds | head -n 1 || true)"
  fi
  if [ -z "$AVD" ]; then
    echo "No Android Virtual Device found."
    echo "Open Android Studio → Device Manager → Create Device."
    exit 1
  fi

  echo "Starting emulator via Terminal.app: $AVD"
  cat > /tmp/start-samvedna-avd.command <<EOF
#!/bin/zsh
export ANDROID_HOME="\$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="\$ANDROID_HOME"
export PATH="\$ANDROID_HOME/emulator:\$ANDROID_HOME/platform-tools:\$PATH"
exec "\$ANDROID_HOME/emulator/emulator" -avd "$AVD" -netdelay none -netspeed full -gpu host
EOF
  chmod +x /tmp/start-samvedna-avd.command
  open -a Terminal /tmp/start-samvedna-avd.command

  echo "Waiting for Android emulator to boot…"
  adb wait-for-device
  for i in $(seq 1 90); do
    BOOT="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    if [ "$BOOT" = "1" ]; then
      echo "Emulator ready."
      return 0
    fi
    sleep 2
  done
  echo "Emulator did not finish booting in time."
  exit 1
}

ensure_emulator

# Host ↔ emulator networking for Metro + API
adb reverse tcp:8081 tcp:8081 || true
adb reverse tcp:4000 tcp:4000 || true
adb reverse tcp:8001 tcp:8001 || true

cd "$ROOT"

if [ "$DEV_CLIENT" -eq 1 ]; then
  # Prefer launching the installed development build (org.samvedna.victim)
  if ! adb shell pm list packages 2>/dev/null | grep -q 'org.samvedna.victim'; then
    echo "No Samvedna development build installed on this device/emulator."
    echo "Build one first:"
    echo "  pnpm android:build          # local Gradle (Android Studio)"
    echo "  pnpm eas:build:android      # EAS cloud APK"
    echo ""
    echo "Falling back to Metro with --dev-client (open the installed app manually)."
  fi
  echo "Launching Metro for development client…"
  exec npx expo start --dev-client --android --clear
fi

echo "Launching Expo (SDK 57) on Android…"
exec npx expo start --android --clear
