import { DomainValidationError } from './errors';

const PREFIX = 'branch-balance-';

export function slugifyGroupName(name: string): string {
  const slug = name.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-').slice(0, 85).replace(/-+$/g, '');
  if (!slug) throw new DomainValidationError('Group name must contain a letter or number.', 'name');
  return slug;
}

export function createRepositoryName(name: string): string {
  return `${PREFIX}${slugifyGroupName(name)}`;
}
