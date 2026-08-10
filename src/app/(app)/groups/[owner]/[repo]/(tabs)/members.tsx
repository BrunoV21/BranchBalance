import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar, Banner, Body, Button, Card, Field, Screen, Title } from '@/components/ui';
import { effectiveGroupType } from '@/domain/groups';
import { normalizeLogin } from '@/domain/types';
import { useGroupRefresh } from '@/features/groups/use-group-refresh';
import { groupContextLabel } from '@/features/groups/group-type-ui';
import { useGroup } from '@/providers/group-provider';
import { useTheme } from '@/providers/theme-provider';

export default function MembersScreen() {
  useGroupRefresh();
  const { state, invite } = useGroup();
  const { colors } = useTheme();
  const [login, setLogin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invitationNotice, setInvitationNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const snapshot = state.data;
  const submit = async () => {
    if (!snapshot) { setError('Refresh the group before inviting a member.'); return; }
    const invitedLogin = normalizeLogin(login);
    setLoading(true); setError(null); setInvitationNotice(null);
    try {
      await invite(invitedLogin);
      setLogin('');
      setInvitationNotice(`Invitation sent to @${invitedLogin}. Ask them to go to github.com and accept the invitation to collaborate on ${snapshot.repository.name}. After accepting, they should open BranchBalance and refresh Your groups.`);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to invite this user.'); }
    finally { setLoading(false); }
  };
  return <Screen>
    <Title eyebrow={snapshot ? groupContextLabel(effectiveGroupType(snapshot.group), snapshot.group.name) : 'BranchBalance'}>Members</Title>
    {invitationNotice ? <Banner tone="info">{invitationNotice}</Banner> : null}
    {snapshot?.repository.canAdmin ? <Card><Body>Invite a GitHub user</Body><Field label="GitHub username" autoCapitalize="none" autoCorrect={false} value={login} onChangeText={setLogin} placeholder="e.g. octocat" error={error ?? undefined} /><Button loading={loading} onPress={() => void submit()}>Invite</Button><Body muted>They accept the private repository invitation through GitHub. GitHub may not show it inside BranchBalance before acceptance.</Body></Card> : <Banner>Only the personal repository owner can send invitations.</Banner>}
    <Body>{snapshot?.members.length ?? 0} active members</Body>
    {snapshot?.members.map((member) => <Card key={member.login}><View style={styles.row}><Avatar login={member.login} uri={member.avatarUrl} /><View style={{ flex: 1 }}><Text style={[styles.name, { color: colors.text }]}>{member.name ?? `@${member.login}`}</Text><Body muted>@{member.login} · {member.role === 'owner' ? 'repository owner' : 'collaborator'}</Body></View></View></Card>)}
    {snapshot?.pendingMembers === null ? <Banner>Pending invitations are unavailable to this account.</Banner> : snapshot?.pendingMembers.length ? <><Body>Pending invitations</Body>{snapshot.pendingMembers.map((member) => <Card key={member.login}><View style={styles.row}><Avatar login={member.login} uri={member.avatarUrl} /><View><Text style={[styles.name, { color: colors.text }]}>@{member.login}</Text><Body muted>Pending acceptance on GitHub</Body></View></View></Card>)}</> : null}
  </Screen>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, name: { fontSize: 16, fontWeight: '800' } });
