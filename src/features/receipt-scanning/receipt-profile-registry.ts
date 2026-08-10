import { receiptProfileFor } from '@/domain/groups';
import type { CurrencyCode, KnownGroupType, ReceiptProfileId } from '@/domain/types';

import { buildFuelReceiptExpensePrefill } from './parse-fuel-receipt';
import { buildReceiptExpensePrefill } from './parse-receipt';
import type { OcrResult, ReceiptExpensePrefill } from './receipt-types';

type ReceiptProfileDefinition = {
  id: ReceiptProfileId;
  label: string;
  scope: string;
  parse(result: OcrResult, currency: CurrencyCode, modelVersion: string, profileVersion: string): ReceiptExpensePrefill;
};

export const receiptProfileRegistry = {
  generic_v1: {
    id: 'generic_v1',
    label: 'Trip · Generic receipt',
    scope: 'Description, amount, date, and validated line items',
    parse: buildReceiptExpensePrefill,
  },
  fuel_v1: {
    id: 'fuel_v1',
    label: 'Fuel receipt',
    scope: 'Station, amount paid, date, litres, printed price, gross total, discount, and fuel type',
    parse: buildFuelReceiptExpensePrefill,
  },
} as const satisfies Record<ReceiptProfileId, ReceiptProfileDefinition>;

export function receiptProfileDefinitionFor(groupType: KnownGroupType): ReceiptProfileDefinition {
  return receiptProfileRegistry[receiptProfileFor(groupType)];
}
