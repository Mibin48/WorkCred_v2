# WorkCred Frontend Architecture & Engineering Guide (Phase I1)

This guide documents the frontend architecture, patterns, component catalog, token rules, and security enforcement for the WorkCred web application.

---

## 1. Architecture & Folder Map

WorkCred frontend is built with **Vanilla JavaScript ES Modules** and strict CSS design tokens. There is **no bundler**, **no transpiler**, and **no runtime framework** (no React, Vue, Angular, or Tailwind). All modules are loaded natively by modern browsers using standard `<script type="module">`.

```
WorkCred/
├── frontend/
│   ├── assets/
│   │   ├── fonts/               # Self-hosted WOFF2 font files (Plus Jakarta Sans, Newsreader)
│   │   ├── icons/               # Inline SVG icon partials using currentColor
│   │   └── sample/              # Generated sample work PNGs for dev/testing
│   ├── css/
│   │   ├── tokens.css           # Single source of truth for palette, typography, radii, elevation
│   │   ├── base.css             # CSS reset, box-sizing, font-face declarations, focus-visible
│   │   ├── layout.css           # Shell grid, sticky headers, bottom navigation, responsive breakpoints
│   │   ├── components.css       # Design-token-backed styles for reusable UI primitives
│   │   └── landing.css          # Landing page styles (Hero, Compass, Passport, Trust, Footer)
│   ├── js/
│   │   └── landing.js           # Static landing page interactive logic (demo rates, FAQ accordion)
│   ├── app/
│   │   ├── index.html           # SPA entry point with root #app container and no inline scripts
│   │   └── js/
│   │       ├── main.js          # App bootstrap, session initialization, router mount
│   │       ├── router.js        # Guarded client-side routing, query state, role-based access
│   │       ├── session.js       # In-memory access token, Web Lock refresh coordination, BroadcastChannel
│   │       ├── api.js           # Envelope-parsing HTTP client, 401 refresh-and-retry, host check
│   │       ├── store.js         # Reactive in-memory state store with subscriber pattern
│   │       ├── i18n/
│   │       │   └── strings.en.js # Single source of truth for all English UI strings
│   │       ├── utils/
│   │       │   ├── dom.js       # Safe DOM builder h() with attribute allowlists & URL sanitization
│   │       │   ├── imageMath.js # Client-side image downscaling math (max 1280px, aspect-ratio preserving)
│   │       │   └── uploader.js  # EXIF-stripping HTML5 canvas redrawing & signed direct Cloudinary upload
│   │       ├── components/      # Pure, reusable UI components (DOM builder-based)
│   │       │   ├── AppHeader.js
│   │       │   ├── BottomNav.js
│   │       │   ├── Button.js
│   │       │   ├── ChoiceChip.js
│   │       │   ├── CompassBar.js
│   │       │   ├── DevBanner.js
│   │       │   ├── EmptyState.js
│   │       │   ├── ErrorState.js
│   │       │   ├── Field.js
│   │       │   ├── IndexTabs.js
│   │       │   ├── LedgerRule.js
│   │       │   ├── LocalityPicker.js
│   │       │   ├── NetworkBanner.js
│   │       │   ├── PasswordField.js
│   │       │   ├── RangeField.js
│   │       │   ├── SampleDataLabel.js
│   │       │   ├── Sheet.js
│   │       │   ├── SkeletonLine.js
│   │       │   ├── SkillPicker.js
│   │       │   ├── Stamp.js
│   │       │   ├── Toast.js
│   │       │   └── Wordmark.js
│   │       └── pages/           # Screen views mounted by router
│   │           ├── LoginPage.js
│   │           ├── SignupPage.js
│   │           ├── OnboardingPage.js
│   │           ├── AccountPage.js
│   │           ├── ChangePasswordPage.js
│   │           ├── WorkerHomePage.js
│   │           ├── CustomerFindPage.js
│   │           ├── PlaceholderPage.js
│   │           ├── NotFoundPage.js
│   │           └── HostMismatchPage.js
│   ├── server.js                # Express static server on port 3000 with per-request Helmet CSP
│   ├── serverUtils.js           # Server utilities (CSP builder, host validator, /config.js generator)
│   ├── 404.html                 # Static 404 page
│   ├── privacy.html             # Static privacy policy page
│   ├── terms.html               # Static terms of service page
│   └── grievance.html           # Static grievance redressal mechanism page
├── shared/                      # Isomorphic pure validation and calculation modules (M7 allowlist)
│   ├── validators.js
│   ├── passwordRules.js
│   ├── containsContactInfo.js
│   ├── profileRules.js
│   └── ...
└── scripts/
    ├── lint-tokens.js           # CI token linter and forbidden DOM sink detector
    ├── copy-fonts.js            # WOFF2 font extractor from @fontsource packages
    ├── doctor.js                # Environment, port, and dependency health checker
    └── setup.js                 # Complete project setup and initialization orchestrator
```

---

## 2. Safe DOM Construction & Forbidden Sink Rules

