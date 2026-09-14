#!/bin/bash
# install_sdk_v290.sh — Android-SDK installieren (Environment-Reset-Fix)
set -e
TOOLS=/home/z/tools
SDK=$TOOLS/android-sdk
mkdir -p $TOOLS
cd $TOOLS
if [ ! -d $SDK/cmdline-tools ]; then
  echo "Lade cmdline-tools …"
  curl -sSLo cmdtools.zip "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  mkdir -p $SDK/cmdline-tools
  unzip -q cmdtools.zip -d $SDK/cmdline-tools
  mv $SDK/cmdline-tools/cmdline-tools $SDK/cmdline-tools/latest 2>/dev/null || true
  rm cmdtools.zip
fi
export ANDROID_HOME=$SDK
export PATH=$SDK/cmdline-tools/latest/bin:$PATH
yes | sdkmanager --licenses > /dev/null 2>&1 || true
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools" > /dev/null 2>&1
echo "SDK installiert:"
ls $SDK
echo "platforms:"; ls $SDK/platforms
echo "build-tools:"; ls $SDK/build-tools
