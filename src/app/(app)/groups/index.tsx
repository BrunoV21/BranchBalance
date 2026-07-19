import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { ActivityIndicator, AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Inbox } from 'lucide-react-native';

import { Avatar, Banner, Body, Button, Card, ConfirmDialog, EmptyState, Title } from '@/components/ui';
import { formatMoney } from '@/domain/money';
import type { DiscoveredGroup, PendingGroupInvitation } from '@/domain/types';
import { useInstallationRecheck } from '@/features/groups/use-installation-recheck';
import { githubAuthorizationSettingsUrl, githubInstallationUrl } from '@/config/app';
import { useGroups } from '@/providers/groups-provider';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';

export default function GroupsScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { colors } = useTheme();
  const focused = useIsFocused();
  const [declineTarget, setDeclineTarget] = useState<PendingGroupInvitation | null>(null);
  const {
    state, groupWarningCount, aggregates, hasInstallation, canCreateGroups, pendingCreation,
    invitationState, invitationWarningCount, invitationMutations, acceptedPendingDiscovery, invitationNotice,
    hasUnreadActivity,
    refresh, acceptInvitation, declineInvitation, retryPendingCreation,
  } = useGroups();
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
  const confirmDecline = () => {
    if (!declineTarget) return;
    void declineInvitation(declineTarget.id).catch(() => undefined).finally(() => setDeclineTarget(null));
  };

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
      refreshControl={<RefreshControl refreshing={state.isRefreshing || invitationState.isRefreshing} onRefresh={runRefresh} tintColor={colors.accent} colors={[colors.accent]} progressBackgroundColor={colors.surface} />}
      ListHeaderComponent={<View testID="groups-list-header" style={styles.header}>
        <View style={styles.accountRow}><View style={{ flex: 1 }}><Title eyebrow={`Hello, ${session.account?.name ?? session.account?.login ?? ''}`}>Your groups</Title></View><Pressable accessibilityLabel={hasUnreadActivity ? 'Activity inbox, new activity' : 'Activity inbox'} accessibilityRole="button" hitSlop={4} onPress={() => router.push('/activity' as never)} style={({ pressed }) => [styles.inboxButton, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}><Inbox color={colors.text} size={23} /><View accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.unreadDot, { backgroundColor: hasUnreadActivity ? colors.accent : 'transparent' }]} /></Pressable><Pressable accessibilityLabel="Open account" accessibilityRole="button" onPress={() => router.push('/account' as never)}><Avatar login={session.account?.login ?? '?'} uri={session.account?.avatarUrl} /></Pressable></View>
        {aggregates.map((aggregate) => <Card key={aggregate.currency}><Body>{aggregate.currency}</Body><View style={styles.totals}><View><Body muted>You are owed</Body><Text style={[styles.total, { color: colors.positive }]}>{formatMoney(aggregate.owedMinor, aggregate.currency)}</Text></View><View><Body muted>You owe</Body><Text style={[styles.total, { color: colors.negative }]}>{formatMoney(aggregate.owingMinor, aggregate.currency)}</Text></View></View><Body muted>As of {new Date(aggregate.asOf).toLocaleString()}</Body></Card>)}
        {state.error ? <Banner tone="warning" action={<Button variant="ghost" onPress={runRefresh}>Retry</Button>}>{state.error}</Banner> : null}
        {groupWarningCount ? <Banner tone="warning">{groupWarningCount} candidate {groupWarningCount === 1 ? 'repository was' : 'repositories were'} skipped because {groupWarningCount === 1 ? 'its' : 'their'} group data could not be validated.</Banner> : null}
        {waitingForInstallation ? <InstallationConnectionCard attempts={installationRecheck.attempts} maxAttempts={installationRecheck.maxAttempts} checking={installationRecheck.checking || state.isRefreshing} exhausted={installationRecheck.exhausted} onRecheck={recheckInstallation} onOpenInstallation={openInstallation} /> : null}
        {hasInstallation && !canCreateGroups ? <Banner action={<View style={styles.bannerActions}><Button accessibilityLabel="Recheck GitHub access" onPress={runRefresh}>Recheck</Button><Button variant="ghost" onPress={() => void Linking.openURL(githubInstallationUrl)}>Manage</Button></View>}>Installation found. It must cover all repositories so newly created groups remain accessible.</Banner> : null}
        {pendingCreation ? <Banner tone="warning" action={<Button onPress={() => void retryPendingCreation().catch(() => undefined)}>Finish setup</Button>}>Repository {pendingCreation.repository.name} still needs its group file.</Banner> : null}
        {!waitingForInstallation || invitationState.data.length ? <View testID="groups-create-action"><Button disabled={!canCreateGroups} onPress={() => router.push('/groups/new' as never)}>Create a group</Button></View> : null}
        {invitationState.data.length ? <View testID="groups-invitations-slot"><InvitationSection invitations={invitationState.data} stale={Boolean(invitationState.error)} mutations={invitationMutations} onAccept={(invitation) => void acceptInvitation(invitation.id).catch(() => undefined)} onDecline={setDeclineTarget} /></View> : null}
        {invitationState.status === 'loading' && !invitationState.data.length ? <View style={styles.invitationLoading}><ActivityIndicator color={colors.accent} size="small" /><Body muted>Checking group invitations…</Body></View> : null}
        {invitationState.error ? <Banner tone="warning" action={<View style={styles.bannerActions}><Button variant="ghost" onPress={runRefresh}>Retry invitations</Button><Button variant="ghost" onPress={() => void Linking.openURL(githubAuthorizationSettingsUrl)}>Manage GitHub access</Button></View>}>{invitationState.error}</Banner> : null}
        {invitationNotice ? <Banner tone="info">{invitationNotice}</Banner> : null}
        {invitationWarningCount ? <Banner tone="warning">{invitationWarningCount} GitHub {invitationWarningCount === 1 ? 'invitation was' : 'invitations were'} skipped because the details were invalid or outside BranchBalance group rules.</Banner> : null}
        {acceptedPendingDiscovery.map((pending) => <Banner key={pending.invitationId} tone="warning" action={<Button variant="ghost" onPress={runRefresh}>Retry</Button>}>{pending.provisionalName} was accepted on GitHub, but BranchBalance cannot load the group yet.</Banner>)}
        <Text testID="groups-active-heading" accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>Active groups</Text>
      </View>}
      ListEmptyComponent={state.status === 'loading' ? <EmptyState title="Finding groups…" body="Checking repositories available to your GitHub App installation." /> : waitingForInstallation ? null : <EmptyState title="No active groups yet" body={invitationState.data.length ? 'Accept an invitation above or create a group to start sharing expenses.' : 'Create a private GitHub-backed group to start sharing expenses.'} />}
    />
    <ConfirmDialog
      visible={declineTarget !== null}
      title={declineTarget ? `Decline “${declineTarget.provisionalName}”?` : 'Decline this invitation?'}
      message={declineTarget ? `This removes the GitHub repository invitation from ${declineTarget.repository.owner}. You will need a new invitation from the owner if you change your mind.` : ''}
      confirmLabel="Decline invitation"
      loading={declineTarget ? invitationMutations.get(declineTarget.id) === 'declining' : false}
      onCancel={() => setDeclineTarget(null)}
      onConfirm={confirmDecline}
    />
  </SafeAreaView>;
}

