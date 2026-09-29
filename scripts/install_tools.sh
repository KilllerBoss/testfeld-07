#!/bin/bash
# Toolchain-Reinstallation nach Environment-Reset (bekannte Prozedur, vgl. Task 57)
set -x
mkdir -p /home/z/tools
cd /home/z/tools

# Gradle 8.7
if [ ! -d /home/z/tools/gradle-8.7 ]; then
  curl -sL -o gradle.zip https://services.gradle.org/distributions/gradle-8.7-bin.zip
  unzip -q gradle.zip && rm gradle.zip
fi

# Android cmdline-tools + SDK 34
if [ ! -d /home/z/tools/android-sdk/cmdline-tools/latest ]; then
  curl -sL -o cmdtools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  mkdir -p android-sdk/cmdline-tools
  unzip -q cmdtools.zip -d android-sdk/cmdline-tools
  mv android-sdk/cmdline-tools/cmdline-tools android-sdk/cmdline-tools/latest
  rm cmdtools.zip
fi

export ANDROID_HOME=/home/z/tools/android-sdk
yes | /home/z/tools/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=$ANDROID_HOME "platforms;android-34" "build-tools;34.0.0" "platform-tools" > /home/z/tools/sdk_install.log 2>&1

echo "TOOLS_DONE"
ls /home/z/tools/ && ls $ANDROID_HOME
