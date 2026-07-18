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
  | { kind: 'expense_conflict'; latest: ExpenseFile | null; operation: 'edit' | 'delete' }
  | { kind: 'spending_plan_conflict'; latest: GroupFile; submitted: SpendingPlan | null }
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
    case 'expense_conflict': return 'This expense changed on GitHub. Review the latest version before trying again.';
    case 'spending_plan_conflict': return 'The spending plan changed on GitHub. Review both versions before trying again.';
    case 'repository_too_large': return 'This repository is too large to refresh safely.';
    case 'github': return error.safeMessage;
  }
}
