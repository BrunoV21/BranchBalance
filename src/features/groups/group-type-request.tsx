import { useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { ExternalLink, Lightbulb } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner, Button } from '@/components/ui';
import { githubGroupTypeRequestUrl } from '@/config/app';
import { useTheme } from '@/providers/theme-provider';

const requestAccessibilityLabel = 'Request another group type on GitHub. Opens a public GitHub issue form in your browser.';

export function GroupTypeRequestAction() {
  const { colors } = useTheme();
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const openRequest = async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setOpenFailed(false);
    setCopyFeedback(null);
    try {
      await Linking.openURL(githubGroupTypeRequestUrl);
    } catch {
      setOpenFailed(true);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };

  const copyRequestUrl = async () => {
    try {
      await Clipboard.setStringAsync(githubGroupTypeRequestUrl);
      setCopyFeedback('GitHub request link copied.');
    } catch {
      setCopyFeedback('Unable to copy the link. Select the URL below to copy it manually.');
    }
  };

  return <View style={styles.container}>
    <Pressable
      accessibilityHint="Leaves BranchBalance without changing this group form."
      accessibilityLabel={requestAccessibilityLabel}
      accessibilityRole="link"
      accessibilityState={{ busy: opening, disabled: opening }}
      disabled={opening}
      onPress={() => void openRequest()}
      style={({ pressed }) => [
        styles.action,
        {
          backgroundColor: colors.surface,
          borderColor: colors.accent,
          opacity: opening ? 0.6 : pressed ? 0.76 : 1,
        },
      ]}
    >
      <View style={[styles.iconShell, { backgroundColor: colors.surfaceStrong }]}>
        <Lightbulb color={colors.accent} size={22} strokeWidth={2} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>Request another group type</Text>
        <Text style={[styles.description, { color: colors.muted }]}>Tell us what you want to track. Opens a public GitHub issue form.</Text>
      </View>
      <ExternalLink color={colors.muted} size={19} strokeWidth={2} />
    </Pressable>

    {openFailed ? <View style={styles.recovery}>
      <Banner
        tone="error"
        action={<View style={styles.recoveryActions}>
          <Button variant="secondary" onPress={() => void openRequest()}>Try again</Button>
          <Button variant="ghost" onPress={() => void copyRequestUrl()}>Copy link</Button>
        </View>}
      >We couldn&apos;t open GitHub. Your Create group details are unchanged.</Banner>
      <Text selectable style={[styles.url, { color: colors.muted }]}>{githubGroupTypeRequestUrl}</Text>
      {copyFeedback ? <Text accessibilityLiveRegion="polite" style={[styles.feedback, { color: colors.text }]}>{copyFeedback}</Text> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  action: { minHeight: 76, padding: 14, borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconShell: { width: 40, height: 40, flexShrink: 0, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  description: { fontSize: 13, lineHeight: 18 },
  recovery: { gap: 8 },
  recoveryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  url: { paddingHorizontal: 4, fontSize: 12, lineHeight: 17 },
  feedback: { paddingHorizontal: 4, fontSize: 13, lineHeight: 18 },
});
