#!/usr/bin/env bash
# Testfeld·07 — lokaler APK-Bau (identisch zu CI: Gradle 8.10.2, SDK 35).
# Voraussetzung: build-env unter ../build-env (Gradle + android-sdk),
# sonst BUILD_ENV überschreiben. Ausgabe: app/build/outputs/apk/release/app-release.apk
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ENV="${BUILD_ENV:-$ROOT/../build-env}"

if [ -z "${JAVA_HOME:-}" ] && [ -d "$BUILD_ENV/jdk-21.0.12.1+1" ]; then
  export JAVA_HOME="$BUILD_ENV/jdk-21.0.12.1+1"
fi
: "${JAVA_HOME:?JAVA_HOME nicht gesetzt und kein JDK in build-env}"
export ANDROID_HOME="$BUILD_ENV/android-sdk"
GRADLE_BIN="$BUILD_ENV/gradle-8.10.2/bin/gradle"

echo ">> Sim bauen (assets/index.html)"
python3 "$ROOT/tools/build_sim.py"

echo ">> APK bauen (Release, debug-signiert) — AGP-Download beim ersten Lauf"
"$GRADLE_BIN" -p "$ROOT" :app:assembleRelease --no-daemon

APK="$ROOT/app/build/outputs/apk/release/app-release.apk"
echo ">> Fertig: $APK ($(du -h "$APK" | cut -f1))"
