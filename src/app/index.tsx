import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { githubClientId } from '@/config/app';
import { signInWithGitHub } from '@/services/github-auth';

export default function SignInScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(
    githubClientId ? 'Use your GitHub account to continue.' : 'Add your GitHub App client ID to .env.',
  );

  async function handleSignIn() {
    setLoading(true);
    setMessage('Waiting for GitHub authorization...');
    try {
      await signInWithGitHub((userCode) => {
        setMessage(`Enter code ${userCode} on the GitHub page.`);
      });
      router.replace('/groups');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sign in with GitHub.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.mark}>
          <Text style={styles.markText}>BB</Text>
        </View>
        <Text style={styles.title}>BranchBalance</Text>
        <Text style={styles.subtitle}>Shared expenses, backed by GitHub.</Text>
        <Pressable
          accessibilityRole="button"
          disabled={!githubClientId || loading}
          onPress={handleSignIn}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            (!githubClientId || loading) && styles.buttonDisabled,
          ]}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Sign in with GitHub</Text>
          )}
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f7f8fa' },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  mark: {
    alignItems: 'center',
    backgroundColor: '#1f6f50',
    borderRadius: 8,
    height: 52,
    justifyContent: 'center',
    marginBottom: 24,
    width: 52,
  },
  markText: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  title: { color: '#17201d', fontSize: 34, fontWeight: '800' },
  subtitle: { color: '#59635f', fontSize: 17, marginBottom: 36, marginTop: 8 },
  button: {
    alignItems: 'center',
    backgroundColor: '#24292f',
    borderRadius: 6,
    height: 52,
    justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { backgroundColor: '#3b4147' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  message: { color: '#68716e', fontSize: 14, lineHeight: 20, marginTop: 16, textAlign: 'center' },
});