To eliminate Cross-Site Scripting (XSS) by architectural design:
- **Strictly Banned:** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval()`, `new Function()`, and inline `style="..."` attributes are strictly prohibited in `frontend/`.
- **Enforcement:** Banned sinks are rejected by both `npm run lint:tokens` in CI and unit tests in `tests/unit/lintTokens.test.js`.
- **Safe DOM Builder (`frontend/app/js/utils/dom.js`):**
  All dynamic DOM nodes must be created using the `h()` helper:
  ```javascript
  import { h, text } from './utils/dom.js';

  const element = h('button', {
    type: 'button',
    className: 'btn btn-primary',
    onClick: (e) => handleClick(e),
    'aria-label': 'Confirm action'
  }, 'Click me');
  ```
- **Attribute Allowlist:** `h()` validates attributes against an explicit allowlist (`id`, `class`, `type`, `href`, `src`, `alt`, `role`, `aria-*`, `data-*`, `disabled`, `readonly`, `value`, `placeholder`, `min`, `max`, `step`, etc.).
- **URL Sanitization:** `href` and `src` attributes are strictly checked. Any `javascript:`, `vbscript:`, or `data:` URLs (except approved data:image previews) throw an immediate security exception.
- **Event Listeners:** Properties prefixed with `on` (e.g. `onClick`, `onInput`) are bound directly via `addEventListener` and never through string attributes.

---

## 3. String Dictionary & Internationalization (`strings.en.js`)

**Zero literal UI strings** are permitted directly inside component files. Every label, button text, error message, placeholder, and heading must be referenced from `frontend/app/js/i18n/strings.en.js`.

### How to Add a New String
1. Open `frontend/app/js/i18n/strings.en.js`.
2. Locate the appropriate domain section (`common`, `auth`, `onboarding`, `account`, `nav`, etc.).
3. Add the key and its value:
   ```javascript
   export const STRINGS = {
     account: {
       deleteAccountButton: 'Delete Account',
       deleteConfirmMessage: 'Are you sure you want to delete your account? This action cannot be undone.',
     }
   };
   ```
4. Access the string in components via `t()` or directly:
   ```javascript
   import { t } from '../i18n/strings.en.js';
   const label = t('account.deleteAccountButton');
   ```

---

## 4. How to Add a Page and Register in the Router

Every page in WorkCred is an ES module that exports a render function:
```javascript
// frontend/app/js/pages/MyNewPage.js
import { h } from '../utils/dom.js';
import { t } from '../i18n/strings.en.js';

export function renderMyNewPage({ router, params, query }) {
  return h('div', { className: 'page page-my-new' },
    h('h1', {}, t('myPage.title')),
    h('p', {}, t('myPage.description'))
  );
}
```

### Registering in the Router (`frontend/app/js/router.js`):
1. Import the page render function in `router.js`.
2. Add a route definition to the internal routes table:
   ```javascript
   {
     pattern: /^\/app\/my-page$/,
     role: 'worker',          // 'public' | 'customer' | 'worker' | 'auth'
     requireComplete: true,   // true if requires completed onboarding profile
     layout: 'app',           // 'public' | 'app' | 'onboarding'
     activeTab: 'home',       // highlights corresponding bottom nav tab
     render: renderMyNewPage,
   }
   ```
3. The router automatically evaluates the decision pipeline in order:
   - Host match verification (`/app/host-mismatch`)
   - Authentication check (redirects to `/app/login` with `?redirect=...`)
   - Mandatory password change check (redirects to `/app/change-password`)
   - Role mismatch check (e.g. worker accessing customer view)
   - Onboarding completion check (redirects to `/app/onboarding`)

---

## 5. Component Catalog

| Component | File | Description & Purpose |
|---|---|---|
| **`AppHeader`** | `components/AppHeader.js` | Top shell navigation bar with brand wordmark, offline indicator, and role badge. |
| **`BottomNav`** | `components/BottomNav.js` | Mobile-first 4-item bottom navigation bar with active tab indicator and SVGs. |
| **`Button`** | `components/Button.js` | Primary, secondary, ghost, and danger buttons with loading states and focus-visible rings. |
| **`ChoiceChip`** | `components/ChoiceChip.js` | Single or multi-select chip for selecting skills, filters, and categories. |
| **`CompassBar`** | `components/CompassBar.js` | Fair Rate Compass price band visualizer showing median and 25th–75th percentiles. |
| **`DevBanner`** | `components/DevBanner.js` | Development-only quick account switcher bar populated by `/api/v1/demo/accounts`. |
| **`EmptyState`** | `components/EmptyState.js` | High-contrast empty state container with icon, message, and action CTA. |
| **`ErrorState`** | `components/ErrorState.js` | Error feedback box with retry button and sanitized error message. |
| **`Field`** | `components/Field.js` | Standard text/email/tel input with label, helper text, and accessible validation error. |
| **`IndexTabs`** | `components/IndexTabs.js` | Accessible tab strip implementing WAI-ARIA tabs pattern with keyboard navigation. |
| **`LedgerRule`** | `components/LedgerRule.js` | Subtle decorative dashed divider line honoring the 8px rhythm. |
| **`LocalityPicker`**| `components/LocalityPicker.js` | Locality selector backed by sanitized backend metadata (never leaking coordinates). |
| **`NetworkBanner`** | `components/NetworkBanner.js` | Sticky offline warning banner tracking window online/offline events. |
| **`PasswordField`** | `components/PasswordField.js` | Password input with toggleable show/hide password visibility icon. |
| **`RangeField`** | `components/RangeField.js` | Labeled dual/single range slider for radius (1–10 km) or rate filters. |
| **`SampleDataLabel`**| `components/SampleDataLabel.js`| Small subtle badge indicating sample/seed data records in UI. |
| **`Sheet`** | `components/Sheet.js` | Bottom sheet modal container with scrim overlay and swipe/close handling. |
| **`SkeletonLine`** | `components/SkeletonLine.js` | Loading skeleton placeholder line with pulse animation. |
| **`SkillPicker`** | `components/SkillPicker.js` | Grid of selectable skills with count cap enforcement (max 6 for workers). |
| **`Stamp`** | `components/Stamp.js` | Work Passport verification stamp with double-ring visual style. |
| **`Toast`** | `components/Toast.js` | Auto-dismissing notification toast anchored to bottom of viewport. |
| **`Wordmark`** | `components/Wordmark.js` | WorkCred brand wordmark with Newsreader serif typography. |

---

## 6. Design Token Rules & Linter Enforcement

All styling in WorkCred is strictly defined in `frontend/css/tokens.css`.
- **Approved Colors:** Only CSS variables defined in `tokens.css` may be used (`var(--brand)`, `var(--ink)`, `var(--paper)`, `var(--rule)`, `var(--accent)`, `var(--success)`, `var(--warn)`, `var(--danger)`).
- **Hardcoded Colors Banned:** Raw hex colors (`#...`), `rgb()`, `rgba()`, `hsl()` are prohibited in component styles.
- **8px Rhythm:** Spacing is strictly constrained to the 8px grid (`8px`, `16px`, `24px`, `32px`, `48px`, `64px`).
- **No Inline Styles:** Elements must not contain `style="..."` attributes.
- **Verification:** Run `npm run lint:tokens` to execute the token linter, which checks:
  1. Palette integrity against `DESIGN_SYSTEM.md`.
  2. Banned CSS rules (e.g. gradients, hardcoded colors).
  3. Banned DOM sinks (`innerHTML`, etc.).
  4. WCAG contrast ratios (all text colors >= 4.5:1 against their backgrounds).

