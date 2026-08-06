import type { PropsWithChildren, ReactNode, Ref } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, type TextStyle, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/providers/theme-provider';

export function Screen({ children, scroll = true, contentStyle, scrollViewRef }: PropsWithChildren<{ scroll?: boolean; contentStyle?: ViewStyle; scrollViewRef?: Ref<ScrollView> }>) {
  const { colors } = useTheme();
  const content = scroll
    ? <ScrollView ref={scrollViewRef} contentContainerStyle={[styles.content, contentStyle]} keyboardShouldPersistTaps="handled">{children}</ScrollView>
    : <View style={[styles.flex, contentStyle]}>{children}</View>;
  return <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>{content}</KeyboardAvoidingView></SafeAreaView>;
}

export function Title({ children, eyebrow }: PropsWithChildren<{ eyebrow?: string }>) {
  const { colors } = useTheme();
  return <View style={styles.titleBlock}>{eyebrow ? <Text style={[styles.eyebrow, { color: colors.accent }]}>{eyebrow.toUpperCase()}</Text> : null}<Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{children}</Text></View>;
}

export function Body({ children, muted = false, style }: PropsWithChildren<{ muted?: boolean; style?: TextStyle }>) {
  const { colors } = useTheme();
  return <Text style={[styles.body, { color: muted ? colors.muted : colors.text }, style]}>{children}</Text>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>{children}</View>;
}

export function Button({ children, icon, onPress, disabled, loading, variant = 'primary', accessibilityLabel }: PropsWithChildren<{ icon?: ReactNode; onPress(): void; disabled?: boolean; loading?: boolean; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; accessibilityLabel?: string }>) {
  const { colors } = useTheme();
  const backgroundColor = variant === 'primary' ? colors.accent : variant === 'danger' ? colors.negative : variant === 'ghost' ? 'transparent' : colors.surfaceStrong;
  const color = variant === 'primary' || variant === 'danger' ? colors.accentText : colors.text;
  return <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor, borderColor: colors.border, opacity: disabled ? 0.45 : pressed ? 0.72 : 1 }]}>
    {loading ? <ActivityIndicator color={color} /> : <View style={styles.buttonContent}>{icon}<Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={[styles.buttonText, { color }]}>{children}</Text></View>}
  </Pressable>;
}

export function Field({ label, labelIcon, error, style, ...props }: TextInputProps & { label: string; labelIcon?: ReactNode; error?: string }) {
  const { colors } = useTheme();
  return <View style={styles.field}><View style={styles.labelRow}>{labelIcon}<Text style={[styles.label, { color: colors.text }]}>{label}</Text></View><TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={[styles.input, { backgroundColor: colors.surfaceStrong, borderColor: error ? colors.negative : colors.border, color: colors.text }, style]} {...props} />{error ? <Text accessibilityLiveRegion="polite" style={[styles.help, { color: colors.negative }]}>{error}</Text> : null}</View>;
}

export function Banner({ children, tone = 'warning', action, icon }: PropsWithChildren<{ tone?: 'warning' | 'error' | 'info'; action?: ReactNode; icon?: ReactNode }>) {
  const { colors } = useTheme();
  const color = tone === 'error' ? colors.negative : tone === 'warning' ? colors.warning : colors.text;
  return <View accessibilityLiveRegion="polite" style={[styles.banner, { borderColor: color, backgroundColor: colors.surface }]}><View style={styles.bannerContent}>{icon}<Text style={[styles.body, styles.bannerText, { color }]}>{children}</Text></View>{action}</View>;
}

export function ConfirmDialog({ visible, title, message, confirmLabel, confirmVariant = 'danger', loading = false, onCancel, onConfirm }: { visible: boolean; title: string; message: string; confirmLabel: string; confirmVariant?: 'primary' | 'danger'; loading?: boolean; onCancel(): void; onConfirm(): void }) {
  const { colors } = useTheme();
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (!loading) onCancel(); }}>
    <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
      <View accessibilityRole="alert" accessibilityViewIsModal style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.dialogTitle, { color: colors.text }]}>{title}</Text>
        <ScrollView style={styles.dialogMessage} contentContainerStyle={styles.dialogMessageContent}><Text selectable style={[styles.body, { color: colors.muted }]}>{message}</Text></ScrollView>
        <View style={styles.dialogActions}>
          <View style={styles.dialogCancelAction}><Button variant="secondary" disabled={loading} onPress={onCancel}>Cancel</Button></View>
          <View style={styles.dialogConfirmAction}><Button variant={confirmVariant} loading={loading} onPress={onConfirm}>{confirmLabel}</Button></View>
        </View>
      </View>
    </View>
  </Modal>;
}

export function Avatar({ login, uri, size = 44 }: { login: string; uri?: string | null; size?: number }) {
  const { colors } = useTheme();
  const initials = login.slice(0, 2).toUpperCase();
  return uri ? <Image accessibilityLabel={`${login}'s avatar`} source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
    : <View accessibilityLabel={`${login}'s avatar`} style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent }]}><Text style={{ color: colors.accentText, fontWeight: '800' }}>{initials}</Text></View>;
}

export function EmptyState({ title, body, action, icon }: { title: string; body: string; action?: ReactNode; icon?: ReactNode }) {
  const { colors } = useTheme();
  return <View style={styles.empty}>{icon}<Text style={[styles.subtitle, { color: colors.text }]}>{title}</Text><Text style={[styles.body, { color: colors.muted, textAlign: 'center' }]}>{body}</Text>{action}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, content: { flexGrow: 1, padding: 20, gap: 16 }, titleBlock: { gap: 5, marginBottom: 8 }, eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  title: { fontFamily: Platform.select({ android: 'serif', default: undefined }), fontSize: 32, fontWeight: '700', lineHeight: 38 }, subtitle: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 }, card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 }, button: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }, buttonContent: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, buttonText: { flexShrink: 1, fontSize: 15, fontWeight: '800' },
  field: { gap: 7 }, labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, label: { fontSize: 14, fontWeight: '700' }, input: { minHeight: 50, borderRadius: 11, borderWidth: 1, paddingHorizontal: 14, fontSize: 16 }, help: { fontSize: 12, lineHeight: 17 },
  banner: { borderLeftWidth: 4, borderRadius: 10, padding: 13, gap: 10 }, bannerContent: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, bannerText: { flex: 1 }, avatar: { alignItems: 'center', justifyContent: 'center' }, empty: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  modalOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }, dialog: { width: '100%', maxWidth: 440, borderRadius: 18, borderWidth: 1, padding: 20, gap: 16, elevation: 12 }, dialogTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800' }, dialogMessage: { maxHeight: 360 }, dialogMessageContent: { flexGrow: 1 }, dialogActions: { flexDirection: 'row', gap: 10, marginTop: 4 }, dialogCancelAction: { flex: 0.85 }, dialogConfirmAction: { flex: 1.15 },
});
