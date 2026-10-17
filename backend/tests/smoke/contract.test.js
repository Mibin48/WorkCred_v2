/**
 * backend/tests/smoke/contract.test.js
 *
 * Contract Parity Test (Requirement 8):
 * 1. Checks that every route registered in the Express app (method and path) appears in docs/API_CONTRACT.md.
 * 2. Checks that every endpoint listed in docs/API_CONTRACT.md exists in the Express app.
 * 3. Scans AppError usages across the codebase and verifies that each error code is listed in docs/API_CONTRACT.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../../src/app.js';

describe('API Contract Parity Tests', () => {
  const contractPath = path.resolve('..', 'docs', 'API_CONTRACT.md');
  const contractContent = fs.readFileSync(contractPath, 'utf8');

  // Helper to extract all registered routes from Express app
  function getAppRoutes(app) {
    const routes = [];

    function print(pathPrefix, layer) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
        methods.forEach(method => {
          let fullPath = pathPrefix + (layer.route.path === '/' ? '' : layer.route.path);
          // normalize trailing slash
          if (fullPath.endsWith('/') && fullPath.length > 1) {
            fullPath = fullPath.slice(0, -1);
          }
          routes.push({ method, path: fullPath });
        });
      } else if (layer.name === 'router' && layer.handle.stack) {
        let routePrefix = '';
        if (layer.regexp) {
          const match = layer.regexp.source
            .replace('\\/?(?=\\/|$)', '')
            .replace('^', '')
            .split('\\/').join('/')
            .replace(/\(\?:\([^\)]+\)\)/g, ':id')
            .replace(/\/?\$$/, '');
          routePrefix = match.startsWith('/') ? match : '/' + match;
        }
        layer.handle.stack.forEach((stackItem) => {
          print(pathPrefix + routePrefix, stackItem);
        });
      }
    }

    if (app._router && app._router.stack) {
      app._router.stack.forEach((layer) => {
        print('', layer);
      });
    }

    return routes;
  }

  const app = createApp({
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test_access_secret_at_least_32_chars_long_123',
    JWT_REFRESH_SECRET: 'test_refresh_secret_at_least_32_chars_long_123',
    CODES_ENC_KEY: Buffer.alloc(32).toString('base64'),
    RATE_LIMIT_ENABLED: false
  });

  const appRoutes = getAppRoutes(app);

  it('verifies every registered API route exists in docs/API_CONTRACT.md', () => {
    const missingInContract = [];

    for (const route of appRoutes) {
      // Ignore internal health endpoints if outside API or root
      if (!route.path.startsWith('/api/v1/')) continue;

      // Extract endpoint relative to /api/v1
      const relativePath = route.path.replace('/api/v1', '');

      // Check if endpoint is present in contract markdown
      // Match pattern like `GET` | `/workers` or `POST` | `/posts`
      const isDocumented =
        contractContent.includes(`\`${route.method}\``) &&
        (contractContent.includes(`\`${relativePath}\``) ||
         contractContent.includes(`\`${relativePath.replace(/\/:[^/]+/g, '/:id')}\``) ||
         contractContent.includes(`\`${relativePath.replace(/\/:[^/]+/g, '/:workerId')}\``));

      if (!isDocumented) {
        missingInContract.push(`${route.method} ${route.path} (relative: ${relativePath})`);
      }
    }

    assert.equal(
      missingInContract.length,
      0,
      `The following registered routes are missing in docs/API_CONTRACT.md:\n${missingInContract.join('\n')}`
    );
  });

  it('scans AppError usages in backend/src and ensures error codes are documented in docs/API_CONTRACT.md', () => {
    const srcDir = path.resolve('src');
    const sharedDir = path.resolve('..', 'shared');

    const appErrorRegex = /new\s+AppError\(\s*['"]([A-Z0-9_]+)['"]/g;
    const foundCodes = new Set();

    function scanDir(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && fullPath.endsWith('.js')) {
          const content = fs.readFileSync(fullPath, 'utf8');
          let match;
          while ((match = appErrorRegex.exec(content)) !== null) {
            foundCodes.add(match[1]);
          }
        }
      }
    }

    scanDir(srcDir);
    scanDir(sharedDir);

    const missingCodes = [];
    for (const code of foundCodes) {
      if (!contractContent.includes(code)) {
        missingCodes.push(code);
      }
    }

    assert.equal(
      missingCodes.length,
      0,
      `The following AppError codes are missing from docs/API_CONTRACT.md:\n${missingCodes.join('\n')}`
    );
  });
});
