# BranchBalance agent guidance

## Android physical-device development

Expo's default connection uses the local network. When a connected Android device is on mobile data, has Wi-Fi disabled, or otherwise cannot reach the Mac, Expo Go can fail before JavaScript loads with `java.io.IOException: Failed to download remote update`.

For development over USB, verify the device, reverse Metro's port, and use Expo's localhost mode:

```sh
adb devices
adb reverse tcp:8081 tcp:8081
npx expo start --localhost --android
```

The reverse mapping may need to be recreated after the USB cable or device reconnects. When the Mac and device are on the same Wi-Fi network, the standard `npm run android` command can use the LAN connection.

Treat this download failure as a device-to-Metro connectivity problem before investigating application JavaScript. Errors logged after the bundle loads, such as API HTTP 500 responses, are separate application-level failures.
