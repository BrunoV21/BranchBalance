import { z } from 'zod';

import type { CalendarDate, CurrencyCode, FuelType, ReceiptProfileId } from '@/domain/types';

export const RECEIPT_MODEL_BUNDLE_VERSION = 'ppocr-v5-mobile-latin-2026-07-20';

export const OcrPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
}).strict();

export const OcrBlockSchema = z.object({
  text: z.string().max(256),
  confidence: z.number().finite().min(0).max(1),
  points: z.tuple([OcrPointSchema, OcrPointSchema, OcrPointSchema, OcrPointSchema]),
}).strict().superRefine((block, context) => {
  if (!block.text.trim()) context.addIssue({ code: 'custom', message: 'OCR block text is blank.' });
  const doubledArea = Math.abs(block.points.reduce((sum, point, index) => {
    const next = block.points[(index + 1) % block.points.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0));
  if (doubledArea < 2) context.addIssue({ code: 'custom', message: 'OCR block quadrilateral is invalid.' });
});

export const OcrResultSchema = z.object({
  width: z.number().int().min(1).max(2048),
  height: z.number().int().min(1).max(2048),
  blocks: z.array(OcrBlockSchema).max(512),
}).strict().superRefine((result, context) => {
  const totalCharacters = result.blocks.reduce((sum, block) => sum + block.text.length, 0);
  if (totalCharacters > 32_768) context.addIssue({ code: 'custom', message: 'OCR output contains too much text.' });
  for (const [blockIndex, block] of result.blocks.entries()) {
    for (const point of block.points) {
      if (point.x < -2 || point.x > result.width + 2 || point.y < -2 || point.y > result.height + 2) {
        context.addIssue({ code: 'custom', message: `OCR block ${blockIndex} has out-of-bounds coordinates.` });
        break;
      }
    }
  }
});

export type OcrPoint = z.infer<typeof OcrPointSchema>;
export type OcrBlock = z.infer<typeof OcrBlockSchema>;
export type OcrResult = z.infer<typeof OcrResultSchema>;

export type ReceiptOcrStatusState = 'ready' | 'module_unavailable' | 'models_missing' | 'models_incompatible';

export interface ReceiptOcrStatus {
  state: ReceiptOcrStatusState;
  engine: 'paddle_ocr';
  profile: ReceiptProfileId;
  profileVersion: string | null;
  modelBundleVersion: string | null;
  safeMessage: string;
}

export const ReceiptOcrStatusSchema = z.object({
  state: z.enum(['ready', 'module_unavailable', 'models_missing', 'models_incompatible']),
  engine: z.literal('paddle_ocr'),
  profile: z.enum(['generic_v1', 'fuel_v1']),
  profileVersion: z.string().max(120).nullable(),
  modelBundleVersion: z.string().max(120).nullable(),
  safeMessage: z.string().min(1).max(240),
}).strict().superRefine((status, context) => {
  if (status.state === 'ready' && (!status.modelBundleVersion || !status.profileVersion)) context.addIssue({ code: 'custom', message: 'A ready OCR runtime must report its model bundle and profile.' });
});

export type ReceiptOcrErrorCode = ReceiptOcrStatusState | 'image_unreadable' | 'out_of_memory' | 'inference_failed' | 'cancelled' | 'invalid_output';

export interface ReceiptDraft {
  merchant?: string;
  date?: CalendarDate;
  currency?: CurrencyCode;
  subtotalMinor?: number;
  taxMinor?: number;
  tipMinor?: number;
  totalMinor?: number;
  lineItems?: ReceiptLineItemCandidate[];
  confidence: {
    merchant?: number;
    date?: number;
    total?: number;
  };
  warnings: string[];
}

export interface ReceiptLineItemCandidate {
  description: string;
  quantity?: string;
  unitPriceMinor?: number;
  lineTotalMinor: number;
  confidence: number;
}

export const ReceiptDraftSchema = z.object({
  merchant: z.string().min(1).max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.enum(['EUR', 'USD', 'GBP']).optional(),
  subtotalMinor: z.number().int().positive().safe().optional(),
  taxMinor: z.number().int().nonnegative().safe().optional(),
  tipMinor: z.number().int().nonnegative().safe().optional(),
  totalMinor: z.number().int().positive().safe().optional(),
  lineItems: z.array(z.object({
    description: z.string().min(1).max(120),
    quantity: z.string().regex(/^\d+(?:\.\d+)?$/).optional(),
    unitPriceMinor: z.number().int().nonnegative().safe().optional(),
    lineTotalMinor: z.number().int().nonnegative().safe(),
    confidence: z.number().finite().min(0).max(1),
  }).strict()).min(1).max(80).optional(),
  confidence: z.object({ merchant: z.number().finite().min(0).max(1).optional(), date: z.number().finite().min(0).max(1).optional(), total: z.number().finite().min(0).max(1).optional() }).strict(),
  warnings: z.array(z.string().min(1).max(240)).max(12),
}).strict();

export interface GenericReceiptReviewDraft {
  profile: 'generic_v1';
  profileVersion: string;
  description?: string;
  amount?: string;
  expenseDate?: CalendarDate;
  lineItems?: { description: string; quantity: string; unitPrice: string; lineTotal: string }[];
  detectedCurrency?: CurrencyCode;
  confidence: ReceiptDraft['confidence'];
  warnings: string[];
  modelBundleVersion: string;
}

export interface FuelReceiptReviewDraft {
  profile: 'fuel_v1';
  profileVersion: string;
  description?: string;
  amount?: string;
  expenseDate?: CalendarDate;
  receiptDateTime?: string;
  litres?: string;
  unitPrice?: string;
  gross?: string;
  discount?: string;
  fuelType?: FuelType;
  detectedCurrency?: CurrencyCode;
  confidence: {
    merchant?: number;
    date?: number;
    total?: number;
    litres?: number;
    unitPrice?: number;
    gross?: number;
    discount?: number;
  };
  warnings: string[];
  modelBundleVersion: string;
}

export type ReceiptExpensePrefill = GenericReceiptReviewDraft | FuelReceiptReviewDraft;

export const GenericReceiptReviewDraftSchema = z.object({
  profile: z.literal('generic_v1'),
  profileVersion: z.string().min(1).max(120),
  description: z.string().min(1).max(120).optional(), amount: z.string().min(1).max(32).optional(),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lineItems: z.array(z.object({ description: z.string().min(1).max(120), quantity: z.string().max(24), unitPrice: z.string().max(32), lineTotal: z.string().max(32) }).strict()).min(1).max(80).optional(),
  detectedCurrency: z.enum(['EUR', 'USD', 'GBP']).optional(),
  confidence: ReceiptDraftSchema.shape.confidence,
  warnings: z.array(z.string().min(1).max(240)).max(20),
  modelBundleVersion: z.string().min(1).max(120),
}).strict();

export const FuelReceiptReviewDraftSchema = z.object({
  profile: z.literal('fuel_v1'), profileVersion: z.string().min(1).max(120),
  description: z.string().min(1).max(120).optional(), amount: z.string().min(1).max(32).optional(), expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), receiptDateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  litres: z.string().min(1).max(32).optional(), unitPrice: z.string().min(1).max(32).optional(), gross: z.string().min(1).max(32).optional(), discount: z.string().min(1).max(32).optional(),
  fuelType: z.enum(['petrol', 'diesel', 'lpg', 'other']).optional(), detectedCurrency: z.enum(['EUR', 'USD', 'GBP']).optional(),
  confidence: z.object({ merchant: z.number().min(0).max(1).optional(), date: z.number().min(0).max(1).optional(), total: z.number().min(0).max(1).optional(), litres: z.number().min(0).max(1).optional(), unitPrice: z.number().min(0).max(1).optional(), gross: z.number().min(0).max(1).optional(), discount: z.number().min(0).max(1).optional() }).strict(),
  warnings: z.array(z.string().min(1).max(240)).max(20), modelBundleVersion: z.string().min(1).max(120),
}).strict();

export const TypedReceiptReviewDraftSchema = z.discriminatedUnion('profile', [GenericReceiptReviewDraftSchema, FuelReceiptReviewDraftSchema]);

export interface PreparedReceiptImage {
  uri: string;
  width: number;
  height: number;
}

export interface CapturedReceiptImage extends PreparedReceiptImage {
  ownership: 'app_cache' | 'external_original';
}
