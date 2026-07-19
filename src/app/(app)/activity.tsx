import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { ChartPie, CircleCheck, FolderGit2, HandCoins, Inbox, Mail, Plus, ReceiptText, RefreshCw, Trash2, UsersRound, X } from 'lucide-react-native';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner, Body, ConfirmDialog, EmptyState, Screen, Title } from '@/components/ui';
import type { ActivityItem, ActivityKind, GroupKey } from '@/domain/types';
import { activityLabels } from '@/features/activity/catalog';
import { useGroups } from '@/providers/groups-provider';
import { useTheme } from '@/providers/theme-provider';

export default function ActivityScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { activityState, activityWarning, markActivityRead, dismissActivity, clearActivity } = useGroups();
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const unread = activityState.data.filter((item) => item.readAt === null);
  const earlier = activityState.data.filter((item) => item.readAt !== null);

  useEffect(() => {
    const unreadIds = activityState.data.filter((item) => item.readAt === null).map((item) => item.id);
    if (unreadIds.length) void markActivityRead(unreadIds).catch(() => undefined);
  }, [activityState.data, markActivityRead]);

  const openItem = (item: ActivityItem) => {
    if (item.destination.kind === 'groups' || !item.groupKey) {
      router.replace('/groups' as never);
      return;
    }
    const [owner, repo] = splitGroupKey(item.groupKey);
    if (item.destination.kind === 'expense') {
      router.push({ pathname: '/groups/[owner]/[repo]/expenses/[id]', params: { owner, repo, id: item.destination.expenseId } } as never);
    } else if (item.destination.kind === 'spending') {
      router.push({ pathname: '/groups/[owner]/[repo]/spending', params: { owner, repo } } as never);
    } else if (item.destination.kind === 'balances') {
      router.push({ pathname: '/groups/[owner]/[repo]/balances', params: { owner, repo } } as never);
    } else {
      router.push({ pathname: '/groups/[owner]/[repo]', params: { owner, repo } } as never);
    }
  };

  const confirmClearAll = () => {
    setClearing(true);
    void clearActivity().then(() => setConfirmClear(false)).catch(() => undefined).finally(() => setClearing(false));
  };

  return <>
    <Screen>
      <View style={styles.heading}>
        <View style={styles.headingTitle}><Title eyebrow="Across your groups">Recent activity</Title></View>
        {activityState.data.length ? <Pressable accessibilityRole="button" accessibilityLabel="Clear all activity" onPress={() => setConfirmClear(true)} style={({ pressed }) => [styles.clearButton, { opacity: pressed ? 0.65 : 1 }]}><Text style={[styles.clearText, { color: colors.accent }]}>Clear all</Text></Pressable> : null}
      </View>
      <View style={styles.statusRow}>
        <View style={[styles.statusPill, { backgroundColor: colors.surface, borderColor: colors.border }]}><View style={[styles.statusDot, { backgroundColor: activityState.error ? colors.warning : colors.positive }]} /><Text style={[styles.statusText, { color: colors.text }]}>{activityState.isRefreshing ? 'Checking…' : activityState.lastSuccessfulAt ? `Checked ${formatActivityTime(activityState.lastSuccessfulAt)}` : 'Saved activity'}</Text></View>
        <Body muted>Foreground refresh</Body>
      </View>
      <Banner tone="info" icon={<RefreshCw color={colors.text} size={18} />}>Activity appears after BranchBalance checks GitHub while the app is open. It is a recent summary, not real-time push delivery.</Banner>
      {activityState.error ? <Banner tone="warning">{activityState.error}</Banner> : null}
      {activityWarning ? <Banner tone="warning">{activityWarning}</Banner> : null}
      {activityState.data.length ? <View style={styles.sections}>
        {unread.length ? <ActivitySection title="New since your last visit" items={unread} newCount={unread.length} onOpen={openItem} onDismiss={(id) => void dismissActivity(id).catch(() => undefined)} /> : null}
        {earlier.length ? <ActivitySection title={unread.length ? 'Earlier' : 'Recent'} items={earlier} onOpen={openItem} onDismiss={(id) => void dismissActivity(id).catch(() => undefined)} /> : null}
      </View> : <EmptyState icon={<Inbox color={colors.accent} size={52} strokeWidth={1.6} />} title="Nothing new to review" body="New activity will appear here after BranchBalance observes group changes during a foreground refresh." />}
    </Screen>
    <ConfirmDialog visible={confirmClear} title="Clear all activity?" message="This removes every item from this device. BranchBalance will keep its sync checkpoints so the same activity does not reappear." confirmLabel="Clear all" loading={clearing} onCancel={() => setConfirmClear(false)} onConfirm={confirmClearAll} />
  </>;
}

function ActivitySection({ title, items, newCount, onOpen, onDismiss }: { title: string; items: ActivityItem[]; newCount?: number; onOpen(item: ActivityItem): void; onDismiss(id: string): void }) {
  const { colors } = useTheme();
  return <View style={styles.section}>
    <View style={styles.sectionHeading}><Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>{newCount ? <View style={[styles.newPill, { backgroundColor: colors.accent }]}><Text style={[styles.newPillText, { color: colors.accentText }]}>{newCount} new</Text></View> : null}</View>
    <View style={styles.list}>{items.map((item) => <ActivityRow key={item.id} item={item} onOpen={() => onOpen(item)} onDismiss={() => onDismiss(item.id)} />)}</View>
  </View>;
}

