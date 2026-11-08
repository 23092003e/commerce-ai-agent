import { expect, it } from 'vitest';
import { parseReindexOptions, reindexKnowledge } from './reindex-runner.js';

it('requires an explicit mode and rejects ambiguous or unbounded options', () => {
  expect(() =>
    parseReindexOptions(['--source-provider', 'deterministic'])
  ).toThrow('mode');
  expect(() =>
    parseReindexOptions([
      '--source-provider',
      'deterministic',
      '--dry-run',
      '--execute'
    ])
  ).toThrow('mode');
  expect(() =>
    parseReindexOptions([
      '--source-provider',
      'deterministic',
      '--dry-run',
      '--batch-size',
      '51'
    ])
  ).toThrow('batch');
});
it('resumes unfinished source records and never reconstructs missing original content', async () => {
  const pending = new Set(['a', 'b', 'c']);
  let fail = true;
  const completed: string[] = [];
  const options = {
    sourceProvider: 'deterministic',
    batchSize: 2,
    execute: true
  };
  const dependencies = {
    destinationProvider: 'openai-compatible',
    list: async (after: string, batch: number) =>
      [...pending]
        .filter((id) => id > after)
        .sort()
        .slice(0, batch)
        .map((id) => ({ id, content: id === 'c' ? null : id })),
    ingest: async (document: { id: string; content: string | null }) => {
      if (document.id === 'b' && fail) throw new Error('provider failure');
      completed.push(document.id);
      pending.delete(document.id);
    }
  };
  await expect(reindexKnowledge(options, dependencies)).rejects.toThrow(
    'provider failure'
  );
  expect(completed).toEqual(['a']);
  fail = false;
  const result = await reindexKnowledge(options, dependencies);
  expect(completed).toEqual(['a', 'b']);
  expect(result).toMatchObject({ reindexed: 1, requiresSourceReimport: 1 });
});
it('dry-run does not call providers or mutate state', async () => {
  const result = await reindexKnowledge(
    { sourceProvider: 'deterministic', batchSize: 10, execute: false },
    {
      destinationProvider: 'openai-compatible',
      list: async (after) => (after ? [] : [{ id: 'a', content: 'approved' }]),
      ingest: async () => {
        throw new Error('must not call');
      }
    }
  );
  expect(result).toMatchObject({ eligible: 1, reindexed: 0 });
});
