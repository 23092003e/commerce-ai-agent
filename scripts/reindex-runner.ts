export interface ReindexOptions {
  sourceProvider: string;
  sourceModel?: string;
  batchSize: number;
  execute: boolean;
}
export function parseReindexOptions(args: string[]): ReindexOptions {
  const value = (name: string) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  const allowed = new Set([
    '--source-provider',
    '--source-model',
    '--batch-size',
    '--dry-run',
    '--execute'
  ]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg || !allowed.has(arg)) throw new Error('Unknown reindex argument');
    if (args.indexOf(arg) !== index)
      throw new Error('Duplicate reindex argument');
    if (!['--dry-run', '--execute'].includes(arg)) {
      if (!args[index + 1] || args[index + 1]?.startsWith('--'))
        throw new Error('Missing reindex value');
      index++;
    }
  }
  if (args.includes('--dry-run') === args.includes('--execute'))
    throw new Error('Select exactly one mode: --dry-run or --execute');
  const sourceProvider = value('--source-provider');
  if (
    !sourceProvider ||
    !['deterministic', 'openai-compatible'].includes(sourceProvider)
  )
    throw new Error('Specify source-provider');
  const batchSize = Number(value('--batch-size') ?? 10);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50)
    throw new Error('batch-size must be 1..50');
  const sourceModel = value('--source-model');
  return {
    sourceProvider,
    ...(sourceModel ? { sourceModel } : {}),
    batchSize,
    execute: args.includes('--execute')
  };
}

export async function reindexKnowledge<
  T extends { id: string; content: string | null }
>(
  options: ReindexOptions,
  dependencies: {
    destinationProvider: string;
    destinationModel?: string;
    list(after: string, batchSize: number): Promise<T[]>;
    ingest(document: T): Promise<unknown>;
  }
) {
  if (
    options.sourceProvider === dependencies.destinationProvider &&
    (!options.sourceModel ||
      options.sourceModel === dependencies.destinationModel)
  )
    throw new Error('Source and destination provenance must differ');
  let after = '';
  const result = { eligible: 0, reindexed: 0, requiresSourceReimport: 0 };
  for (;;) {
    const batch = await dependencies.list(after, options.batchSize);
    if (!batch.length) return result;
    for (const document of batch) {
      if (document.id <= after)
        throw new Error('Reindex source must be in increasing ID order');
      if (document.content === null) result.requiresSourceReimport++;
      else {
        result.eligible++;
        if (options.execute) {
          await dependencies.ingest(document);
          result.reindexed++;
        }
      }
      after = document.id;
    }
  }
}
