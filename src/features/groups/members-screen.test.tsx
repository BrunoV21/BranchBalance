import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { useGroup } from '@/providers/group-provider';
import { ThemeProvider } from '@/providers/theme-provider';

import MembersScreen from '../../app/(app)/groups/[owner]/[repo]/(tabs)/members';

jest.mock('@/features/groups/use-group-refresh', () => ({ useGroupRefresh: () => jest.fn() }));
jest.mock('@/providers/group-provider', () => ({ useGroup: jest.fn() }));

const snapshot = {
  group: { name: 'Lisbon weekend' },
  repository: { owner: 'owner', name: 'branch-balance-lisbon-weekend', canAdmin: true },
  members: [{ login: 'owner', name: null, avatarUrl: null, role: 'owner' }],
  pendingMembers: [],
};

describe('Members screen invitations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows repository-specific GitHub acceptance guidance after inviting a collaborator', async () => {
    const invite = jest.fn().mockResolvedValue(undefined);
    jest.mocked(useGroup).mockReturnValue({ state: { data: snapshot }, invite } as never);
    const view = await render(<ThemeProvider><MembersScreen /></ThemeProvider>);

    await fireEvent.changeText(view.getByLabelText('GitHub username'), '  New-Friend  ');
    await fireEvent.press(view.getByRole('button', { name: 'Invite' }));

    await waitFor(() => expect(invite).toHaveBeenCalledWith('new-friend'));
    expect(view.getByText(/Invitation sent to @new-friend/i)).toBeTruthy();
    expect(view.getByText(/go to github\.com and accept the invitation to collaborate on branch-balance-lisbon-weekend/i)).toBeTruthy();
    expect(view.getByText(/refresh Your groups/i)).toBeTruthy();
    expect(view.getByLabelText('GitHub username').props.value).toBe('');
  });
});
