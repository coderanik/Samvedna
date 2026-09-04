#!/usr/bin/env bash
# Root helper: open a macOS Terminal that runs Expo against the Android emulator.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

cat > /tmp/start-samvedna-expo.command <<EOF
#!/bin/zsh
set -e
cd "$REPO/apps/mobile"
export ANDROID_HOME="\$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="\$ANDROID_HOME"
export PATH="\$ANDROID_HOME/emulator:\$ANDROID_HOME/platform-tools:\$PATH"

echo "== Samvedna Victim App (Expo SDK 57) =="
echo "Project: $REPO/apps/mobile"
adb start-server >/dev/null
if ! adb devices | grep -qE 'emulator-.*device\$'; then
  echo "No emulator running. Starting Medium_Phone_API_36.0…"
  open -a Terminal /tmp/start-samvedna-avd.command 2>/dev/null || true
  "$REPO/apps/mobile/scripts/run-android.sh" &
  exit 0
fi

adb reverse tcp:8081 tcp:8081 || true
adb reverse tcp:4000 tcp:4000 || true
adb reverse tcp:8001 tcp:8001 || true

echo "Metro starting — press a if the app does not open automatically."
exec npx expo start --android --clear
EOF
chmod +x /tmp/start-samvedna-expo.command

# Ensure AVD launcher exists
cat > /tmp/start-samvedna-avd.command <<'EOF'
#!/bin/zsh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
exec "$ANDROID_HOME/emulator/emulator" -avd Medium_Phone_API_36.0 -gpu host
EOF
chmod +x /tmp/start-samvedna-avd.command

open -a Terminal /tmp/start-samvedna-expo.command
echo "Opened Terminal → Expo SDK 57 for Android emulator"