function InvitationSection({ invitations, stale, mutations, onAccept, onDecline }: { invitations: PendingGroupInvitation[]; stale: boolean; mutations: ReadonlyMap<number, 'accepting' | 'declining'>; onAccept(invitation: PendingGroupInvitation): void; onDecline(invitation: PendingGroupInvitation): void }) {
  const { colors } = useTheme();
  return <View style={styles.invitationSection}>
    <View style={styles.sectionHeading}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>Invited groups</Text>
      <Text accessibilityLabel={`${invitations.length} pending group ${invitations.length === 1 ? 'invitation' : 'invitations'}`} style={[styles.countPill, { color: colors.accentText, backgroundColor: colors.accent }]}>{invitations.length}</Text>
    </View>
    {stale ? <Body muted>Refresh these invitations before accepting or declining.</Body> : null}
    {invitations.map((invitation) => {
      const mutation = mutations.get(invitation.id);
      const busy = mutation !== undefined;
      return <Card key={invitation.id}>
        <Text style={[styles.groupName, { color: colors.text }]}>{invitation.provisionalName}</Text>
        <Body muted style={styles.wrapText}>GitHub repository invitation</Body>
        <View style={styles.invitationMetadata}>
          <Body style={styles.wrapText}>Repository: {invitation.repository.fullName}</Body>
          <Body style={styles.wrapText}>Invited by @{invitation.inviter}</Body>
          <Body style={styles.wrapText}>Requested access: {capitalize(invitation.permission)}</Body>
          <Body style={styles.wrapText}>Invited {new Date(invitation.createdAt).toLocaleDateString()}</Body>
        </View>
        <View style={styles.invitationActions}>
          <View style={styles.invitationAction}><Button accessibilityLabel={`Accept invitation to ${invitation.provisionalName}`} disabled={stale || busy} loading={mutation === 'accepting'} onPress={() => onAccept(invitation)}>Accept</Button></View>
          <View style={styles.invitationAction}><Button accessibilityLabel={`Decline invitation to ${invitation.provisionalName}`} variant="secondary" disabled={stale || busy} loading={mutation === 'declining'} onPress={() => onDecline(invitation)}>Decline</Button></View>
        </View>
      </Card>;
    })}
  </View>;
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
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

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { flexGrow: 1, padding: 20, gap: 13 }, header: { gap: 14 }, accountRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, inboxButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, unreadDot: { position: 'absolute', right: 8, top: 7, width: 8, height: 8, borderRadius: 4 }, bannerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, connectionCard: { borderLeftWidth: 4 }, connectionHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 }, connectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: '800' }, progressTrack: { height: 8, overflow: 'hidden', borderRadius: 999 }, progressFill: { height: '100%', borderRadius: 999 }, connectionAction: { flexGrow: 1, minWidth: 130 }, totals: { flexDirection: 'row', justifyContent: 'space-between' }, total: { fontSize: 22, fontWeight: '800' }, groupName: { fontSize: 19, fontWeight: '800' }, sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800' }, sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, countPill: { minWidth: 28, minHeight: 28, borderRadius: 14, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', paddingHorizontal: 8, fontWeight: '800' }, invitationSection: { gap: 12 }, invitationLoading: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }, invitationMetadata: { gap: 4 }, wrapText: { flexShrink: 1 }, invitationActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, invitationAction: { flexGrow: 1, minWidth: 130 } });
