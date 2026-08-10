import { createContext, type PropsWithChildren, useCallback, useContext, useMemo, useRef } from 'react';

import { receiptProfileFor } from '@/domain/groups';
import type { GroupKey, KnownGroupType } from '@/domain/types';
import { TypedReceiptReviewDraftSchema } from './receipt-types';
import type { ReceiptExpensePrefill } from './receipt-types';

type ReceiptDraftIdentity = { accountId: number; groupKey: GroupKey; groupType: KnownGroupType; attemptId: string };
type StoredReceiptDraft = { draft: ReceiptExpensePrefill; identity: ReceiptDraftIdentity };
type ReceiptDraftContextValue = {
  setReceiptDraft(draft: ReceiptExpensePrefill, identity?: ReceiptDraftIdentity): void;
  consumeReceiptDraft(expected?: Omit<ReceiptDraftIdentity, 'attemptId'>): ReceiptExpensePrefill | null;
  clearReceiptDraft(): void;
};

const ReceiptDraftContext = createContext<ReceiptDraftContextValue | null>(null);

export function ReceiptDraftProvider({ children, groupKey }: PropsWithChildren<{ groupKey?: GroupKey }>) {
  const draftRef = useRef<StoredReceiptDraft | null>(null);
  const setReceiptDraft = useCallback((value: ReceiptExpensePrefill, identity?: ReceiptDraftIdentity) => {
    const parsed = TypedReceiptReviewDraftSchema.safeParse(value);
    if (!parsed.success) return;
    const safeIdentity = identity ?? { accountId: -1, groupKey: groupKey ?? 'test/test', groupType: parsed.data.profile === 'fuel_v1' ? 'fuel' : 'trip', attemptId: 'legacy-test' };
    if (parsed.data.profile !== receiptProfileFor(safeIdentity.groupType)) return;
    draftRef.current = { draft: parsed.data, identity: safeIdentity };
  }, [groupKey]);
  const consumeReceiptDraft = useCallback((expected?: Omit<ReceiptDraftIdentity, 'attemptId'>) => {
    const stored = draftRef.current;
    draftRef.current = null;
    if (!stored) return null;
    if (expected && (stored.identity.accountId !== expected.accountId || stored.identity.groupKey.toLowerCase() !== expected.groupKey.toLowerCase() || stored.identity.groupType !== expected.groupType)) return null;
    if (stored.draft.profile !== receiptProfileFor(stored.identity.groupType)) return null;
    return stored.draft;
  }, []);
  const clearReceiptDraft = useCallback(() => { draftRef.current = null; }, []);
  const value = useMemo(() => ({ setReceiptDraft, consumeReceiptDraft, clearReceiptDraft }), [clearReceiptDraft, consumeReceiptDraft, setReceiptDraft]);
  return <ReceiptDraftContext.Provider value={value}>{children}</ReceiptDraftContext.Provider>;
}

export function useReceiptDraft() {
  const value = useContext(ReceiptDraftContext);
  if (!value) throw new Error('useReceiptDraft must be used inside ReceiptDraftProvider.');
  return value;
}
