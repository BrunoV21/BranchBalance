import { fireEvent, render } from '@testing-library/react-native';

import type { Member } from '@/domain/types';
import { ThemeProvider } from '@/providers/theme-provider';

import { ExpenseForm } from './expense-form';

const members: Member[] = [
  { login: 'alice', name: null, avatarUrl: null, role: 'owner' },
  { login: 'bob', name: null, avatarUrl: null, role: 'member' },
];

describe('ExpenseForm', () => {
  it('requires an intentional category and payment-method selection for a new expense', async () => {
    const onSubmit = jest.fn(async () => undefined);
    const view = await render(<ThemeProvider><ExpenseForm currency="EUR" members={members} submitLabel="Save expense" onSubmit={onSubmit} /></ThemeProvider>);
    await fireEvent.changeText(view.getByLabelText('Description'), 'Dinner');
    await fireEvent.changeText(view.getByLabelText('Amount (EUR)'), '10.00');
    await fireEvent.press(view.getByRole('button', { name: 'Save expense' }));
    expect(await view.findByText('Select an expense category.')).toBeTruthy();
    await fireEvent.press(view.getByRole('radio', { name: 'Food & drinks' }));
    await fireEvent.press(view.getByRole('button', { name: 'Save expense' }));
    expect(await view.findByText('Select a payment method.')).toBeTruthy();
    await fireEvent.press(view.getByRole('radio', { name: 'Card' }));
    await fireEvent.press(view.getByRole('button', { name: 'Save expense' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: 'food_drink', paymentMethod: 'card' }));
  });

  it('disables duplicate submission while the write is in flight', async () => {
    let resolve!: () => void;
    const onSubmit = jest.fn(() => new Promise<void>((done) => { resolve = done; }));
    const view = await render(<ThemeProvider><ExpenseForm currency="EUR" members={members} initial={{ description: 'Dinner', amount: '10.00', category: 'food_drink', paymentMethod: 'card', paidBy: 'alice', splitType: 'equal', participants: ['alice', 'bob'], expenseDate: '2026-07-16' }} submitLabel="Save expense" onSubmit={onSubmit} /></ThemeProvider>);
    const save = view.getByRole('button', { name: 'Save expense' });
    await fireEvent.press(save);
    await fireEvent.press(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    resolve();
    await view.unmount();
  });

  it('shows deterministic share previews', async () => {
    const view = await render(<ThemeProvider><ExpenseForm currency="EUR" members={members} initial={{ description: 'Dinner', amount: '10.01', category: 'food_drink', paymentMethod: 'card', paidBy: 'alice', splitType: 'equal', participants: ['bob', 'alice'], expenseDate: '2026-07-16' }} submitLabel="Save expense" onSubmit={async () => undefined} /></ThemeProvider>);
    expect(view.getByText('€5.01 share')).toBeTruthy();
    expect(view.getByText('€5.00 share')).toBeTruthy();
  });

  it('selects an expense date with the in-app themed calendar', async () => {
    const view = await render(<ThemeProvider><ExpenseForm currency="EUR" members={members} initial={{ description: 'Dinner', amount: '10.00', category: 'food_drink', paymentMethod: 'card', paidBy: 'alice', splitType: 'equal', participants: ['alice', 'bob'], expenseDate: '2026-07-16' }} submitLabel="Save expense" onSubmit={async () => undefined} /></ThemeProvider>);

    await fireEvent.press(view.getByRole('button', { name: '2026-07-16' }));
    await view.findByText('July 2026');
    await fireEvent.press(view.getByRole('button', { name: new Date(2026, 6, 17).toLocaleDateString() }));
    await fireEvent.press(view.getByRole('button', { name: 'Use date' }));

    expect(view.getByRole('button', { name: '2026-07-17' })).toBeTruthy();
  });

  it('rewrites the payer-only participant when Just me is selected and the payer changes', async () => {
    const onSubmit = jest.fn(async () => undefined);
    const view = await render(<ThemeProvider><ExpenseForm currency="EUR" members={members} initial={{ description: 'Coffee', amount: '4.25', category: 'food_drink', paymentMethod: 'cash', paidBy: 'alice', splitType: 'just_me', participants: ['alice'], expenseDate: '2026-07-16' }} submitLabel="Save expense" onSubmit={onSubmit} /></ThemeProvider>);
    await fireEvent.press(view.getByRole('radio', { name: '@bob' }));
    await fireEvent.press(view.getByRole('button', { name: 'Save expense' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ paidBy: 'bob', splitType: 'just_me', participants: ['bob'] }));
  });

  it('shows an editable review notice for receipt-prefilled fields', async () => {
    const view = await render(<ThemeProvider><ExpenseForm currency="EUR" members={members} initial={{ description: 'Cafe', amount: '4.20', category: null, paymentMethod: null, paidBy: 'alice', splitType: 'equal', participants: ['alice', 'bob'], expenseDate: '2026-07-20' }} receiptPrefill={{ description: 'Cafe', amount: '4.20', expenseDate: '2026-07-20', confidence: { merchant: 0.98, total: 0.99, date: 0.97 }, warnings: ['Review the total.'], modelBundleVersion: 'test' }} submitLabel="Save expense" onSubmit={async () => undefined} /></ThemeProvider>);

    expect(view.getByText(/Receipt read on this device.*Review every field.*Review the total/)).toBeTruthy();
    await fireEvent.changeText(view.getByLabelText('Description'), 'Edited cafe');
    expect(view.getByDisplayValue('Edited cafe')).toBeTruthy();
  });
});
