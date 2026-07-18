import { useCallback, useEffect } from 'react';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar, Banner, Body, Button, Card, EmptyState, Title } from '@/components/ui';
import { formatMoney } from '@/domain/money';
import type { DiscoveredGroup } from '@/domain/types';
import { useInstallationRecheck } from '@/features/groups/use-installation-recheck';
import { githubInstallationUrl } from '@/config/app';
import { useGroups } from '@/providers/groups-provider';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';

export default function GroupsScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const focused = useIsFocused();
  const { state, aggregates, hasInstallation, canCreateGroups, pendingCreation, refresh, retryPendingCreation } = useGroups();
  const runRefresh = useCallback(() => { void refresh().catch(() => undefined); }, [refresh]);
  useFocusEffect(useCallback(() => { runRefresh(); }, [runRefresh]));
  const installationRecheck = useInstallationRecheck({ focused, hasRequiredAccess: canCreateGroups, refresh });
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => { if (next === 'active' && focused) runRefresh(); });
    return () => listener.remove();
  }, [focused, runRefresh]);
  const waitingForInstallation = state.status !== 'idle' && state.status !== 'loading' && !hasInstallation;
  const recheckInstallation = () => { installationRecheck.restart(); runRefresh(); };
  const openInstallation = () => { installationRecheck.restart(); void Linking.openURL(githubInstallationUrl); };

  const renderGroup = ({ item }: { item: DiscoveredGroup }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.group.name}`} onPress={() => router.push({ pathname: '/groups/[owner]/[repo]', params: { owner: item.repository.owner, repo: item.repository.name } } as never)}>
    <Card>
      <Text style={[styles.groupName, { color: colors.text }]}>{item.group.name}</Text>
      <Body muted>{item.summary ? `${item.summary.memberCount} members · ${item.summary.expenseCount} expenses` : 'Open to sync group data'}</Body>
      {item.summary ? <Text style={{ color: item.summary.currentUserBalanceMinor >= 0 ? colors.positive : colors.negative, fontWeight: '800' }}>
        {item.summary.currentUserBalanceMinor >= 0 ? 'You are owed ' : 'You owe '}{formatMoney(Math.abs(item.summary.currentUserBalanceMinor), item.group.currency)}
      </Text> : null}
    </Card>
  </Pressable>;

  return <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
    <FlatList data={state.data} keyExtractor={(item) => item.key} renderItem={renderGroup} contentContainerStyle={styles.content} alwaysBounceVertical overScrollMode="always"
      refreshControl={<RefreshControl refreshing={state.isRefreshing} onRefresh={runRefresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.surface} />}
      ListHeaderComponent={<View style={styles.header}>
        <View style={styles.accountRow}><View style={{ flex: 1 }}><Title eyebrow={`Hello, ${session.account?.name ?? session.account?.login ?? ''}`}>Your groups</Title></View><Pressable accessibilityLabel="Open account" accessibilityRole="button" onPress={() => router.push('/account' as never)}><Avatar login={session.account?.login ?? '?'} uri={session.account?.avatarUrl} /></Pressable></View>
        {aggregates.map((aggregate) => <Card key={aggregate.currency}><Body>{aggregate.currency}</Body><View style={styles.totals}><View><Body muted>You are owed</Body><Text style={[styles.total, { color: colors.positive }]}>{formatMoney(aggregate.owedMinor, aggregate.currency)}</Text></View><View><Body muted>You owe</Body><Text style={[styles.total, { color: colors.negative }]}>{formatMoney(aggregate.owingMinor, aggregate.currency)}</Text></View></View><Body muted>As of {new Date(aggregate.asOf).toLocaleString()}</Body></Card>)}
        {state.error ? <Banner tone="warning" action={<Button variant="ghost" onPress={runRefresh}>Retry</Button>}>{state.error}</Banner> : null}
        {waitingForInstallation ? <InstallationConnectionCard attempts={installationRecheck.attempts} maxAttempts={installationRecheck.maxAttempts} checking={installationRecheck.checking || state.isRefreshing} exhausted={installationRecheck.exhausted} onRecheck={recheckInstallation} onOpenInstallation={openInstallation} /> : null}
        {hasInstallation && !canCreateGroups ? <Banner action={<View style={styles.bannerActions}><Button accessibilityLabel="Recheck GitHub access" onPress={runRefresh}>Recheck</Button><Button variant="ghost" onPress={() => void Linking.openURL(githubInstallationUrl)}>Manage</Button></View>}>Installation found. It must cover all repositories so newly created groups remain accessible.</Banner> : null}
        {pendingCreation ? <Banner tone="warning" action={<Button onPress={() => void retryPendingCreation().catch(() => undefined)}>Finish setup</Button>}>Repository {pendingCreation.repository.name} still needs its group file.</Banner> : null}
        {!waitingForInstallation ? <Button disabled={!canCreateGroups} onPress={() => router.push('/groups/new' as never)}>Create a group</Button> : null}
      </View>}
      ListEmptyComponent={state.status === 'loading' ? <EmptyState title="Finding groups…" body="Checking repositories available to your GitHub App installation." /> : waitingForInstallation ? null : <EmptyState title="No groups yet" body="Create a private GitHub-backed group to start sharing expenses." />}
    />
  </SafeAreaView>;
}

function InstallationConnectionCard({ attempts, maxAttempts, checking, exhausted, onRecheck, onOpenInstallation }: { attempts: number; maxAttempts: number; checking: boolean; exhausted: boolean; onRecheck(): void; onOpenInstallation(): void }) {
  const { colors } = useTheme();
  const percentage = maxAttempts > 0 ? Math.min((attempts / maxAttempts) * 100, 100) : 0;
  const status = exhausted
    ? 'GitHub is still not reporting the installation. Restart automatic checks or confirm the installation settings.'
    : attempts === 0 ? 'Checking GitHub now…' : `Automatic recheck ${attempts} of ${maxAttempts}`;
  return <Card style={{ ...styles.connectionCard, borderLeftColor: colors.accent }}>
    <View style={styles.connectionHeading}>{checking ? <ActivityIndicator accessibilityLabel="Checking GitHub App access" color={colors.accent} size="small" /> : null}<View style={{ flex: 1 }}><Text style={[styles.connectionTitle, { color: colors.text }]}>Connecting your GitHub App</Text><Body muted>An installation can take around 30–60 seconds to become available after GitHub confirms it.</Body></View></View>
    <View accessibilityRole="progressbar" accessibilityLabel={`GitHub access rechecks: ${attempts} of ${maxAttempts}`} accessibilityValue={{ min: 0, max: maxAttempts, now: attempts }} style={[styles.progressTrack, { backgroundColor: colors.border }]}><View style={[styles.progressFill, { backgroundColor: colors.accent, width: `${percentage}%` as `${number}%` }]} /></View>
    <Body muted>{status}</Body>
    <Body muted>You can leave this screen open; groups will appear automatically as soon as access is ready.</Body>
    <View style={styles.bannerActions}><View style={styles.connectionAction}><Button accessibilityLabel="Recheck GitHub access" onPress={onRecheck}>{exhausted ? 'Restart checks' : 'Recheck now'}</Button></View><View style={styles.connectionAction}><Button variant="secondary" onPress={onOpenInstallation}>Open GitHub</Button></View></View>
  </Card>;
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { flexGrow: 1, padding: 20, gap: 13 }, header: { gap: 14 }, accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, bannerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, connectionCard: { borderLeftWidth: 4 }, connectionHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 }, connectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800' }, progressTrack: { height: 8, overflow: 'hidden', borderRadius: 999 }, progressFill: { height: '100%', borderRadius: 999 }, connectionAction: { flexGrow: 1, minWidth: 130 }, totals: { flexDirection: 'row', justifyContent: 'space-between' }, total: { fontSize: 22, fontWeight: '800' }, groupName: { fontSize: 19, fontWeight: '800' } });
