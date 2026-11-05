import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

it('serves the Admin app and its assets under /admin without exposing other files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'admin-assets-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<html>Admin Desk</html>');
  await writeFile(join(directory, 'assets', 'app.js'), 'console.log("admin");');
  const app = buildApp({
    config: { metaAppSecret: 'test-secret', metaVerifyToken: 'test-token' },
    adminAssetsDirectory: directory
  });
  cleanup.push(() => app.close());
  expect((await app.inject('/admin')).statusCode).toBe(302);
  const page = await app.inject('/admin/');
  expect(page.statusCode).toBe(200);
  expect(page.headers['content-type']).toContain('text/html');
  expect(page.body).toContain('Admin Desk');
  const asset = await app.inject('/admin/assets/app.js');
  expect(asset.statusCode).toBe(200);
  expect(asset.headers['content-type']).toContain('javascript');
  expect((await app.inject('/admin/.env')).statusCode).toBe(404);
  expect((await app.inject('/admin/assets/missing.js')).statusCode).toBe(404);
  expect((await app.inject('/internal/admin/conversations')).statusCode).toBe(
    404
  );
});