---

## 7. Security Architecture & Specifications (Plain Language)

### M2: Safe DOM Construction
Every element is created via `document.createElement` using `frontend/app/js/utils/dom.js`. Untrusted data is always assigned to `textContent`, never parsed as HTML.

### M3: Dynamic Content Security Policy (CSP)
The frontend server (`frontend/server.js`) generates a cryptographic nonce on every HTTP request using `crypto.randomBytes(16)`.
- `default-src 'self'`
- `script-src 'self' 'nonce-...'` (No `'unsafe-inline'`, no `'unsafe-eval'`)
- `style-src 'self' 'nonce-...'`
- `connect-src 'self' http://localhost:4000 http://127.0.0.1:4000 https://api.cloudinary.com`
- `img-src 'self' data: https://res.cloudinary.com`
- `font-src 'self'` (Self-hosted fonts only; no Google Fonts or external CDN)
- `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`

### M4: Memory-Only Access Token
Access tokens (15-minute lifetime) are stored strictly in JavaScript variable memory (`frontend/app/js/session.js`). They are **never written** to `localStorage`, `sessionStorage`, `IndexedDB`, or cookies. Refresh tokens are stored in `HttpOnly`, `SameSite=Lax` cookies managed exclusively by the browser and backend.

### M5: Concurrency-Safe Refresh Token Rotation (Web Locks)
The backend enforces single-use refresh token rotation with immediate reuse detection. If two browser tabs attempt to refresh tokens simultaneously, the second would invalidate the session.
- To prevent this, `session.js` acquires a Web Lock (`navigator.locks.request("workcred-refresh")`) before initiating `POST /auth/refresh`.
- If Web Locks are unavailable, a short-lived lease in `localStorage` acts as a fallback.
- Once refreshed, the new token is broadcast across tabs via `BroadcastChannel("workcred-auth")`.

### M6: Single Host Enforcement
Browsers treat `localhost` and `127.0.0.1` as distinct origins with separate cookie jars. If a user visits `localhost:3000` but the API is on `127.0.0.1:4000`, cookies will not be sent, causing silent authentication failures.
- `frontend/server.js` validates incoming `Host` headers against `ALLOWED_HOSTS`.
- `frontend/app/js/api.js` verifies that the API host matches the frontend host.
- Any mismatch displays an explanatory `HostMismatchPage` guiding the user to the correct URL.

### M7: `/shared/` Directory Allowlist
The frontend server exposes the project root `/shared/` directory to the browser via an explicit allowlist in `frontend/server.js`. Only approved pure validation modules (`validators.js`, `passwordRules.js`, `containsContactInfo.js`, `profileRules.js`) can be downloaded. Sensitive or backend-only modules (such as `localities.js` containing exact GPS coordinates) return HTTP 404.
