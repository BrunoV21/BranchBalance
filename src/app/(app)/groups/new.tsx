import { useMemo, useState } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Banner, Body, Button, Card, ConfirmDialog, Field, Screen, Title } from '@/components/ui';
import { githubInstallationUrl } from '@/config/app';
import { currencies } from '@/domain/money';
import { createRepositoryName } from '@/domain/slug';
import { groupTypeDefinition } from '@/domain/groups';
import type { CurrencyCode, KnownGroupType } from '@/domain/types';
import { GroupTypeIcon } from '@/features/groups/group-type-ui';
import { GroupTypeRequestAction } from '@/features/groups/group-type-request';
import { useGroups } from '@/providers/groups-provider';
import { useTheme } from '@/providers/theme-provider';

export default function NewGroupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { canCreateGroups, createGroup, refresh } = useGroups();
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('EUR');
  const [groupType, setGroupType] = useState<KnownGroupType>('trip');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const repository = useMemo(() => { try { return createRepositoryName(name); } catch { return 'branch-balance-…'; } }, [name]);
  const submit = async () => {
    setLoading(true); setError(null);
    try {
      const group = await createGroup(name, currency, groupType);
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
    <Body muted>Choose carefully—you won’t be able to change the currency later.</Body>
    <Body>Group type</Body>
    <View accessibilityRole="radiogroup" style={{ gap: 10 }}>{(['trip', 'fuel'] as const).map((type) => {
      const definition = groupTypeDefinition[type];
      const selected = groupType === type;
      return <Pressable key={type} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${definition.label}. ${definition.description}`} onPress={() => setGroupType(type)}>
        <Card style={{ borderColor: selected ? colors.accent : colors.border, borderWidth: selected ? 2 : 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><GroupTypeIcon type={type} size={25} /><View style={{ flex: 1 }}><Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }}>{definition.label}</Text><Body muted>{definition.description}</Body></View><Text style={{ color: selected ? colors.accent : colors.muted, fontWeight: '800' }}>{selected ? 'Selected' : 'Select'}</Text></View>
        </Card>
      </Pressable>;
    })}</View>
    <GroupTypeRequestAction />
    <Body muted>Group type and currency are permanent. Trip is the default for holiday and shared-trip expenses.</Body>
    {error ? <Banner tone="error">{error}</Banner> : null}
    <Button disabled={!canCreateGroups || !name.trim()} loading={loading} onPress={() => setConfirming(true)}>Create {groupTypeDefinition[groupType].label} group</Button>
    <ConfirmDialog visible={confirming} title={`Create this ${groupTypeDefinition[groupType].label} group?`} message={`${name.trim() || 'This group'} will be a permanent ${groupTypeDefinition[groupType].label} group using ${currency}. A private GitHub repository will be created.`} confirmLabel={`Create ${groupTypeDefinition[groupType].label} group`} loading={loading} onCancel={() => setConfirming(false)} onConfirm={() => void submit().finally(() => setConfirming(false))} />
  </Screen>;
}