function ActivityRow({ item, onOpen, onDismiss }: { item: ActivityItem; onOpen(): void; onDismiss(): void }) {
  const { colors } = useTheme();
  const [translateX] = useState(() => new Animated.Value(0));
  const unread = item.readAt === null;
  const actor = item.actorLogin ? `@${item.actorLogin}` : 'A collaborator';
  const metadata = item.kind === 'group_invitation_received' && item.actorLogin ? `Invited by ${actor}` : actor;
  const resetPosition = useCallback(() => Animated.spring(translateX, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 6 }).start(), [translateX]);
  const completeDismiss = useCallback(() => {
    Animated.timing(translateX, { toValue: 500, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onDismiss();
    });
  }, [onDismiss, translateX]);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderMove: (_event, gesture) => translateX.setValue(Math.max(0, gesture.dx)),
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dx >= 84 || (gesture.dx >= 24 && gesture.vx >= 0.65)) completeDismiss();
      else resetPosition();
    },
    onPanResponderTerminate: resetPosition,
  }), [completeDismiss, resetPosition, translateX]);

  return <View style={[styles.swipeContainer, { backgroundColor: colors.positive }]}>
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.swipeAction}><Trash2 color={colors.accentText} size={20} /><Text style={[styles.swipeActionText, { color: colors.accentText }]}>Clear</Text></View>
    <Animated.View testID={`activity-swipe-${item.id}`} {...panResponder.panHandlers} style={[styles.row, { backgroundColor: colors.surface, borderColor: unread ? colors.accent : colors.border, transform: [{ translateX }] }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${activityLabels[item.kind]} in ${item.groupName}, ${metadata}, ${formatActivityTime(item.eventAt)}`} accessibilityHint="Swipe right to clear this activity item" onPress={onOpen} style={({ pressed }) => [styles.rowLink, { opacity: pressed ? 0.68 : 1 }]}>
        <View style={[styles.icon, { backgroundColor: colors.surfaceStrong }]}>{iconForActivity(item.kind, colors.accent)}</View>
        <View style={styles.rowBody}><View style={styles.titleRow}><Text style={[styles.itemTitle, { color: colors.text }]}>{activityLabels[item.kind]}</Text>{unread ? <Text style={[styles.newLabel, { color: colors.accent }]}>New</Text> : null}</View><Text style={[styles.groupName, { color: colors.text }]}>{item.groupName}</Text><Body muted>{metadata} · {formatActivityTime(item.eventAt)}</Body></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss ${activityLabels[item.kind]} in ${item.groupName}`} hitSlop={8} onPress={onDismiss} style={({ pressed }) => [styles.dismiss, { opacity: pressed ? 0.55 : 1 }]}><X color={colors.muted} size={19} /></Pressable>
    </Animated.View>
  </View>;
}

function iconForActivity(kind: ActivityKind, color: string): ReactNode {
  if (kind === 'expense_added') return <Plus color={color} size={21} />;
  if (kind === 'expense_updated' || kind === 'expense_deleted') return <ReceiptText color={color} size={21} />;
  if (kind === 'spending_plan_updated' || kind === 'spending_plan_removed') return <ChartPie color={color} size={21} />;
  if (kind === 'settlement_recorded' || kind === 'settlement_deleted') return <HandCoins color={color} size={21} />;
  if (kind === 'settlement_confirmed') return <CircleCheck color={color} size={21} />;
  if (kind === 'group_invitation_received') return <Mail color={color} size={21} />;
  if (kind === 'group_added') return <UsersRound color={color} size={21} />;
  return <FolderGit2 color={color} size={21} />;
}

function splitGroupKey(key: GroupKey): [string, string] {
  const slash = key.indexOf('/');
  return [key.slice(0, slash), key.slice(slash + 1)];
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 60_000) return 'just now';
  if (elapsed >= 0 && elapsed < 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} min ago`;
  if (elapsed >= 0 && elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))} hr ago`;
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, headingTitle: { flex: 1 }, clearButton: { minWidth: 64, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }, clearText: { fontSize: 15, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }, statusPill: { minHeight: 34, borderRadius: 17, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7 }, statusDot: { width: 7, height: 7, borderRadius: 4 }, statusText: { fontSize: 13, fontWeight: '700' },
  sections: { gap: 24 }, section: { gap: 12 }, sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, sectionTitle: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: '800' }, newPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }, newPillText: { fontSize: 12, fontWeight: '800' }, list: { gap: 10 },
  swipeContainer: { position: 'relative', borderRadius: 16, overflow: 'hidden' }, swipeAction: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 108, paddingLeft: 18, flexDirection: 'row', alignItems: 'center', gap: 7 }, swipeActionText: { fontSize: 14, fontWeight: '800' },
  row: { minHeight: 94, borderWidth: 1, borderRadius: 16, flexDirection: 'row', overflow: 'hidden' }, rowLink: { flex: 1, minWidth: 0, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, rowBody: { flex: 1, minWidth: 0, gap: 3 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, itemTitle: { flexShrink: 1, fontSize: 16, lineHeight: 21, fontWeight: '800' }, newLabel: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase' }, groupName: { fontSize: 14, lineHeight: 20, fontWeight: '700' }, dismiss: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
