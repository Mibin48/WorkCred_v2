import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const frontendDir = path.join(rootDir, 'frontend');

let hasErrors = false;
function reportError(file, line, msg) {
  const relFile = path.relative(rootDir, file).replace(/\\/g, '/');
  console.error(`LINT ERROR: ${relFile}:${line} - ${msg}`);
  hasErrors = true;
}

const APPROVED_HEX_PALETTE = new Set([
  '#c85a32', '#9f3c16', '#f9ece6', '#eccdc0', '#f0a27f',
  '#2a5a3b', '#386848', '#e2efe6', '#b8dac2', '#7ecf99',
  '#d49b35', '#faf3e4', '#f0deb4',
  '#23201e', '#2d2724', '#5c544e', '#514943', '#8a7e74',
  '#faf7f2', '#ffffff', '#f3efe6', '#f4f0ea', '#eee8df', '#e9e2d5',
  '#ddd5c5', '#ccc3b3',
  '#815300', '#ba1a1a', '#ffdad6', '#365c70', '#e8f0f2'
]);

// 1. Parse tokens.css
const tokensCssPath = path.join(frontendDir, 'css', 'tokens.css');
if (!fs.existsSync(tokensCssPath)) {
  console.error('LINT FATAL: frontend/css/tokens.css does not exist');
  process.exit(1);
}

const tokensContent = fs.readFileSync(tokensCssPath, 'utf8');
const tokenLines = tokensContent.split('\n');

const definedTokens = new Set();
const tokenValues = new Map();

for (let i = 0; i < tokenLines.length; i++) {
  const line = tokenLines[i].trim();
  const lineNum = i + 1;

  // Check for hex colours in tokens.css
  const hexMatches = line.match(/#[0-9a-fA-F]{3,8}\b/g);
  if (hexMatches) {
    for (const h of hexMatches) {
      const lower = h.toLowerCase();
      if (!APPROVED_HEX_PALETTE.has(lower)) {
        reportError(tokensCssPath, lineNum, `Unapproved hex color '${h}' in tokens.css`);
      }
    }
  }

  // Record custom property definitions
  const propMatch = line.match(/^(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/);
  if (propMatch) {
    const name = propMatch[1];
    const val = propMatch[2].trim();
    definedTokens.add(name);
    tokenValues.set(name, val);
  }

  // Check @font-face url references
  const fontUrlMatch = line.match(/url\(['"]?([^'")]+)['"]?\)/);
  if (fontUrlMatch) {
    const fontRef = fontUrlMatch[1];
    if (fontRef.startsWith('/')) {
      const targetDiskPath = path.join(frontendDir, fontRef);
      if (!fs.existsSync(targetDiskPath)) {
        reportError(tokensCssPath, lineNum, `Referenced font file not found on disk: ${fontRef}`);
      }
    }
  }
}

// 2. Scan all CSS files
function scanCssFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const isTokensCss = path.resolve(filePath) === path.resolve(tokensCssPath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check var(--name) usage
    const varMatches = line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g);
    for (const m of varMatches) {
      const name = m[1];
      if (!definedTokens.has(name)) {
        reportError(filePath, lineNum, `Undefined token used: ${name}`);
      }
    }

    if (!isTokensCss) {
      // No hex colors outside tokens.css
      const hexMatches = line.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hexMatches) {
        reportError(filePath, lineNum, `Hex color literal not allowed outside tokens.css: ${hexMatches.join(', ')}`);
      }

      // No rgb(), rgba(), hsl(), hsla()
      if (/\b(rgb|rgba|hsl|hsla)\s*\(/i.test(line)) {
        reportError(filePath, lineNum, `Color function literal not allowed outside tokens.css`);
      }

      // No gradient functions
      if (/(-gradient)\s*\(/i.test(line)) {
        reportError(filePath, lineNum, `Gradient functions are forbidden by design system`);
      }

      // Disallow literal font-size, font-family, box-shadow, border-radius, z-index, transition-duration
      const propRuleMatch = line.match(/^\s*([a-zA-Z-]+)\s*:\s*([^;]+);/);
      if (propRuleMatch) {
        const prop = propRuleMatch[1].toLowerCase();
        let val = propRuleMatch[2].trim().replace(/\s*!important$/i, '');

        const restrictedProps = [
          'font-size', 'font-family', 'box-shadow', 'border-radius',
          'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
          'z-index', 'transition-duration'
        ];

        if (restrictedProps.includes(prop)) {
          // Allow 0, 0s, 0ms, none, auto, inherit, 100%, 50%, var(...)
          const isAllowed = /^(0|0s|0ms|none|auto|inherit|100%|50%|currentColor)$/i.test(val) ||
                            val.startsWith('var(');
          if (!isAllowed) {
            reportError(filePath, lineNum, `Literal value '${val}' not allowed for property '${prop}'. Use tokens.`);
          }
        }
      }

      // No external URLs in CSS
      if (/https?:\/\//i.test(line)) {
        reportError(filePath, lineNum, `External URL found in CSS: ${line.trim()}`);
      }
    }
  }
}

// 3. Scan HTML files
function scanHtmlFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // No style= attribute
    if (/\bstyle\s*=\s*['"]/i.test(line)) {
      reportError(filePath, lineNum, `Inline style attribute found in HTML. Strict CSP forbids inline styles.`);
    }

    // No external URLs (http:// or https://)
    if (/https?:\/\//i.test(line)) {
      reportError(filePath, lineNum, `External URL found in HTML: ${line.trim()}`);
    }
  }
}

