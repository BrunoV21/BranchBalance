import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GroupsProvider } from '@/providers/groups-provider';
import { SessionProvider, useSession } from '@/providers/session-provider';
import { ThemeProvider, useTheme } from '@/providers/theme-provider';

void SplashScreen.preventAutoHideAsync();

function Navigation() {
  const { session } = useSession();
  const { colors, mode } = useTheme();
  useEffect(() => { if (session.status !== 'hydrating') void SplashScreen.hideAsync(); }, [session.status]);
  return <>
    <Stack screenOptions={{ headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(app)" options={{ headerShown: false }} />
    </Stack>
    <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
  </>;
}

export default function RootLayout() {
  return <SafeAreaProvider><ThemeProvider><SessionProvider><GroupsProvider><Navigation /></GroupsProvider></SessionProvider></ThemeProvider></SafeAreaProvider>;
}
