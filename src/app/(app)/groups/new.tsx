import { useMemo, useState } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Banner, Body, Button, Card, Field, Screen, Title } from '@/components/ui';
import { githubInstallationUrl } from '@/config/app';
import { currencies } from '@/domain/money';
import { createRepositoryName } from '@/domain/slug';
import type { CurrencyCode } from '@/domain/types';
import { useGroups } from '@/providers/groups-provider';
import { useTheme } from '@/providers/theme-provider';

export default function NewGroupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { canCreateGroups, createGroup, refresh } = useGroups();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('EUR');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const repository = useMemo(() => { try { return createRepositoryName(name); } catch { return 'branch-balance-…'; } }, [name]);
  const submit = async () => {
    setLoading(true); setError(null);
    try {
      const group = await createGroup(name, currency);
      router.replace({ pathname: '/groups/[owner]/[repo]', params: { owner: group.repository.owner, repo: group.repository.name } } as never);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create the group.'); }
    finally { setLoading(false); }
  };
  return <Screen>
    <Title eyebrow="Private GitHub repository">Create a group</Title>
    {!canCreateGroups ? <Banner action={<Button variant="secondary" onPress={() => void Linking.openURL(githubInstallationUrl)}>Install app</Button>}>BranchBalance needs a personal installation covering all repositories. After installing, recheck access.</Banner> : null}
    {!canCreateGroups ? <Button variant="secondary" onPress={() => void refresh().catch(() => undefined)}>Recheck installation</Button> : null}
    <Field label="Group name" value={name} onChangeText={setName} placeholder="e.g. Weekend in Porto" />
    <Card><Body muted>Private repository</Body><Body>{repository}</Body></Card>
    <Body>Currency</Body>
    <View style={{ flexDirection: 'row', gap: 8 }}>{(Object.keys(currencies) as CurrencyCode[]).map((code) => <Pressable key={code} accessibilityRole="radio" accessibilityState={{ selected: currency === code }} onPress={() => setCurrency(code)} style={{ flex: 1, minHeight: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: currency === code ? colors.accent : colors.surface, borderColor: colors.border, borderWidth: 1 }}><Text style={{ color: currency === code ? colors.accentText : colors.text, fontWeight: '800' }}>{code}</Text></Pressable>)}</View>
    <Body muted>The currency cannot be changed after creation in Phase 1.</Body>
    {error ? <Banner tone="error">{error}</Banner> : null}
    <Button disabled={!canCreateGroups} loading={loading} onPress={() => void submit()}>Create private group</Button>
  </Screen>;
}
