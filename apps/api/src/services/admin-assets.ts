import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

export function registerAdminAssets(
  app: FastifyInstance,
  directory: string
): void {
  const root = resolve(directory);
  app.get('/admin', async (_request, reply) => reply.redirect('/admin/'));
  app.get('/admin/*', async (request, reply) => {
    const params = request.params as { '*': string };
    const name = params['*'] || 'index.html';
    const file = resolve(root, name);
    const contentType = contentTypes[extname(file)];
    if (
      !file.startsWith(root + sep) ||
      !contentType ||
      name.split(/[\\/]/).some((part) => part.startsWith('.'))
    ) {
      return reply.code(404).send({ error: 'not_found' });
    }
    try {
      const body = await readFile(file);
      return await reply
        .header('content-type', contentType)
        .header('x-content-type-options', 'nosniff')
        .header('referrer-policy', 'no-referrer')
        .header(
          'content-security-policy',
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        .header(
          'cache-control',
          name.startsWith('assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-store'
        )
        .send(body);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'EISDIR')
      ) {
        return reply.code(404).send({ error: 'not_found' });
      }
      throw error;
    }
  });
}
