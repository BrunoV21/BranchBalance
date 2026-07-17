import { useCallback, useEffect } from 'react';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
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
  useInstallationRecheck({ focused, hasRequiredAccess: canCreateGroups, refresh });
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => { if (next === 'active' && focused) runRefresh(); });
    return () => listener.remove();
  }, [focused, runRefresh]);

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
        {state.status !== 'idle' && state.status !== 'loading' && !hasInstallation ? <Banner action={<View style={styles.bannerActions}><Button accessibilityLabel="Recheck GitHub access" onPress={runRefresh}>Recheck</Button><Button variant="ghost" onPress={() => void Linking.openURL(githubInstallationUrl)}>Install</Button></View>}>Waiting for GitHub App access. This can take a few seconds after installation; pull down or tap Recheck.</Banner> : null}
        {hasInstallation && !canCreateGroups ? <Banner action={<View style={styles.bannerActions}><Button accessibilityLabel="Recheck GitHub access" onPress={runRefresh}>Recheck</Button><Button variant="ghost" onPress={() => void Linking.openURL(githubInstallationUrl)}>Manage</Button></View>}>Installation found. It must cover all repositories so newly created groups remain accessible.</Banner> : null}
        {pendingCreation ? <Banner tone="warning" action={<Button onPress={() => void retryPendingCreation().catch(() => undefined)}>Finish setup</Button>}>Repository {pendingCreation.repository.name} still needs its group file.</Banner> : null}
        <Button disabled={!canCreateGroups} onPress={() => router.push('/groups/new' as never)}>Create a group</Button>
      </View>}
      ListEmptyComponent={state.status === 'loading' ? <EmptyState title="Finding groups…" body="Checking repositories available to your GitHub App installation." /> : <EmptyState title="No groups yet" body="Create a private GitHub-backed group to start sharing expenses." />}
    />
  </SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { flexGrow: 1, padding: 20, gap: 13 }, header: { gap: 14 }, accountRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, bannerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, totals: { flexDirection: 'row', justifyContent: 'space-between' }, total: { fontSize: 22, fontWeight: '800' }, groupName: { fontSize: 19, fontWeight: '800' } });
