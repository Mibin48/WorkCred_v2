import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const PORT = parseInt(process.env.PORT || '3000', 10);
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || '4000', 10);
import {
  ALLOWED_HOSTS,
  getCleanHost,
  isAllowedHost,
  buildCspDirectives
} from './serverUtils.js';

export {
  ALLOWED_HOSTS,
  getCleanHost,
  isAllowedHost,
  buildCspDirectives
};

const app = express();
app.use(compression());

// Host verification & dynamic Helmet middleware
app.use((req, res, next) => {
  const host = getCleanHost(req.headers.host);
  if (!host || !isAllowedHost(host)) {
    res.status(400).send('Invalid Host header');
    return;
  }

  // Configure Helmet per-request
  helmet({
    contentSecurityPolicy: {
      directives: buildCspDirectives(host, BACKEND_PORT)
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false
  })(req, res, () => {
    // Custom Permissions-Policy header
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
    next();
  });
});

// /config.js endpoint (M6)
app.get('/config.js', (req, res) => {
  const host = getCleanHost(req.headers.host);
  if (!host || !isAllowedHost(host)) {
    res.status(400).send('Invalid Host');
    return;
  }

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const jsContent = `window.WORKCRED = { apiBase: "http://${host}:${BACKEND_PORT}/api/v1" };\n`;
  res.send(jsContent);
});

// Shared code allow-list endpoint (M7)
const SHARED_ALLOWLIST = new Set([
  'validators.js',
  'passwordRules.js',
  'containsContactInfo.js',
  'profileValidators.js',
  'profileRules.js'
]);

app.get('/shared/:file', (req, res) => {
  const fileName = req.params.file;
  if (!SHARED_ALLOWLIST.has(fileName)) {
    res.status(404).send('Not found');
    return;
  }

  const sharedFilePath = path.join(rootDir, 'shared', fileName);
  if (!fs.existsSync(sharedFilePath)) {
    res.status(404).send('Not found');
    return;
  }

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(sharedFilePath);
});

// Static assets with 1-hour cache and ETag
const staticAssetOptions = {
  maxAge: '1h',
  etag: true,
  lastModified: true,
  setHeaders: (res, assetPath) => {
    if (assetPath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    }
  }
};

app.use('/assets', express.static(path.join(__dirname, 'assets'), staticAssetOptions));
app.use('/css', express.static(path.join(__dirname, 'css'), staticAssetOptions));
app.use('/js', express.static(path.join(__dirname, 'js'), staticAssetOptions));
app.use('/app/js', express.static(path.join(__dirname, 'app', 'js'), staticAssetOptions));
app.use('/app/css', express.static(path.join(__dirname, 'app', 'css'), staticAssetOptions));

// Static marketing & legal pages
const noStore = (res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
};

app.get('/', (req, res) => {
  noStore(res);
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/privacy', (req, res) => {
  noStore(res);
  res.sendFile(path.join(__dirname, 'privacy.html'));
});

app.get('/terms', (req, res) => {
  noStore(res);
  res.sendFile(path.join(__dirname, 'terms.html'));
});

app.get('/grievance', (req, res) => {
  noStore(res);
  res.sendFile(path.join(__dirname, 'grievance.html'));
});

// SPA routing: /app and /app/*
app.get(/^\/app(?:\/.*)?$/, (req, res) => {
  const reqPath = req.path;
  // If request looks like a file with an extension, and wasn't found in statics above -> 404
  if (path.extname(reqPath)) {
    noStore(res);
    res.status(404).sendFile(path.join(__dirname, '404.html'));
    return;
  }

  noStore(res);
  res.sendFile(path.join(__dirname, 'app', 'index.html'));
});

// 404 handler for unknown paths
app.use((req, res) => {
  noStore(res);
  res.status(404).sendFile(path.join(__dirname, '404.html'));
});

let server = null;
export function startServer(port = PORT) {
  return new Promise((resolve) => {
    server = app.listen(port, () => {
      console.log(`[frontend] WorkCred frontend running on http://localhost:${port}`);
      resolve(server);
    });
  });
}

export function stopServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[frontend] Received SIGINT, shutting down gracefully...');
  await stopServer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[frontend] Received SIGTERM, shutting down gracefully...');
  await stopServer();
  process.exit(0);
});

// Direct execution
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startServer();
}

export default app;
