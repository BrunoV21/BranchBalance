import { fireEvent, render } from '@testing-library/react-native';

import type { Member } from '@/domain/types';
import { ThemeProvider } from '@/providers/theme-provider';

import { ExpenseForm } from './expense-form';

const members: Member[] = [
  { login: 'alice', name: null, avatarUrl: null, role: 'owner' },
  { login: 'bob', name: null, avatarUrl: null, role: 'member' },
];

describe('ExpenseForm', () => {
  it('disables duplicate submission while the write is in flight', async () => {
    let resolve!: () => void;
    const onSubmit = jest.fn(() => new Promise<void>((done) => { resolve = done; }));
    const view = await render(<ThemeProvider><ExpenseForm currency="EUR" members={members} initial={{ description: 'Dinner', amount: '10.00', paidBy: 'alice', splitType: 'equal', participants: ['alice', 'bob'], expenseDate: '2026-07-16' }} submitLabel="Save expense" onSubmit={onSubmit} /></ThemeProvider>);
    const save = view.getByRole('button', { name: 'Save expense' });
    await fireEvent.press(save);
    await fireEvent.press(save);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    resolve();
    await view.unmount();
  });

  it('shows deterministic share previews', async () => {
    const view = await render(<ThemeProvider><ExpenseForm currency="EUR" members={members} initial={{ description: 'Dinner', amount: '10.01', paidBy: 'alice', splitType: 'equal', participants: ['bob', 'alice'], expenseDate: '2026-07-16' }} submitLabel="Save expense" onSubmit={async () => undefined} /></ThemeProvider>);
    expect(view.getByText('€5.01 share')).toBeTruthy();
    expect(view.getByText('€5.00 share')).toBeTruthy();
  });
});
