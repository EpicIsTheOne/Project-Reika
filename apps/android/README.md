# Reika for Android

Native mobile cockpit for Epic's Project Reika ecosystem.

This is **not** a standalone chatbot and does not implement provider logic.
It is a secure control surface that connects to Reika Nodes through Reika
Relay, keeping provider execution on the node and transport through the relay.

## Stack

- Kotlin + Jetpack Compose (Material 3)
- Hilt (dependency injection)
- Navigation Compose
- Kotlinx Serialization
- DataStore (preferences) + Android Keystore (secure credentials)
- Room (offline cache, added in later phases)

## Build

```bash
export ANDROID_HOME=/path/to/android-sdk
cd apps/android
./gradlew assembleDebug
```

The debug APK is produced at
`app/build/outputs/apk/debug/app-debug.apk`.

## Status

Phase 1 scaffold: application shell, design tokens, navigation root, and a
minimal relay-configuration screen. The pairing/device vertical slice follows
(see the Project Reika Android brief, phases 2-3).
