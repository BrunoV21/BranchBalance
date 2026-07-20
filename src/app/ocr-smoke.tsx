import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { receiptOcr } from '@/features/receipt-scanning/receipt-ocr';

const smokeImage = 'file:///data/user/0/com.branchbalance.app.dev/cache/ocr-smoke.jpg';

export default function OcrSmokeScreen() {
  const [result, setResult] = useState('checking');
  useEffect(() => {
    void receiptOcr.getStatus().then(async (status) => {
      if (status.state !== 'ready') { setResult(`${status.state}: ${status.safeMessage}`); return; }
      const output = await receiptOcr.recognize('physical-smoke-test', smokeImage);
      setResult(`ready ${status.modelBundleVersion}\n${output.blocks.map((block) => `${block.text} (${block.confidence.toFixed(2)})`).join('\n')}`);
    }).catch((error) => setResult(error instanceof Error ? error.message : 'failed'));
  }, []);
  return <View style={{ flex: 1, padding: 30, justifyContent: 'center' }}><Text accessibilityLabel="OCR smoke result" selectable style={{ fontSize: 18 }}>{result}</Text></View>;
}
