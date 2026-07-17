import { createRepositoryName, slugifyGroupName } from './slug';

describe('group slugging', () => {
  it('normalizes unicode and separators', () => {
    expect(slugifyGroupName('  São João — 2026  ')).toBe('sao-joao-2026');
  });

  it('rejects names without ASCII alphanumerics', () => {
    expect(() => slugifyGroupName('東京')).toThrow();
  });

  it('keeps the complete repository name within GitHub limits', () => {
    expect(createRepositoryName('a'.repeat(200))).toHaveLength(100);
  });
});
