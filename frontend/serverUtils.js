/**
 * Pure server utilities for host checking and CSP header generation
 */

const rawAllowedHosts = process.env.ALLOWED_HOSTS || 'localhost,127.0.0.1';
export const ALLOWED_HOSTS = new Set(rawAllowedHosts.split(',').map(h => h.trim()).filter(Boolean));

export function getCleanHost(hostHeader) {
  if (!hostHeader) return null;
  // Strip port if present (e.g. localhost:3000 -> localhost)
  const clean = hostHeader.split(':')[0].trim().toLowerCase();
  return clean;
}

export function isAllowedHost(host) {
  return ALLOWED_HOSTS.has(host);
}

export function buildCspDirectives(host, backendPort) {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
    fontSrc: ["'self'"],
    connectSrc: ["'self'", `http://${host}:${backendPort}`, 'https://api.cloudinary.com'],
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: isProd ? [] : null
  };
}
