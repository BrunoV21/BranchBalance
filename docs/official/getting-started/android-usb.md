---
title: Android development over USB
description: Connect Expo Go to Metro when the phone cannot reach the development machine over the local network.
---

# Android development over USB

Expo’s default connection uses the local network. If the phone is on mobile data, has Wi-Fi disabled, or cannot reach the Mac, Expo Go can fail before JavaScript loads with `Failed to download remote update`.

With USB debugging enabled and the device connected:

```sh
adb devices
adb reverse tcp:8081 tcp:8081
npx expo start --localhost --android
```

Recreate the reverse mapping after reconnecting the USB cable or device. If the phone and Mac are on the same Wi-Fi network, `npm run android` is sufficient.

Treat a remote-update download failure as device-to-Metro connectivity first. API failures logged after the JavaScript bundle loads are separate application-level issues.
