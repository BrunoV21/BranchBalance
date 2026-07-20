import { createContext, type PropsWithChildren, useCallback, useContext, useMemo, useRef } from 'react';

import type { ReceiptExpensePrefill } from './receipt-types';

type ReceiptDraftContextValue = {
  setReceiptDraft(draft: ReceiptExpensePrefill): void;
  consumeReceiptDraft(): ReceiptExpensePrefill | null;
  clearReceiptDraft(): void;
};

const ReceiptDraftContext = createContext<ReceiptDraftContextValue | null>(null);

export function ReceiptDraftProvider({ children }: PropsWithChildren) {
  const draftRef = useRef<ReceiptExpensePrefill | null>(null);
  const setReceiptDraft = useCallback((draft: ReceiptExpensePrefill) => { draftRef.current = draft; }, []);
  const consumeReceiptDraft = useCallback(() => { const draft = draftRef.current; draftRef.current = null; return draft; }, []);
  const clearReceiptDraft = useCallback(() => { draftRef.current = null; }, []);
  const value = useMemo(() => ({ setReceiptDraft, consumeReceiptDraft, clearReceiptDraft }), [clearReceiptDraft, consumeReceiptDraft, setReceiptDraft]);
  return <ReceiptDraftContext.Provider value={value}>{children}</ReceiptDraftContext.Provider>;
}

export function useReceiptDraft() {
  const value = useContext(ReceiptDraftContext);
  if (!value) throw new Error('useReceiptDraft must be used inside ReceiptDraftProvider.');
  return value;
}
