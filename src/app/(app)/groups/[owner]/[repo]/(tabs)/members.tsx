import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar, Banner, Body, Button, Card, Field, Screen, Title } from '@/components/ui';
import { useGroupRefresh } from '@/features/groups/use-group-refresh';
import { useGroup } from '@/providers/group-provider';
import { useTheme } from '@/providers/theme-provider';

export default function MembersScreen() {
  useGroupRefresh();
  const { state, invite } = useGroup();
  const { colors } = useTheme();
  const [login, setLogin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const snapshot = state.data;
  const submit = async () => {
    setLoading(true); setError(null);
    try { await invite(login); setLogin(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to invite this user.'); }
    finally { setLoading(false); }
  };
  return <Screen>
    <Title eyebrow={snapshot?.group.name ?? 'BranchBalance'}>Members</Title>
    {snapshot?.repository.canAdmin ? <Card><Body>Invite a GitHub user</Body><Field label="GitHub username" autoCapitalize="none" autoCorrect={false} value={login} onChangeText={setLogin} placeholder="e.g. octocat" error={error ?? undefined} /><Button loading={loading} onPress={() => void submit()}>Invite</Button><Body muted>They accept the private repository invitation through GitHub.</Body></Card> : <Banner>Only the personal repository owner can send invitations.</Banner>}
    <Body>{snapshot?.members.length ?? 0} active members</Body>
    {snapshot?.members.map((member) => <Card key={member.login}><View style={styles.row}><Avatar login={member.login} uri={member.avatarUrl} /><View style={{ flex: 1 }}><Text style={[styles.name, { color: colors.text }]}>{member.name ?? `@${member.login}`}</Text><Body muted>@{member.login} · {member.role === 'owner' ? 'repository owner' : 'collaborator'}</Body></View></View></Card>)}
    {snapshot?.pendingMembers === null ? <Banner>Pending invitations are unavailable to this account.</Banner> : snapshot?.pendingMembers.length ? <><Body>Pending invitations</Body>{snapshot.pendingMembers.map((member) => <Card key={member.login}><View style={styles.row}><Avatar login={member.login} uri={member.avatarUrl} /><View><Text style={[styles.name, { color: colors.text }]}>@{member.login}</Text><Body muted>Pending acceptance on GitHub</Body></View></View></Card>)}</> : null}
  </Screen>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, name: { fontSize: 16, fontWeight: '800' } });
