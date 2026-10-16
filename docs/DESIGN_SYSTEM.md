# WorkCred Warm: Design System and UI Component Specification

**Product:** WorkCred ("Proof of work, work near you.")
**Version:** 2.2, aligned with Project Plan v3.2 (16 Oct 2026)
**Lives at:** `docs/DESIGN_SYSTEM.md`
**Scope:** Landing page and `/app`
**Type:** Visual and interaction specification. No implementation code.

---

## 0. What changed from v2.1 to v2.2

| Change | Why |
| --- | --- |
| Auxiliary messaging components **completely removed** (header alert icons, alerts page, alert items) | MVP scope reduction: booking lists and live Socket.io updates cover actionable events directly without an inbox collection |
| App Header: workers show no icons on the right; customers show initials account button only | No secondary icons in the header |
| Tabs carry plain text actionable counts (e.g., worker `My work (2)`, customer `Bookings (1)`) | Direct count of pending actions derived from list queries |
| Navigation names finalized: Customer (`Find`, `Free now`, `Post job`, `Bookings`, `Saved`), Worker (`Home`, `My work`, `Passport`, `Post`, `Me`) | Aligns with Plan v3.2 and Section 3.2 |
| Added contact info blocking specification (`containsContactInfo`) | Protects user privacy and enforces on-platform trust handshake |
| Verified email login and non-unique required phone number in all form microcopy | Strict alignment with Decision B |

---

## 1. Creative direction

### 1.1 The idea

WorkCred should feel like something a local shop would keep on the counter: a **well-kept ledger**. Think of the paper job card a plumber tears off a pad, the stamped line in a register, the receipt with a perforated edge, the noticeboard outside a tea stall. It is not a dashboard, not a wallet, not a startup template.

The personality is **grounded, capable, a little proud of good work.** It is useful before it is clever. It speaks plainly, and it never shouts.

### 1.2 The six signature devices

These are the details that make the product recognisable. Use them with restraint. Each has one job. Together they replace decoration.

| Device | What it looks like | Where it appears | Rule |
| --- | --- | --- | --- |
| **Ledger rule** | A pair of hairlines: `--border` over `--border-strong`, close together | Between sections, above totals, under page headers | Replaces boxes. If a group can be separated with a rule, do not wrap it in a card |
| **The stamp** | A rectangular mark with a 2 px `--moss` border, `--moss-tint` fill, an icon and the words "History checked". Sits at a very slight fixed tilt (about 2 degrees) | Passport card, receipt, worker profile integrity strip | Used only for verified history. Static, never animated, never more than one per screen |
| **Margin line** | A single vertical `--clay-border` line down the left of a list, with entries hanging off it, like a notebook margin | Passport timeline, booking timeline | Entry numbers (the record `seq`) sit in the margin in monospace |
| **Tear edge** | A dashed hairline with half-round notches at both ends | Receipt, booking ticket, "Needs your answer" request | One per surface. Marks the line where the action area begins |
| **Index tabs** | Tabs that look like notebook dividers: the active tab joins the content surface below it, inactive tabs sit slightly lower on `--linen` | Bookings, My work, Saved, Passport views | Active state is surface plus bold text plus `aria-current` or selected state, never colour alone |
| **Pencil underline** | One slightly uneven clay underline drawn under the single italic word in a landing heading. An illustration asset, not a CSS effect | Landing hero only | Appears once on the whole site. Not repeated in the app |

### 1.3 Principles

1. **People and work first.** Names, skills, availability and finished work get the space. Trust information is present, not plastered on.
2. **Editorial, not templated.** A strong heading, short copy, one purposeful visual per section. No row of three identical cards, repeated down a page.
3. **Warmth from material and rhythm.** Paper, linen, cream and clay. Variety comes from scale, alignment, rules and whitespace, never from extra colours.
4. **Proof, not hype.** No invented statistics, reviews, ratings, job counts or testimonials. Anything illustrative is labelled **Sample**.
5. **Plain words.** "Free until 4:30 PM", not "Active status". Verification is explained in everyday terms and never oversold.
6. **Function before ornament.** If a detail does not help someone scan, compare, decide or finish, remove it.
7. **Quiet confidence.** Motion clarifies change. It never decorates.

