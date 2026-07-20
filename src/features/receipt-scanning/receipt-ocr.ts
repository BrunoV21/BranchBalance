import { requireOptionalNativeModule } from 'expo-modules-core';

import { OcrResultSchema, RECEIPT_MODEL_BUNDLE_VERSION, ReceiptOcrStatusSchema, type OcrResult, type ReceiptOcrErrorCode, type ReceiptOcrStatus } from './receipt-types';

type NativePaddleOcrModule = {
  getStatus(): Promise<unknown>;
  recognize(options: { requestId: string; imageUri: string }): Promise<unknown>;
  cancel(requestId: string): Promise<void>;
};

const nativeModule = requireOptionalNativeModule<NativePaddleOcrModule>('BranchBalancePaddleOCR');

export class ReceiptOcrError extends Error {
  constructor(readonly code: ReceiptOcrErrorCode, message: string) {
    super(message);
    this.name = 'ReceiptOcrError';
  }
}

function normalizeNativeError(error: unknown): ReceiptOcrError {
  if (error instanceof ReceiptOcrError) return error;
  const raw = error as { code?: unknown; message?: unknown };
  const nativeCode = typeof raw?.code === 'string' ? raw.code.replace(/^ERR_/, '').toLowerCase() : '';
  const supported: ReceiptOcrErrorCode[] = ['module_unavailable', 'models_missing', 'models_incompatible', 'image_unreadable', 'out_of_memory', 'inference_failed', 'cancelled', 'invalid_output'];
  const code = supported.includes(nativeCode as ReceiptOcrErrorCode) ? nativeCode as ReceiptOcrErrorCode : 'inference_failed';
  const messages: Record<ReceiptOcrErrorCode, string> = {
    ready: 'Receipt scanning is ready.',
    module_unavailable: 'Receipt scanning requires the BranchBalance development build.',
    models_missing: 'The local OCR models are missing from this build.',
    models_incompatible: 'The local OCR models are incompatible with this build.',
    image_unreadable: 'This image could not be read. Try another photo.',
    out_of_memory: 'The receipt was too large to read on this device. Try a closer photo.',
    inference_failed: 'The receipt could not be read on this device. Try again or enter it manually.',
    cancelled: 'Receipt reading was cancelled.',
    invalid_output: 'The receipt reader returned an invalid result. Try another photo.',
  };
  return new ReceiptOcrError(code, messages[code]);
}

export const receiptOcr = {
  async getStatus(): Promise<ReceiptOcrStatus> {
    if (!nativeModule) return { state: 'module_unavailable', engine: 'paddle_ocr', modelBundleVersion: null, safeMessage: 'Receipt scanning requires the BranchBalance development build.' };
    try {
      const parsed = ReceiptOcrStatusSchema.safeParse(await nativeModule.getStatus());
      if (!parsed.success) throw new ReceiptOcrError('models_incompatible', 'The receipt reader reported an invalid runtime status.');
      const status = parsed.data;
      if (status.state === 'ready' && status.modelBundleVersion !== RECEIPT_MODEL_BUNDLE_VERSION) {
        return { ...status, state: 'models_incompatible', safeMessage: 'The local OCR model bundle does not match this app build.' };
      }
      return status;
    } catch (error) {
      throw normalizeNativeError(error);
    }
  },

  async recognize(requestId: string, imageUri: string): Promise<OcrResult> {
    if (!nativeModule) throw new ReceiptOcrError('module_unavailable', 'Receipt scanning requires the BranchBalance development build.');
    try {
      const raw = await nativeModule.recognize({ requestId, imageUri });
      const parsed = OcrResultSchema.safeParse(raw);
      if (!parsed.success) throw new ReceiptOcrError('invalid_output', 'The receipt reader returned an invalid result. Try another photo.');
      return parsed.data;
    } catch (error) {
      throw normalizeNativeError(error);
    }
  },

  async cancel(requestId: string): Promise<void> {
    if (!nativeModule) return;
    await nativeModule.cancel(requestId).catch(() => undefined);
  },
};