// 4. Scan JS files
function scanJsFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');

  // Skip node_modules
  if (relPath.includes('node_modules')) return;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Forbidden DOM sinks & eval
    const forbiddenPatterns = [
      { pattern: /\binnerHTML\b/, name: 'innerHTML' },
      { pattern: /\bouterHTML\b/, name: 'outerHTML' },
      { pattern: /\binsertAdjacentHTML\b/, name: 'insertAdjacentHTML' },
      { pattern: /\bdocument\.write\b/, name: 'document.write' },
      { pattern: /\beval\s*\(/, name: 'eval' },
      { pattern: /\bnew\s+Function\b/, name: 'new Function' }
    ];

    for (const { pattern, name } of forbiddenPatterns) {
      if (pattern.test(line)) {
        reportError(filePath, lineNum, `Forbidden construct '${name}' used in JavaScript`);
      }
    }

    // External URLs check in frontend JS
    // Allow Cloudinary origin in server.js CSP string and config.js
    if (/https?:\/\//i.test(line)) {
      const isAllowedServer = (relPath === 'frontend/server.js' || relPath === 'frontend/serverUtils.js');
      const isAllowedConfig = relPath === 'frontend/server.js' && line.includes('BACKEND_PORT');
      const isAllowedTest = relPath.startsWith('tests/');
      const isAllowedComment = /^\s*(\/\/|\/\*|\*)/.test(line);

      if (!isAllowedServer && !isAllowedConfig && !isAllowedTest && !isAllowedComment) {
        // Check if it's an external URL other than allowed
        const match = line.match(/https?:\/\/[^\s'"`,)]+/);
        if (match && !match[0].includes('cloudinary.com') && !match[0].includes('localhost') && !match[0].includes('127.0.0.1') && match[0] !== 'http://www.w3.org/2000/svg') {
          reportError(filePath, lineNum, `External URL found in JS: ${match[0]}`);
        }
      }
    }
  }
}

// Recursive directory walker
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        walk(full);
      }
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.css')) {
        scanCssFile(full);
      } else if (entry.name.endsWith('.html')) {
        scanHtmlFile(full);
      } else if (entry.name.endsWith('.js') && full.includes(frontendDir)) {
        scanJsFile(full);
      }
    }
  }
}

// 5. Contrast ratio check for DESIGN_SYSTEM.md 2.4 pairs
function hexToRgb(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c.split('').map(x => x + x).join('');
  }
  const num = parseInt(c, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function sRgbToLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * sRgbToLinear(r) + 0.7152 * sRgbToLinear(g) + 0.0722 * sRgbToLinear(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

console.log('--- WCAG Contrast Ratio Checks ---');
const contrastPairs = [
  { fg: '--charcoal', bg: '--paper', min: 4.5, name: 'Charcoal text on Paper' },
  { fg: '--charcoal', bg: '--surface', min: 4.5, name: 'Charcoal text on Surface' },
  { fg: '--charcoal', bg: '--linen', min: 4.5, name: 'Charcoal text on Linen' },
  { fg: '--stone', bg: '--paper', min: 4.5, name: 'Stone body on Paper' },
  { fg: '--stone', bg: '--surface', min: 4.5, name: 'Stone body on Surface' },
  { fg: '--stone-dark', bg: '--paper', min: 4.5, name: 'Stone-dark text on Paper' },
  { fg: '--stone-dark', bg: '--surface', min: 4.5, name: 'Stone-dark text on Surface' },
  { fg: '--clay-text', bg: '--paper', min: 4.5, name: 'Clay-text on Paper' },
  { fg: '--clay-text', bg: '--surface', min: 4.5, name: 'Clay-text on Surface' },
  { fg: '--moss', bg: '--moss-tint', min: 4.5, name: 'Moss text on Moss-tint' },
  { fg: '--moss-bright', bg: '--charcoal', min: 4.5, name: 'Moss-bright on Charcoal' },
  { fg: '--clay-light', bg: '--charcoal', min: 4.5, name: 'Clay-light on Charcoal' },
  { fg: '--cream', bg: '--charcoal', min: 4.5, name: 'Cream text on Charcoal' },
  { fg: '--warning', bg: '--warning-tint', min: 4.5, name: 'Warning text on Warning-tint' },
  { fg: '--error', bg: '--error-tint', min: 4.5, name: 'Error text on Error-tint' },
  { fg: '--error', bg: '--surface', min: 4.5, name: 'Error text on Surface' },
  { fg: '--surface', bg: '--clay', min: 3.0, name: 'Primary Button: Surface on Clay (Bold large text)', note: 'Permitted down to 3:1 for bold button label' }
];

for (const pair of contrastPairs) {
  const fgHex = tokenValues.get(pair.fg);
  const bgHex = tokenValues.get(pair.bg);
  if (!fgHex || !bgHex) {
    reportError(tokensCssPath, 1, `Contrast check missing token: ${pair.fg} or ${pair.bg}`);
    continue;
  }
  const ratio = contrastRatio(fgHex, bgHex);
  const ratioStr = ratio.toFixed(2) + ':1';
  if (ratio < pair.min) {
    reportError(tokensCssPath, 1, `Contrast ratio FAIL: ${pair.name} is ${ratioStr} (minimum ${pair.min}:1 required)`);
  } else {
    const note = pair.note ? ` (${pair.note})` : '';
    console.log(`[PASS] ${pair.name}: ${ratioStr}${note}`);
  }
}

// Execute scan
walk(frontendDir);

if (hasErrors) {
  console.error('\nlint:tokens failed with errors.');
  process.exit(1);
} else {
  console.log('\nlint:tokens passed cleanly. All tokens, styles, scripts and contrast checks verified.');
  process.exit(0);
}
