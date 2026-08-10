import { Fuel, Luggage } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { groupTypeDefinition } from '@/domain/groups';
import type { KnownGroupType } from '@/domain/types';
import { useTheme } from '@/providers/theme-provider';

export function GroupTypeIcon({ type, size = 22, color }: { type: KnownGroupType; size?: number; color?: string }) {
  const { colors } = useTheme();
  const iconColor = color ?? (type === 'fuel' ? colors.warning : colors.accent);
  return type === 'fuel' ? <Fuel color={iconColor} size={size} /> : <Luggage color={iconColor} size={size} />;
}

export function GroupTypeBadge({ type, compact = false }: { type: KnownGroupType; compact?: boolean }) {
  const { colors } = useTheme();
  const label = groupTypeDefinition[type].label;
  return <View accessibilityLabel={`${label} group`} style={[styles.badge, { borderColor: colors.border, backgroundColor: colors.surfaceStrong }, compact && styles.compact]}>
    <GroupTypeIcon type={type} size={compact ? 15 : 17} />
    <Text style={[styles.label, { color: colors.text }, compact && styles.compactLabel]}>{label}</Text>
  </View>;
}

export function groupContextLabel(type: KnownGroupType | null | undefined, name: string): string {
  return type ? `${groupTypeDefinition[type].label} · ${name}` : `Update required · ${name}`;
}

const styles = StyleSheet.create({
  badge: { minHeight: 32, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  compact: { minHeight: 28, paddingHorizontal: 8 },
  label: { fontSize: 14, fontWeight: '800' },
  compactLabel: { fontSize: 12 },
});
