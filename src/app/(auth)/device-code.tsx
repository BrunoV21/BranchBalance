import { useEffect, useRef } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { Banner, Body, Button, Card, Screen, Title } from '@/components/ui';
import { useSession } from '@/providers/session-provider';

export default function DeviceCodeScreen() {
  const router = useRouter();
  const { flow, beginSignIn, retrySignIn, cancelSignIn } = useSession();
  const openedCode = useRef<string | null>(null);
  useEffect(() => { if (flow.status === 'idle') void beginSignIn(); }, [beginSignIn, flow.status]);
  useEffect(() => {
    if (flow.status === 'awaiting_authorization' && openedCode.current !== flow.userCode) {
      openedCode.current = flow.userCode;
      void WebBrowser.openBrowserAsync(flow.verificationUri);
    }
  }, [flow]);
  const code = flow.status === 'awaiting_authorization' || (flow.status === 'error' && flow.userCode && flow.verificationUri && flow.expiresAt) ? flow : null;
  return <Screen>
    <Title eyebrow="GitHub device authorization">Connect your account</Title>
    <Body muted>Open GitHub in your browser and enter this one-time code. Closing the browser will not cancel authorization.</Body>
    {code ? <Card style={{ alignItems: 'center' }}>
      <Body muted>Your device code</Body>
      <Body style={{ fontSize: 28, letterSpacing: 4 }}>{code.userCode}</Body>
      <Button variant="secondary" onPress={() => void Clipboard.setStringAsync(code.userCode!)}>Copy code</Button>
      <Button onPress={() => void WebBrowser.openBrowserAsync(code.verificationUri!)}>Open GitHub</Button>
      <Body muted>Expires at {new Date(code.expiresAt!).toLocaleTimeString()}</Body>
    </Card> : null}
    {flow.status === 'requesting_code' || flow.status === 'exchanging' ? <Card><Body>{flow.status === 'requesting_code' ? 'Requesting a code…' : 'Checking authorization…'}</Body></Card> : null}
    {flow.status === 'authorized' ? <Card><Body>Authorization complete. Loading your GitHub profile…</Body></Card> : null}
    {flow.status === 'error' ? <Banner tone="error">{flow.safeMessage}</Banner> : null}
    {flow.status === 'denied' ? <Banner tone="error">GitHub authorization was denied.</Banner> : null}
    {flow.status === 'expired' ? <Banner tone="warning">This device code expired.</Banner> : null}
    {flow.status === 'error' && flow.retryable ? <Button onPress={() => void retrySignIn()}>Retry authorization</Button> : null}
    {flow.status === 'denied' || flow.status === 'expired' ? <Button onPress={() => void beginSignIn()}>Request a new code</Button> : null}
    <Button variant="ghost" onPress={() => { cancelSignIn(); router.replace('/sign-in' as never); }}>Cancel</Button>
  </Screen>;
}