### 1.4 What to avoid (the "made by AI" tells)

Do not use: floating glass cards, blur, glow, gradients, decorative blobs, a hero made of stacked rounded dashboards, a grid of identical icon-above-paragraph cards, "supercharge" or "seamless" style copy, emoji in headings, gradient text, centered everything, three-badge rows under every title, or pill shapes on every surface. If a screen could belong to any app with the logo swapped, it is not finished.

Instead, prefer: left-aligned text, uneven but intentional columns, rules instead of boxes, real-feeling content, one confident serif heading per screen, and white space that is a decision.

---

## 2. Design system rules

### 2.1 Source of truth

`frontend/css/tokens.css` is the only place for colour, type, spacing, shape, shadow, layering and motion values. Components reuse tokens. No new hex values, font families, literal font sizes or ad hoc shadows. The token lint script (`npm run lint:tokens`) runs before every phase is accepted, and every variable used must be defined.

### 2.2 Approved palette (unchanged)

| Purpose | Token | Value |
| --- | --- | --- |
| Primary brand | `--clay` | #c85a32 |
| Deep brand, brand text | `--clay-dark`, `--clay-text` | #9f3c16 |
| Brand tint, border | `--clay-tint`, `--clay-border` | #f9ece6, #eccdc0 |
| Soft brand accent | `--clay-light` | #f0a27f |
| Trust green | `--moss` | #2a5a3b |
| Deep trust green | `--moss-light` | #386848 |
| Trust tint, border | `--moss-tint`, `--moss-border` | #e2efe6, #b8dac2 |
| Bright green accent | `--moss-bright` | #7ecf99 |
| Warm yellow | `--ochre` | #d49b35 |
| Yellow tint, border | `--ochre-tint`, `--ochre-border` | #faf3e4, #f0deb4 |
| Main ink | `--charcoal` | #23201e |
| Soft ink | `--charcoal-soft` | #2d2724 |
| Body text | `--stone` | #5c544e |
| Secondary text | `--stone-dark` | #514943 |
| Muted text | `--river` | #8a7e74 |
| Page surface | `--paper` | #faf7f2 |
| White surface | `--surface` | #ffffff |
| Warm surfaces | `--linen`, `--cream`, `--cream-deep`, `--parchment` | #f3efe6, #f4f0ea, #eee8df, #e9e2d5 |
| Borders | `--border`, `--border-strong` | #ddd5c5, #ccc3b3 |
| Success | `--success`, `--success-tint` | #2a5a3b, #e2efe6 |
| Warning | `--warning`, `--warning-tint` | #815300, #faf3e4 |
| Error | `--error`, `--error-tint` | #ba1a1a, #ffdad6 |
| Information | `--info`, `--info-tint` | #365c70, #e8f0f2 |

No gradients. No transparent colour variants. No extra palette values.

### 2.3 Colour roles (how much of what)

Roughly: **70% neutrals** (paper, linen, cream, surface), **15% ink** (charcoal and stone for text, plus the dark Passport and footer surfaces), **10% clay**, **5% moss and ochre**. If clay is everywhere, it stops meaning "do this".

### 2.4 Contrast notes

