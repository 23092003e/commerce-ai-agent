import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';

it('packages compiled workspace entrypoints for a non-root Node runtime', () => {
  const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8');
  expect(dockerfile).toMatch(/FROM node:22[^\n]* AS build/);
  expect(dockerfile).toContain('--frozen-lockfile');
  expect(dockerfile).toContain('USER node');
  expect(dockerfile).toContain('HEALTHCHECK');
  expect(dockerfile).toContain('--conditions=production');
  expect(dockerfile).not.toMatch(/COPY\s+\.env/);
  for (const name of [
    'config',
    'db',
    'domain',
    'meta',
    'observability',
    'queue'
  ]) {
    const pkg = z
      .object({
        exports: z.object({
          '.': z.object({ production: z.string(), default: z.string() })
        })
      })
      .parse(
        JSON.parse(
          readFileSync(resolve(`packages/${name}/package.json`), 'utf8')
        )
      );
    expect(pkg.exports['.'].production).toBe('./dist/index.js');
    expect(pkg.exports['.'].default).toBe('./src/index.ts');
  }
  expect(existsSync('.dockerignore')).toBe(true);
});
