import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { ReceiptDraftProvider, useReceiptDraft } from './receipt-draft-provider';

function Probe() {
  const drafts = useReceiptDraft();
  const [result, setResult] = useState('not-read');
  return <><Text>{result}</Text><Pressable accessibilityRole="button" accessibilityLabel="Set" onPress={() => drafts.setReceiptDraft({ description: 'Cafe', confidence: {}, warnings: [], modelBundleVersion: 'test' })} /><Pressable accessibilityRole="button" accessibilityLabel="Consume" onPress={() => setResult(drafts.consumeReceiptDraft()?.description ?? 'empty')} /></>;
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
});
