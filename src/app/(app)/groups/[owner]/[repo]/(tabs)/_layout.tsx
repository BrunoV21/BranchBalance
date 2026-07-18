import { Tabs } from 'expo-router';
import { ChartPie, CircleDollarSign, List, Users } from 'lucide-react-native';

import { useTheme } from '@/providers/theme-provider';

export default function GroupTabsLayout() {
  const { colors } = useTheme();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.accent, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border } }}>
    <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: ({ color, size }) => <List color={color} size={size} /> }} />
    <Tabs.Screen name="spending" options={{ title: 'Spending', tabBarIcon: ({ color, size }) => <ChartPie color={color} size={size} /> }} />
    <Tabs.Screen name="balances" options={{ title: 'Balances', tabBarIcon: ({ color, size }) => <CircleDollarSign color={color} size={size} /> }} />
    <Tabs.Screen name="members" options={{ title: 'Members', tabBarIcon: ({ color, size }) => <Users color={color} size={size} /> }} />
  </Tabs>;
}
