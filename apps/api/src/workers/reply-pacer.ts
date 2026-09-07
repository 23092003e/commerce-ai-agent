export interface ReplyPacer {
  wait(text: string): Promise<void>;
}

export interface HumanReplyPacerOptions {
  enabled: boolean;
  minDelayMs: number;
  maxDelayMs: number;
  charactersPerSecond: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export function calculateHumanReplyDelayMs(
  text: string,
  options: Omit<HumanReplyPacerOptions, 'sleep'>
): number {
  if (!options.enabled) return 0;
  const typingMs = Math.round(
    (text.trim().length / options.charactersPerSecond) * 1_000
  );
  return Math.max(options.minDelayMs, Math.min(options.maxDelayMs, typingMs));
}

export function createHumanReplyPacer(
  options: HumanReplyPacerOptions
): ReplyPacer {
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  return {
    async wait(text) {
      const delayMs = calculateHumanReplyDelayMs(text, options);
      if (delayMs > 0) await sleep(delayMs);
    }
  };
}