| Pairing | Safe for | Not safe for |
| --- | --- | --- |
| `--surface` text on `--clay` | Primary button labels **only at the bold button size** | Small captions on a clay fill |
| `--clay` text on paper or surface | Icons, rules, large decorative text (the italic heading word) | Body or small label text. Use `--clay-text` (#9f3c16) for any clay-coloured small text |
| `--river` on paper | Disabled labels, timestamps next to stronger text, placeholder examples | Anything the user must read to act. About 3.8 to 1 |
| `--ochre` as text | Nothing. Use as a border or icon fill only | All text. Use `--warning` (#815300) for text on `--warning-tint` |
| `--moss-bright` | Text and icons **on charcoal** surfaces | Text on light surfaces |
| `--clay-light` | Text and icons on charcoal | Text on light surfaces |
| `--stone`, `--stone-dark`, `--charcoal` | All body and label text on paper, linen, cream, surface | |
| `--moss` text on `--moss-tint` | Success and verified text | |

### 2.5 Typography

| Role | Face | Where |
| --- | --- | --- |
| Display and editorial | Newsreader (Georgia fallback) | Page titles, landing headings, short statements, receipt total, empty-state headlines |
| Body and interface | Plus Jakarta Sans (system fallback) | Everything else: nav, forms, labels, lists, data |
| Identifiers | Supplied system monospace | Record ID, entry number, start and finish code boxes, timestamps in audits |

---

## 3. Layout and navigation

### 3.1 Frames

- App is designed at **390 px** wide. Above 600 px, the app sits in a centered phone-width surface over a `--linen` page. It never becomes a wide dashboard.
- The landing page may go wide, with an editorial layout. Its calls to action lead into the phone-width app.
- Respect safe areas top and bottom. Fixed actions clear soft keyboards and gesture bars.
- At 200% zoom: no horizontal scroll, no overlapping controls, every action reachable.
- Plan for 30% longer text. Nav labels, chips and sheets grow vertically.

### 3.2 Bottom navigation (floating pill)

Icon plus text label on every item. Active item: raised `--surface` pill shape inside the bar, bold label, `aria-current="page"`. Labels wrap to two lines rather than shrink. Actionable counts are displayed directly in the label text when positive.

| Role | Tabs (exact names) | Actionable Count Display |
| --- | --- | --- |
| Customer | **Find** · **Free now** · **Post job** · **Bookings** · **Saved** | `Bookings (1)` when an active booking requires start/finish code action |
| Worker | **Home** · **My work** · **Passport** · **Post** · **Me** | `My work (2)` when pending booking requests require response |

Customers have no Me tab. Their account lives behind an initials button at the right of the header (Account, change password, log out). Workers reach Account inside Me.

### 3.3 App header (every screen)

- **Left:** page title in Newsreader, with one line of context beneath in Plus Jakarta Sans (locality or count).
- **Right:**
  - For **customers:** account initials button (leads to account details, change password, logout).
- No alerts or action icons appear on the right for workers.

---

## 4. Brand and logo

- **Wordmark:** "WorkCred" set in a Newsreader-style serif, with a small symbol beside it: a check mark whose long stroke continues into the corner of a folded paper (a passport corner). One path, so it works in one colour.
- **Colours:** `--charcoal` on light surfaces, `--cream` on charcoal, `--clay` only for the symbol on the landing hero and favicon. Never recolour outside tokens.
- **Placements:** app header on auth pages, landing top bar and hero, footer, favicon, PWA icons (192 and 512 px, plus a maskable version with safe padding), splash screen. In the logged-in app header the page title takes priority, so show the symbol only on the Home and Find screens.

---

## 5. Core components

### 5.1 Buttons

| Type | Look | Use |
| --- | --- | --- |
| **Primary** | `--clay` fill, `--surface` bold label, pill, 48 px minimum height. Hover and pressed shift to `--clay-dark` | The single main action: Find workers, Send request, Start job, Confirm and finish |
| **Secondary** | `--surface` fill, `--border-strong` outline, `--charcoal` label | Important but not main: Change time, View booking |
| **Quiet** | No fill, `--clay-text` label, underline on hover and focus | Low emphasis, never for anything that costs money or discards work |
| **Danger** | `--error` outline and label on `--error-tint` (solid `--error` fill only inside a confirm sheet) | Cancel booking, Cancel job, Stop being free |

### 5.2 Fields and forms

- Visible label above every field. Placeholders are examples only ("e.g. 98765 43210").
- 48 px minimum height, `--surface` fill, hairline border, calm radius.
- Email field (login and sign-up): email keyboard, lowercase, no auto-capitalise, label "Email", example "e.g. ravi@example.com".
- Phone field (sign-up and profile only, never used to log in): numeric keyboard, "+91" as fixed prefix text, hint "Customers can call you only after a booking is confirmed."
- Password field: show/hide button with a text label, plus the rules shown as a short checklist that ticks off in plain words.

### 5.3 Chips & 5.4 Surfaces

Cards are for things that belong together and carry an action. Elsewhere use rules.
- **Profile surface:** `--surface` with hairline border.
- **Ticket:** Squared corners with notches and a tear edge. Used for bookings, requests and receipts.
- **Row list:** Ruled rows with no boxes: timeline, settings, blocked dates.

---

## 6. Discovery (customer)

### 6.1 Find screen & 6.2 FilterSheet
Search by skill, distance (1 to 10 km), rate, and minimum rating. Sort by nearest, top rated, or lowest price. Ruled list of WorkerRows. LocalityPicker with approximate centroid display.

---

## 7. Worker profile (customer view)

Bio, skills, approximate locality, rate with Compass chip, action bar (Book, Save, Follow, Endorse), Work Passport preview with integrity check strip, and 7-day availability summary. Call button appears **only** on confirmed or in-progress bookings.

---

## 8. Booking and job lifecycle

- **BookingSheet & Stepper:** Day & time, hours, note, review with Fair Rate Compass bar.
- **CodeDisplay (Customer only):** Start and finish codes (hidden until tapped, 30-second auto-hide countdown, never cached).
- **FinishSheet:** Finish code entry, "I paid cash" confirmation, and 1 to 5 star rating.
- **Receipt:** Detailed breakdown with tear edge, cash amount in Newsreader, "Cash payment reported by customer", Record ID, and integrity stamp.

---

## 9. Worker operations

- **FreeNowCard:** Idle (2h, 4h, 8h choices), Live (countdown, Extend, Stop), Blocked (when job in progress).
- **Home screen:** Free now card, then **Needs your answer** (pending requests), then **Jobs near you**.
- **Weekly availability:** Seven weekday rows opening a choice sheet for Off, Morning, Afternoon, Evening, Full day per section 9.9.

---

## 10. Work Passport and trust

- **PassportCard:** Signature `--charcoal` hero surface with gold/cream text, verified record count, job stats, and "History checked: Valid, N records" stamp.
- **IntegrityStrip:** Reports valid or needs attention state without technical jargon.
- **TimelineEntry:** Append-only work entries hanging off the margin line with masked employer names and Record IDs.

---

## 11. Feed and posts

- **WorkPostCard:** Before/after work photos, 140-char caption (contact info blocked), "Verified job" badge when linked to completed job.
- **FreeWorkerRow:** Live dot, minutes remaining, distance, rate, and Book now action.

---

## 12. Honesty components & Language rules

- **SampleDataLabel:** Small `--ochre-tint` badge with pencil icon: "Sample", attached to all mock/sample data.
- "Has verified history" means the tamper-evident check passed. Never say "verified identity" or "guaranteed work".

---

## 13. Offline, install and resilience

- **SavedCopyBanner:** `--info-tint` strip: "Saved copy from {time}. Some actions need a connection."
- App shell precached via service worker. Handshake codes are never stored in cache or IndexedDB.

---

## 14. Landing page composition

Clean editorial layout: Top bar, Hero with candid photo and sample Passport card, Problem statement, 3-step How It Works, Work Passport section, Bento feature grid, Two Sides, Closing, and Footer.

---

## 15. Microcopy bank

| Moment | Copy |
| --- | --- |
| Wrong role at login | "This email is registered as a worker. Choose the Worker tab." |
| Wrong code | "Wrong code. 3 tries left." |
| Locked | "Too many tries. Try again in 10 minutes." |
| Booking sent | "Request sent. We'll tell you when Ravi answers." |
| Booking confirmed | "Ravi confirmed. Your codes are in the booking." |
| Offline action | "This needs a connection. Try again when you're online." |
| Password reset | "Forgot your password? Ask support to reset it. Self-service reset by email is coming later." |
| Wrong email or password | "Email or password is wrong." |
| Email already used | "This email is already registered. Try logging in." |
| Free now stopped | "You're no longer showing as free." |
| Empty feed | "Nothing nearby yet. Check again soon." |
| Integrity valid | "History checked: Valid, 12 records" |
| Cash paid | "I paid ₹1,200 in cash." |

---

## 16. Never do this

1. Never show a rating, job count or review that is not real or not labelled Sample.
2. Never use "verified" for identity. Phone numbers are not verified.
3. Never show the words hash, chain, blockchain or crypto to users.
4. Never put a QR code, share button, public link, or header alert icon in the product.
5. Never cache or copy booking codes.
6. Never use more than one primary button in the same context.
7. Never use clay or ochre as small text colour.
8. Never rely on colour alone for a state.
9. Never add a new hex value, font size or shadow outside tokens.
10. Never repeat the same card three times in a row as the page's answer to everything.
