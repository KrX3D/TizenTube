# TizenTube for Android TV

This is an Android TV WebView host for the existing TizenTube userscript. It is
intended for devices such as the Sony BRAVIA A90K running Android/Google TV.

The APK contains no native libraries, so one APK supports both 32-bit ARM
(`armeabi-v7a`) and 64-bit ARM devices. The committed `dist/userScript.js` is
copied into the APK at build time. The host registers the injection at document
start, then runs TizenTube as soon as the page DOM is ready.

## Build

Open `android-tv/` in Android Studio and select **Build > Build APK(s)**, or run:

```powershell
cd android-tv
.\gradlew.bat assembleDebug
```

The debug APK is written to:

```text
app/build/outputs/apk/debug/app-debug.apk
```

Install it over ADB with:

```powershell
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

GitHub Actions also builds the APK for every Android TV pull request and every
matching change merged to `main`. Download `TizenTube-AndroidTV-debug` from the
workflow run's **Artifacts** section.

The TV's Android System WebView must support document-start scripts. If it does
not, the app shows a warning and uses a less reliable page-start fallback.

When injection succeeds, the app shows a **TizenTube is active** message. Press
the remote's **GREEN** colour button to open the TizenTube settings. The Android
host translates Sony/Android colour-button key codes to the codes expected by
the original Tizen UI.

## Current limitations

- This is an initial Android TV port and requires testing on physical hardware.
- YouTube can change or restrict its TV web client independently of this app.
- The original Tizen service, DIAL server, CDP injector, and Tizen-specific APIs
  are not used on Android.
