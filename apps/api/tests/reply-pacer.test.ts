import { describe, expect, it } from 'vitest';
import { calculateHumanReplyDelayMs } from '../src/workers/reply-pacer.js';

const settings = {
  enabled: true,
  minDelayMs: 800,
  maxDelayMs: 2_600,
  charactersPerSecond: 20
};

describe('human reply pacing', () => {
  it('uses a bounded delay based on the response length', () => {
    expect(calculateHumanReplyDelayMs('short', settings)).toBe(800);
    expect(calculateHumanReplyDelayMs('x'.repeat(1_000), settings)).toBe(2600);
  });

  it('can be disabled without waiting', () => {
    expect(
      calculateHumanReplyDelayMs('a normal reply', {
        ...settings,
        enabled: false
      })
    ).toBe(0);
  });
});
