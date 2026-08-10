import type { ExpenseFile, GroupFile, IsoInstant, RepositoryRef, SpendingPlan } from './types';

export type AppError =
  | { kind: 'auth_required'; reason: 'missing' | 'refresh_expired' | 'revoked' }
  | { kind: 'network'; retryable: true }
  | { kind: 'timeout'; retryable: true }
  | { kind: 'rate_limit'; retryable: true; retryAt: IsoInstant | null; secondary: boolean }
  | { kind: 'permission'; operation: string }
  | { kind: 'not_found'; resource: string }
  | { kind: 'validation'; field?: string; message: string }
  | { kind: 'data_warning'; path: string; reason: string }
  | { kind: 'repository_name_taken'; repository: string }
  | { kind: 'partial_group_creation'; repository: RepositoryRef }
  | { kind: 'unsupported_group_type'; groupType: string }
  | { kind: 'group_type_changed' }
  | { kind: 'plan_type_mismatch' }
  | { kind: 'expense_conflict'; latest: ExpenseFile | null; operation: 'edit' | 'delete' }
  | { kind: 'spending_plan_conflict'; latest: GroupFile; submitted: SpendingPlan | null }
  | { kind: 'settlement_stale'; availableMinor: number }
  | { kind: 'settlement_record_conflict' }
  | { kind: 'settlement_confirmation_conflict' }
  | { kind: 'settlement_confirmation_unauthorized' }
  | { kind: 'settlement_ledger_invalid' }
  | { kind: 'settlement_ledger_capacity' }
  | { kind: 'invitation_unavailable'; invitationId: number }
  | { kind: 'invitation_decision_unknown'; invitationId: number; action: 'accept' | 'decline' }
  | { kind: 'invitation_permission'; operation: 'list' | 'accept' | 'decline' }
  | { kind: 'repository_too_large' }
  | { kind: 'github'; status: number; safeMessage: string; retryable: boolean };

export class DomainValidationError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

export class AppFailure extends Error {
  constructor(readonly detail: AppError) {
    super(messageForError(detail));
    this.name = 'AppFailure';
  }
}

export function messageForError(error: AppError): string {
  switch (error.kind) {
    case 'auth_required': return error.reason === 'missing' ? 'Sign in to continue.' : 'Your GitHub session expired. Please sign in again.';
    case 'network': return 'Unable to reach GitHub. Check your connection and try again.';
    case 'timeout': return 'GitHub took too long to respond. Try again.';
    case 'rate_limit': return error.retryAt ? `GitHub rate limit reached. Try again after ${error.retryAt}.` : 'GitHub rate limit reached. Try again later.';
    case 'permission': return `Your GitHub account cannot ${error.operation}.`;
    case 'not_found': return `${error.resource} could not be found.`;
    case 'validation': return error.message;
    case 'data_warning': return `Skipped invalid data at ${error.path}: ${error.reason}`;
    case 'repository_name_taken': return `The repository ${error.repository} already exists. Choose another group name.`;
    case 'partial_group_creation': return 'The private repository was created, but its group file still needs to be added.';
    case 'unsupported_group_type': return `Group type “${error.groupType}” requires a newer BranchBalance version.`;
    case 'group_type_changed': return 'This group type changed on GitHub. BranchBalance disabled writes to protect the repository.';
    case 'plan_type_mismatch': return 'This spending plan does not match the group type.';
    case 'expense_conflict': return 'This expense changed on GitHub. Review the latest version before trying again.';
    case 'spending_plan_conflict': return 'The spending plan changed on GitHub. Review both versions before trying again.';
    case 'settlement_stale': return error.availableMinor > 0 ? 'This settlement changed. Review the latest available amount and try again.' : 'This settlement is no longer available to record.';
    case 'settlement_record_conflict': return 'This payment ID conflicts with a different record on GitHub.';
    case 'settlement_confirmation_conflict': return 'This payment changed on GitHub and could not be confirmed safely.';
    case 'settlement_confirmation_unauthorized': return 'Only the current recipient can confirm that this payment was received.';
    case 'settlement_ledger_invalid': return 'The settlement ledger contains data that must be repaired on GitHub before payments can be changed.';
    case 'settlement_ledger_capacity': return 'The settlement ledger has reached its safe size limit and cannot accept more payments.';
    case 'invitation_unavailable': return 'This group invitation is no longer available. Refresh to check your current invitations.';
    case 'invitation_decision_unknown': return `GitHub did not confirm whether this invitation was ${error.action === 'accept' ? 'accepted' : 'declined'}. Refresh before trying again.`;
    case 'invitation_permission': return error.operation === 'list'
      ? 'BranchBalance needs updated GitHub permission to show your group invitations. Reauthorize the GitHub App and try again.'
      : `BranchBalance needs updated GitHub permission to ${error.operation} this group invitation. Reauthorize the GitHub App and try again.`;
    case 'repository_too_large': return 'This repository is too large to refresh safely.';
    case 'github': return error.safeMessage;
  }
}
