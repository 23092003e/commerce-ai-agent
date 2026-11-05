import { z } from 'zod';

const checksum = z.string().regex(/^[a-f0-9]{64}$/);
export const ReleaseEvidenceSchema = z
  .object({
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    imageRevision: z.string(),
    imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    verifiedAt: z.iso.datetime(),
    checks: z
      .object({
        lint: z.boolean(),
        typecheck: z.boolean(),
        unit: z.boolean(),
        integration: z.boolean(),
        build: z.boolean(),
        container: z.boolean(),
        restore: z.boolean()
      })
      .strict(),
    migrationChecksums: z.record(z.string(), checksum)
  })
  .strict();

export function validateReleaseEvidence(
  value: unknown,
  state: {
    sha: string;
    dirty: boolean;
    now: number;
    migrations: Record<string, string>;
  }
): string[] {
  const parsed = ReleaseEvidenceSchema.safeParse(value);
  if (!parsed.success) return ['invalid_release_evidence'];
  const evidence = parsed.data;
  const errors: string[] = [];
  if (state.dirty) errors.push('working_tree_dirty');
  if (evidence.sourceSha !== state.sha) errors.push('source_revision_mismatch');
  if (evidence.imageRevision !== evidence.sourceSha)
    errors.push('image_revision_mismatch');
  const age = state.now - Date.parse(evidence.verifiedAt);
  if (age < -60_000 || age > 24 * 60 * 60 * 1000)
    errors.push('evidence_expired');
  for (const [name, passed] of Object.entries(evidence.checks)) {
    if (!passed) errors.push(`check_failed:${name}`);
  }
  const entries = (item: Record<string, string>) =>
    JSON.stringify(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  if (
    !Object.keys(state.migrations).length ||
    entries(evidence.migrationChecksums) !== entries(state.migrations)
  )
    errors.push('migration_checksums_mismatch');
  return errors;
}
