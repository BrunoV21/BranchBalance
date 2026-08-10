import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { ReceiptDraftProvider, useReceiptDraft } from './receipt-draft-provider';

function Probe() {
  const drafts = useReceiptDraft();
  const [result, setResult] = useState('not-read');
  return <><Text>{result}</Text><Pressable accessibilityRole="button" accessibilityLabel="Set" onPress={() => drafts.setReceiptDraft({ profile: 'generic_v1', profileVersion: 'test-profile', description: 'Cafe', confidence: {}, warnings: [], modelBundleVersion: 'test' })} /><Pressable accessibilityRole="button" accessibilityLabel="Consume" onPress={() => setResult(drafts.consumeReceiptDraft()?.description ?? 'empty')} /></>;
}

function GuardedProbe() {
  const drafts = useReceiptDraft();
  const [result, setResult] = useState('not-read');
  return <><Text>{result}</Text><Pressable accessibilityRole="button" accessibilityLabel="Set mismatched" onPress={() => drafts.setReceiptDraft({ profile: 'generic_v1', profileVersion: 'generic', description: 'Cafe', confidence: {}, warnings: [], modelBundleVersion: 'test' }, { accountId: 7, groupKey: 'alice/car', groupType: 'fuel', attemptId: 'attempt' })} /><Pressable accessibilityRole="button" accessibilityLabel="Read Fuel" onPress={() => setResult(drafts.consumeReceiptDraft({ accountId: 7, groupKey: 'alice/car', groupType: 'fuel' })?.description ?? 'empty')} /></>;
}

describe('ReceiptDraftProvider', () => {
  it('keeps a draft in memory and consumes it only once', async () => {
    const view = await render(<ReceiptDraftProvider><Probe /></ReceiptDraftProvider>);
    await fireEvent.press(view.getByRole('button', { name: 'Set' }));
    await fireEvent.press(view.getByRole('button', { name: 'Consume' }));
    expect(view.getByText('Cafe')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Consume' }));
    expect(view.getByText('empty')).toBeTruthy();
  });

  it('rejects a draft whose profile does not match the validated group type', async () => {
    const view = await render(<ReceiptDraftProvider groupKey="alice/car"><GuardedProbe /></ReceiptDraftProvider>);
    await fireEvent.press(view.getByRole('button', { name: 'Set mismatched' }));
    await fireEvent.press(view.getByRole('button', { name: 'Read Fuel' }));
    expect(view.getByText('empty')).toBeTruthy();
  });
});
