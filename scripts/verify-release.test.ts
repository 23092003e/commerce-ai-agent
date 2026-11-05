import { expect, it } from 'vitest';
import { validateReleaseEvidence } from './verify-release-core.js';

const sha = 'a'.repeat(40);
const evidence = {
  sourceSha: sha,
  imageRevision: sha,
  imageId: 'sha256:' + 'b'.repeat(64),
  verifiedAt: '2026-11-05T08:00:00Z',
  checks: {
    lint: true,
    typecheck: true,
    unit: true,
    integration: true,
    build: true,
    container: true,
    restore: true
  },
  migrationChecksums: { '0001_initial.sql': 'c'.repeat(64) }
};
const state = {
  sha,
  dirty: false,
  now: Date.parse('2026-11-05T09:00:00Z'),
  migrations: evidence.migrationChecksums
};

it('accepts matching clean revision and completed local evidence', () => {
  expect(validateReleaseEvidence(evidence, state)).toEqual([]);
});
it('rejects dirty, stale and incomplete evidence and image/revision drift', () => {
  const errors = validateReleaseEvidence(
    {
      ...evidence,
      imageRevision: 'd'.repeat(40),
      checks: { ...evidence.checks, integration: false }
    },
    { ...state, dirty: true, now: state.now + 48 * 60 * 60 * 1000 }
  );
  expect(errors).toContain('working_tree_dirty');
  expect(errors).toContain('image_revision_mismatch');
  expect(errors).toContain('evidence_expired');
  expect(errors).toContain('check_failed:integration');
});
it('rejects missing, added or modified migrations', () => {
  expect(
    validateReleaseEvidence(evidence, {
      ...state,
      migrations: { '0002.sql': 'f'.repeat(64) }
    })
  ).toContain('migration_checksums_mismatch');
});
