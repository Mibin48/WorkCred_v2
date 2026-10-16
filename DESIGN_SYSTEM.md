# WorkCred Warm: Design System and UI Component Specification

**Product:** WorkCred ("Proof of work, work near you.")
**Version:** 2.1, aligned with Project Plan v3.1 (email login, 11 Oct 2026)
**Lives at:** `docs/DESIGN_SYSTEM.md`
**Scope:** Landing page and `/app`
**Type:** Visual and interaction specification. No implementation code.

---

## 0. What changed from v1

| Change | Why |
| --- | --- |
| Whole spec rebuilt around one idea: the **work ledger** (paper job card, ruled notebook, rubber stamp) | v1 was a good rulebook but had no personality of its own, so the result could drift toward a generic app |
| QR code, public passport link and A6 passport print **removed** | The plan is private by default: no public pages, QR, sharing or print card in this version |
| "Identity checked" badge **removed**, replaced by "Has verified history" | Phone numbers are not verified in this version. The old label claimed something the product does not do |
| Navigation renamed to match the plan (Customer: Find, Free Now, Post job, Bookings, Saved. Worker: Home, My work, Passport, Post, Me) | v1 invented tab names that did not exist in the plan |
| Added **notifications** components (bell, list, items) | In-app notifications are part of the build (phase N1) |
| Added **brand and logo** rules | Phase P1 |
| Weekly calendar changed from a grid to day rows | The plan sets one pattern per weekday (Off, Morning, Afternoon, Evening, Full day). A 7 by 5 grid is cramped at 390 px |
| Login and sign-up forms use **email**; phone is a contact field at sign-up | Plan v3.1 change |
| Integrity wording matches the plan: "History checked: Valid, N records" | One phrase across plan, UI and docs |
| Added a contrast notes table | Several approved colours fail AA as small text. Rules now say which pairs are safe |
| Added microcopy bank, "never do this" list and a stronger checklist | Keeps future sessions with the AI consistent |

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
| **Margin line** | A single vertical `--clay-border` line down the left of a list, with entries hanging off it, like a notebook margin | Passport timeline, booking timeline, notification list | Entry numbers (the record `seq`) sit in the margin in monospace |
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

| Colour | It means | It never means |
| --- | --- | --- |
| Clay | The next action. Brand moments | Error or danger |
| Moss | Verified, live, completed, success | A button for ordinary navigation |
| Ochre and warning | Needs care, expiring, sample data | Decoration |
| Error | Something failed or is irreversible | Mere emphasis |
| Info | Neutral facts, offline, "Low" rate band | Marketing highlight |
| Charcoal surface | The Passport, the footer, one emphasis band per page | Whole app screens |

### 2.4 Contrast notes (important)

Some approved colours are weak for small text. Follow this table.

| Pairing | Safe for | Not safe for |
| --- | --- | --- |
| `--surface` text on `--clay` | Primary button labels **only at the bold button size**, which counts as large text. Verify with the contrast check in the lint script | Small captions on a clay fill |
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

Rules:

- Every size comes from the `--text-*` scale. Body at least 16 px. Labels at least 13 px.
- Newsreader never appears in forms, dense instructions or small labels.
- One italic clay-text phrase per heading at most, and not on every heading.
- Sentence case everywhere. No all-caps labels except the 8-character Record ID.
- Numbers use Indian digit grouping (₹1,25,000). Times read "Today 4 PM". Distances read "about 1 km".
- Let text wrap. Never truncate anything the user needs to act on.

### 2.6 Spacing and shape

- 8 px rhythm. 4 px and 12 px only for optical alignment.
- Existing radii only. Buttons are pills. Inputs use the smaller, calmer radius so they feel like form fields, not buttons. Cards use the medium radius. The large hero radius is for the Passport card and landing feature surfaces only.
- Not every surface is round. Sections between rules have **no** radius. Tear-edge tickets are squared with notches.
- Hairline borders and tonal surface changes first. Shadows only on the floating tab bar, sheets, dialogs and the Passport card.

### 2.7 Motion

- Use the supplied durations and spring easing. Measured, not bouncy.
- Allowed: sheet slide, tab surface change, a one-time stamp "press" (opacity and scale settle) when integrity first loads, countdown ring, count-up of passport record number.
- Not allowed: looping pulses, shimmer on non-loading content, parallax, hover growth.
- Reduced motion: all of the above become instant. Final values stay readable. Scroll reveals are only attached after a working observer exists, and content is visible by default.

---

## 3. Layout and navigation

### 3.1 Frames

- App is designed at **390 px** wide. Above 600 px, the app sits in a centered phone-width surface over a `--linen` page. It never becomes a wide dashboard.
- The landing page may go wide, with an editorial layout. Its calls to action lead into the phone-width app.
- Respect safe areas top and bottom. Fixed actions clear soft keyboards and gesture bars.
- At 200% zoom: no horizontal scroll, no overlapping controls, every action reachable.
- Plan for 30% longer text. Nav labels, chips and sheets grow vertically.

### 3.2 Bottom navigation (floating pill)

Icon plus text label on every item. Active item: raised `--surface` pill shape inside the bar, bold label, `aria-current="page"`. Labels wrap to two lines rather than shrink.

| Role | Tabs (exact names) |
| --- | --- |
| Customer | **Find** · **Free now** · **Post job** · **Bookings** · **Saved** |
| Worker | **Home** · **My work** · **Passport** · **Post** · **Me** |

Customers have no Me tab. Their account lives behind an initials button at the right of the header (Account, change password, log out). Workers reach Account inside Me.

### 3.3 App header (every screen)

Left: page title in Newsreader, with one line of context beneath in Plus Jakarta Sans (locality or count). Right: the **NotificationBell**, then, for customers only, the account initials button. No more than one other high-priority action. Not every title is oversized: use the second-largest display token for top-level screens, smaller for sheets.

### 3.4 Landing page frame

Quiet top bar: wordmark, three links (How it works, For workers, For families), Log in as a ghost button, Sign up as the one primary button. Full section plan is in section 14.

---

## 4. Brand and logo

- **Wordmark:** "WorkCred" set in a Newsreader-style serif, with a small symbol beside it: a check mark whose long stroke continues into the corner of a folded paper (a passport corner). One path, so it works in one colour.
- **Colours:** `--charcoal` on light surfaces, `--cream` on charcoal, `--clay` only for the symbol on the landing hero and favicon. Never recolour outside tokens.
- **Sizes:** header wordmark at a comfortable text height; symbol-only below that. Clear space equal to the height of the "W" on every side. No stretching, outlines, shadows or rotation.
- **Placements:** app header on auth pages, landing top bar and hero, footer, favicon, PWA icons (192 and 512 px, plus a maskable version with safe padding), splash screen. In the logged-in app header the page title takes priority, so show the symbol only on the Home and Find screens.
- Brand assets are SVG. Colours come from the tokens listed above.

---

## 5. Core components

### 5.1 Buttons

| Type | Look | Use |
| --- | --- | --- |
| **Primary** | `--clay` fill, `--surface` bold label, pill, 48 px minimum height. Hover and pressed shift to `--clay-dark` | The single main action: Find workers, Send request, Start job, Confirm and finish |
| **Secondary** | `--surface` fill, `--border-strong` outline, `--charcoal` label | Important but not main: Change time, View booking |
| **Quiet** | No fill, `--clay-text` label, underline on hover and focus | Low emphasis, never for anything that costs money or discards work |
| **Danger** | `--error` outline and label on `--error-tint` (solid `--error` fill only inside a confirm sheet) | Cancel booking, Cancel job, Stop being free |

- One primary button per context. Labels are verb-led and specific. No "Submit".
- States: hover is a plain tone change. Focus is a visible ring using tokens and is distinct from hover. Disabled is clearly inactive yet readable, with a reason underneath when it is not obvious.
- Busy: keep width, show a small spinner and the label "Sending…", block double-submit, announce through a polite live region.

### 5.2 Fields and forms

- Visible label above every field. Placeholders are examples only ("e.g. 98765 43210").
- 48 px minimum height, `--surface` fill, hairline border, calm radius.
- Hint and error sit directly below and are linked to the control. Error state: `--error-tint` fill, `--error` border, icon, and a sentence that says what to do ("Enter a 10-digit number").
- Group related fields under a short subheading and a ledger rule. Do not put each field in its own card.
- Keep typed values after any error. Never clear a whole form.
- Email field (login and sign-up): email keyboard, lowercase, no auto-capitalise, label "Email", example "e.g. ravi@example.com". Phone field (sign-up and profile only, never used to log in): numeric keyboard, "+91" as fixed prefix text, hint "Customers can call you only after a booking is confirmed." Password field: show/hide button with a text label, plus the rules shown as a short checklist that ticks off in plain words (never colour alone).

### 5.3 Chips

- **Choice chips** (skill, time of day, hours): pill shape, selectable, `aria-pressed`. Selected chip uses `--clay-tint` fill, `--clay-text` label, `--clay-border` outline and a check icon.
- **Status badges** (read-only): rectangular with a small radius, an icon and text, semantic tint pairs. They are never tappable, and shape plus the lack of a hover state tells people so.
- Show the most useful options first, then "More". No walls of chips.

### 5.4 Surfaces

Cards are for things that belong together and carry an action. Elsewhere use rules.

| Surface | Look |
| --- | --- |
| **Profile surface** | `--surface` with hairline border. Identity first, rate and availability grouped, action at the bottom |
| **Ticket** | Squared corners with notches and a tear edge. Used for bookings, requests and receipts |
| **Editorial panel** | Large Newsreader heading, one short paragraph, one visual. No icon sitting above a paragraph |
| **Evidence panel** | `--cream` fill, rule on top, plain explanation, "How we check" link |
| **Row list** | Ruled rows with no boxes: timeline, settings, blocked dates, notifications |

### 5.5 Tabs (index tabs)

Notebook-divider style as defined in section 1.2. Inside one screen only (Bookings: Upcoming, Active, Done, My jobs. My work: Requests, Upcoming, Active, Done. Saved: Saved, Following). Row scrolls sideways when needed and keeps the active tab in view. Counts appear as text in the label, for example "Requests (2)".

### 5.6 Feedback states

- **Toast:** polite live region, stays long enough to read, one result sentence and at most one action ("Booking sent. View"). Never carries a critical decision.
- **Skeleton:** only while loading real content, shaped like the content, not the whole screen. Still when reduced motion is on.
- **Empty state:** a Newsreader sentence, one line saying why it is empty, one next action. Example: "No bookings yet. Your confirmed bookings will appear here." with "Find a worker".
- **Error state:** says what failed, keeps the user's work, offers Try again. A network failure, a form error and a booking conflict each read differently.
- **Offline banner:** `--info-tint`, says what still works. Never implies something was saved to the server before it was.

---

## 6. Discovery (customer)

### 6.1 Find screen

Top: label "What work do you need done?" over the search field, with a clear (×) button. Below it, a line showing locality with an Edit link, then one row of the four most-used skill chips and a "More filters" button. Results as a ruled list of WorkerRows (see 6.4), not a grid of cards. Filters live in the URL, so the back button works.

### 6.2 FilterSheet

Native dialog, bottom sheet on compact screens. Sections with visible headings: Skill, Distance (1 to 10 km), Rate, Minimum rating, Sort (Nearest, Top rated, Lowest price). Selected values are summarised in words at the top ("Electrician, within 5 km, ₹400 to ₹800"). Buttons: **Show workers** (primary) and **Reset** (quiet). Closing returns focus to the trigger and keeps the filters.

### 6.3 RangeSlider

Label and current range as text ("₹400 to ₹800 per day"). Two thumbs, each keyboard and touch operable and well separated. Paired with two numeric fields for exact values. The track alone never carries meaning.

### 6.4 WorkerRow (search result)

Answers five questions in order: who, what they do, can they take it, roughly what it costs, why trust it.

1. Photo or initials on a `--cream` circle, then **name** and **main skill** in plain words.
2. **Availability line:** "Free for 1 h 20 min" (with the small live dot as extra, never alone) or "Next free Tomorrow morning".
3. **About 1 km away.** Never exact.
4. **Rate with unit** (₹600 per day) followed by the Compass chip (Low, Fair or High, with icon and word).
5. Trust line: "Has verified history · 12 jobs · 4.6 rating" shown **only** when real data exists. Otherwise show "New on WorkCred".
6. Save control on the right, **View** as the action. Phone numbers and exact locations never appear.

Sample entries show a Sample label (section 12.1).

### 6.5 LocalityPicker

A short explanation first: "We use your area to show nearby work. It is approximate." Then a searchable list of localities and a "Use my location" button. The current choice reads as text with an Edit link. If location permission is declined, the list works on its own and the screen says so without blame.

### 6.6 Save control

A bookmark icon plus a text label ("Save" / "Saved"). Accessible names "Save worker" and "Remove saved worker". The row layout does not shift when the state changes. Undo appears in a toast.

---

## 7. Worker profile (customer view)

Order of content on the page:

1. Name, main skill, locality (approximate), rate with Compass chip.
2. **Action bar:** Book (primary), Save, Follow. Endorse appears only after a completed job in that skill. Report sits in an overflow menu.
3. Bio and skills (main skill marked in words).
4. **Work Passport preview:** the IntegrityStrip, then the visible timeline entries (section 10).
5. A seven-day availability line ("Mon morning, Tue off…") with a link to see more.
6. Endorsement counts per skill, in plain text.

Call button: appears only on a confirmed or in-progress booking, never on this page before then.

---

## 8. Booking and job lifecycle

### 8.1 Booking sheet

A stepper in words: **Day and time → Hours and note → Review**. Day chips, time chips, then an hours stepper (1 to 12). Unavailable slots are disabled with the text "Not available", not just greyed. Review shows the price summary and the CompassBar. Bottom: **Send request**. Copy after sending: "Request sent. Ravi will answer soon."

### 8.2 DayTimePicker

The chosen date and time are the biggest text ("Thursday, 16 Oct, 4 PM"). Blocked and busy times show labels. If nothing is free, offer "Try another day" with the nearest day pre-selected.

### 8.3 Stepper

Shows the step name and "Step 2 of 3" as text. Going back keeps entries. Each step validates before moving on and explains problems in place.

### 8.4 CompassBar and FairRateChip

- **Chip:** Low (info pair, down arrow), Fair (success pair, check), High (warning pair, up arrow). Always icon plus word.
- **Bar:** a short horizontal bar with the 25th to 75th percentile range as a filled band, the median as a tick with a label, and the entered rate as a marker with its value written beside it.
- **Caption (required):** "Most [skill] jobs near [locality] cost ₹X to ₹Y. This is a guide, not a rule." When data is thin: "Based on sample rates for now."
- No speedometers, no "best price" claims, no green for cheap.

### 8.5 PostJob form

One form in three groups with ledger rules between them: **What** (skill, workers needed, description), **When** (date, time, hours), **Pay and place** (rate per worker, location). The Fair Price card appears beside the rate field as soon as skill and area are known. Review step before sending. Success screen says how many nearby workers matched, only if the number is real.

### 8.6 BookingTicket

A ticket with a tear edge. Above the tear: job title and the status badge. Below: the date and time (largest), agreed rate, locality, other person's display name. The tear edge carries the next action, which changes with the state:

| State | Visible action |
| --- | --- |
| Pending | Customer: "Waiting for Ravi" and Cancel. Worker: Accept and Decline |
| Confirmed | Customer: "Show codes". Worker: "I've arrived" |
| In progress | Customer: "Finish job". Worker: timer and "Report a problem" |
| Completed | "View receipt" and "Passport entry" |
| Cancelled | Reason and who cancelled, no action except "Book again" |

### 8.7 CodeDisplay (customer only)

- Hidden by default as four dots. Button: "Show start code".
- When shown: four large monospace digits, a line explaining "Give this to Ravi when he arrives", and a visible countdown "Hides in 30 s" with a "Hide now" button.
- The finish code is shown in the same way and explained as "Give this to Ravi only when the work is done and you have paid."
- Never a copy button, never in a notification, never cached, never on a worker's screen.

### 8.8 StatusTimeline

Uses the margin line. Entries: Requested, Confirmed, Started, Finished, with date and time, an icon and a word. The current step is bold and the next pending step is outlined. If something needs action, name who must act ("Waiting for Ravi to answer").

### 8.9 ConfirmSheet

Summarises the action and what happens next before asking. Two clearly different buttons: primary confirm and a quiet "Go back". Destructive confirms state the consequence ("Cancel booking. Ravi will be told."). The destructive button never sits where a thumb lands by habit. Backdrop taps do not close it when there is input or the choice is consequential.

### 8.10 Finish sheet (customer)

Three steps: **Finish code** → **Paid cash** → **Rate**. Paid cash reads: "I paid ₹1,200 in cash." It is a statement from the customer, so the receipt calls it "Cash payment reported by customer", never "verified payment". Rating is 1 to 5 stars each with a text label, plus an optional comment (200 characters). Errors appear on the step they belong to. Wrong code message: "Wrong code. 3 tries left."

### 8.11 Receipt

A ticket with a tear edge and a ledger rule above the total. Contents in order: job and skill, date and times, hours, **cash amount in Newsreader at the largest size on the page**, "Cash payment reported by customer", rating if given, **Record ID** in monospace, the stamp, and a "View in Passport" link. Print styles in section 15.

### 8.12 HelpSheet

Answer first, then up to three steps, then one recovery action. Reassuring, factual, no blame ("The code didn't match. Check the digits with Ravi.").

---

## 9. Worker operations

### 9.1 FreeNowCard

A focused control, not a dashboard tile.

- **Idle:** headline "Free for work right now?", one line explaining that nearby customers will see you, three duration choices (**2 h**, **4 h**, **8 h**), and "You can stop any time."
- **Live:** remaining time is the biggest thing, written as "1 h 20 min left". A countdown ring sits beside it as support only. Buttons: **Extend** (up to 12 hours total, shows the remaining allowance) and **Stop**, separated with space between them.
- **Blocked:** when a job is in progress, the card says "You have a job in progress" and offers no duration choices.
- **Offline:** shows "No connection. Your last change may not have reached WorkCred."
- On expiry the card changes to idle straight away and never shows a stale "live" state.

### 9.2 Home screen order (worker)

Free now card, then **Needs your answer** (requests), then **Jobs near you**. Requests come first because they expire.

### 9.3 RequestTicket

A ticket showing who needs help, skill, when, approximate area, proposed rate and the response time. The tear edge holds **Accept** (primary) and **Decline** (secondary, not red). Missing information says "Not given".

### 9.4 JobRow (jobs near you)

Ruled rows: skill and pay first, then start time, "about 2 km away", "2 spots left". Tapping opens the job sheet with Accept job. A worker with a blocked date or an overlap sees a plain message instead of the button ("You are already booked at that time").

### 9.5 Start code sheet

Title "Enter the start code". One line: "Ask [customer] for the 4-digit code." Four large boxes, numeric keyboard, a label for the group, and "3 tries left" after a miss. Location is requested only here and explained first ("This helps show you arrived. You can continue without it."). A warning, not a block, if the position is far from the job. After five misses: "Too many tries. You can try again in 10 minutes."

### 9.6 Active job view

A calm screen: elapsed time as the main text, customer's display name, cash to collect, and a quiet "Report a problem" link. The Call button appears here because the booking is confirmed.

### 9.7 Completion sheet (worker)

"Job done. ₹1,200 earned." in Newsreader, then the new Record ID and a "View in Passport" button.

### 9.8 ReportSheet

Neutral start: "What happened?" Four to six issue choices, then an optional description (200 characters, no phone numbers or links). States that the report is private, goes to support and cannot be edited afterwards. Success text says only what is true: "Report sent. Support will review it." No reference number unless one exists.

### 9.9 Weekly availability (day rows)

Seven ruled rows, one per weekday. Each row shows the day and its current setting in words ("Monday · Morning"). Tapping a row opens a small sheet with five choices: **Off, Morning, Afternoon, Evening, Full day**. A "Same for all weekdays" action saves time. An UnsavedChangesNotice appears when anything changed. A one-line legend explains the times.

### 9.10 BlockedDatesList

Ruled rows: date, optional reason, Edit and Remove. Empty state: "No blocked dates. Add a day when you can't work." with "Block a date".

### 9.11 SkillPicker

A searchable list grouped plainly (Building and repair, Home and care, Food and transport, Other) covering: helper, electrician, plumber, mason, painter, carpenter, cook, cleaner, driver, vendor, other. Up to six. The main skill is chosen by a "Make main" action and labelled "Main skill" in words. Selected skills appear in a summary row above the list.

### 9.12 Rate editor

Rate per hour and per day fields, with the CompassBar underneath updating as the number changes, and the same caption as 8.4.

---

## 10. Work Passport and trust

### 10.1 PassportCard (worker's own and customer's preview)

The signature surface. `--charcoal` fill, `--cream` text, `--clay-light` for the section label, `--moss-bright` for the verified mark. Uses the large hero radius and a predictable inner grid.

Contents:
1. Worker's display name and main skill.
2. **Records:** the number in Newsreader at display size (counts up once, only if motion is allowed).
3. Jobs, hours and average rating, each labelled. Ratings only when they exist.
4. The stamp: "History checked: Valid, 12 records".
5. "How we check" link.

No QR code, no share, no public link, no phone number, no location.

### 10.2 IntegrityStrip and IntegrityBadge

| State | Words | Icon |
| --- | --- | --- |
| Valid | "History checked: Valid, 12 records" | Check |
| Needs attention | "History checked: Needs attention" | Alert triangle |
| Checking | "Checking history…" | Spinner (static dash if reduced motion) |
| Not enough data | "No records yet" | Dash |

Compact in profile and job views. The words "hash", "chain", "blockchain" and "crypto" never appear in the interface. The strip tells customers when private records are included ("2 private records are included in the check").

### 10.3 ChainVisual

Four small linked check markers, each labelled (Recorded, Linked, Checked, Matches). A line joins them. It is a static explanation, not a progress game. It must never suggest mathematical certainty or guaranteed job quality.

### 10.4 VerificationExplainerSheet ("How we check")

Three short steps:
1. **What we save.** When a job is finished with both codes, we save one record: skill, date, hours, rating.
2. **How we check.** Each record is tied to the one before it. If any saved record is changed or removed, the check shows "Needs attention".
3. **What this tells you.** The saved history has not been altered. It does **not** prove the worker's identity, check their references, or guarantee the quality of any job.

### 10.5 TimelineEntry

Hangs on the margin line. The entry number sits in the margin in monospace. Beside it: date, skill, hours, a one-line summary and the rating. The 8-character Record ID appears as quiet monospace text with a Copy button. Employer name is masked by default (for example "R*** K."). Long text wraps, with "View details" when it is long.

### 10.6 RecordVisibilityControl

For each entry and for the employer name: a switch with a visible label and an audience sentence, not an eye icon alone.
- "Customers can see this record. **On**"
- "Show employer name. **Off.** Customers see R*** K."
The change is explained before saving. Hidden records still count in the check, and the screen says so.

### 10.7 EntryDetailSheet

Title and date, then job details, display names, rating and comment, the history-check result, and "Original record" clearly separated from later changes to visibility. An evidence expansion ("Show check details") is collapsed by default and lists time-ordered events in plain English with the technical identifiers in monospace beside them.

### 10.8 Reporting a record

Same neutral language as the job report. States clearly that the report is private and that the entry stays visible while support reviews it, if that is what happens.

---

## 11. Feed, posts and notifications

### 11.1 WorkPostCard

Leads with the photo: one large photo, or a before and after pair side by side. Caption (140 characters) wraps fully. "Verified job" badge only when the post is linked to a completed booking. Actions: Follow, Save, Report (overflow). No likes, no comments, no chat. Sample posts are labelled.

### 11.2 FreeWorkerRow

Small live dot plus the words "Free for 1 h 20 min", skill, about how far, rate, and **Book now** when the booking rules allow it. When the window ends the row says "No longer free" and the button disables.

### 11.3 ImageViewer

Native dialog. Visible close button, a useful image description, simple zoom (none if reduced motion). No social controls.

### 11.4 NotificationBell (new)

Sits in the app header. A bell icon with a visible text count beside or on it (for example 3, and "9+" above nine). Its accessible name includes the count ("Notifications, 3 unread"). When there are none, no count is drawn. New arrivals update the count and are announced politely.

### 11.5 Notifications page (new)

Header: "Notifications", with **Mark all as read** on the right. A ruled list on the margin line, newest first, grouped under quiet headings (Today, Earlier). Cursor pagination with a "Show more" button, not an invisible endless scroll.

### 11.6 NotificationItem (new)

- Icon for the type (request, confirmed, started, finished, cancelled), a one-line plain title, a short body and a relative time ("2 h ago").
- **Unread:** bold title, a filled clay dot at the margin and the hidden text "Unread". **Read:** regular weight, no dot.
- Tapping opens the related booking or job and marks it read.
- Text never contains codes, phone numbers or locations.
- Empty state: "Nothing new. We'll tell you here when something happens to a booking or job."
- Offline: shows "Saved copy from 4:10 PM" at the top.

---

## 12. Honesty components

### 12.1 SampleDataLabel

A small rectangular `--ochre-tint` label with `--warning` text and a pencil icon: "Sample". It stays attached to every illustrative name, rate, rating, job count, post and receipt, wherever it appears (landing page, seeded demo accounts, screenshots). It is the same size as the data it qualifies, never louder.

### 12.2 TrustDetailPopover

Tap-triggered (never hover only), keyboard accessible. Attached to any verification label. Answers what was checked, when, and what it means. On phones it becomes a small sheet.

### 12.3 Language rules for trust

- "Has verified history" means the records pass the history check. Say that.
- Do not call anyone "safe", "trusted" or "verified identity".
- Cash payment is "reported by customer". The product never says "payment verified" or "paid online".

---

## 13. Offline, install and resilience

- **InstallBanner:** a quiet strip after the second visit, never during login or code entry, dismissible, with the real benefit: "Add WorkCred to your phone. Opens faster and works with a weak signal." Not repeated right after dismissal.
- **SavedCopyBanner:** `--info-tint` strip: "Saved copy from 4:10 PM. Some actions need a connection." Cached data is never presented as live.
- **NetworkStatePanel:** shown in forms and pending actions when connection matters. Separates "Saved on this phone" from "Sent to WorkCred". Lists what still works.
- **UnsavedChangesNotice:** an inline `--ochre-tint` note with Save and Discard. Leaving the page asks first and keeps the input.
- **UpdateAvailableNotice** (and the service worker update toast): never interrupts a form, booking or live job. "A new version is ready. Update when you finish this." with an Update button. Says plainly if a refresh is needed.
- **DataSaverNotice:** appears once when data saver is on: "Photos load only when you tap them."
- **Queued actions** (save and follow only): labelled "Waiting to send", then a clear result when the connection returns.
- Booking codes are never cached.

---

## 14. Landing page composition

Content is visible without JavaScript. Reveal-on-scroll is added only after a working observer exists.

| Section | Composition |
| --- | --- |
| **Top bar** | Wordmark, three links, Log in (quiet), Sign up (primary) |
| **Opening** | Wide screens: text on the left, a worker and a Passport on the right. Headline "Proof of work, work near you." in Newsreader, with **one** italic clay-text word and the pencil underline. One plain sentence. Primary: **I want work**. Secondary: **I need a worker** |
| **Hero object** | A real-feeling Passport card, slightly overlapping a candid worker photo, with a Free now chip. Everything on it carries a Sample label. No floating glass, no stacked dashboards |
| **The problem** | A full-width statement in Newsreader on `--linen`: a worker's reputation lives in one person's memory. No card |
| **How it works** | Three numbered steps in a single horizontal run (vertical on phones), separated by ledger rules: Post or find a job. Meet and enter the start code. Finish and get paid in cash while the record is added |
| **Work Passport** | Charcoal band. On the left: short explanation and the limits of the check. On the right: a sample timeline on the margin line with the stamp |
| **What's inside** | An uneven arrangement, not a grid of four equal cards: Fair Rate Compass as the large piece, Free now and Handshake codes as two medium pieces beside it, Nearby feed as a small strip below |
| **Two sides** | Two panels composed differently. Workers: a tall panel with a short list of what they keep (their history, their hours, their choice of what is shown). Customers: a wide panel built around a booking ticket preview showing codes, rate guide and the receipt |
| **Closing** | One sentence, one primary button |
| **Footer** | `--charcoal` surface with `--cream` text. Links: How it works, Privacy, Terms, Grievance, Contact. Hairline separators. Small and practical |

No fake numbers, no quotes, no "trusted by". Where a real product screen is needed and no real data exists, use a labelled sample.

---

## 15. Print

Only the **receipt** has a print layout in this version (the plan has no print card, share link or QR). Hide navigation, buttons, tabs and toasts. Keep job, date, hours, cash amount, "Cash payment reported by customer", rating, Record ID and the history-check words. Same tokens and fonts; no print-only colours. Every state is understandable in black and white because it is written in words. Keep the receipt on one page.

---

## 16. Dialogs and sheets

- Native dialog behaviour. Bottom sheet on compact screens, with a title, a visible close button and a drag handle that is decorative only.
- One purpose per dialog. No dialog inside a dialog.
- Focus trapped inside, returned to the trigger on close. Title takes focus on open.
- Long content scrolls in the body while main actions stay reachable.
- Usable at 200% zoom and short screens.
- Clicking outside does not close a sheet that has input or a consequential choice.

---

## 17. Writing

### 17.1 Voice

Direct, respectful, local. Like a good shopkeeper: short sentences, nothing fancy, no blaming.

### 17.2 One word per idea

| Say | Not |
| --- | --- |
| Booking (a request or confirmed visit) | Reservation, appointment, order |
| Job (work a customer posts) | Task, gig, listing |
| Passport (worker's history) | Profile card, wallet, ID |
| History check | Verification score, blockchain check |
| Cash payment reported | Paid online, payment verified |
| Free now | Online, active, available (as a status) |

### 17.3 Microcopy bank

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

## 18. Accessibility and responsive behaviour

- Semantic landmarks, headings, lists, buttons and links.
- Every control has a persistent label. Hints and errors are linked to controls.
- Correct states for tabs (selected), chips (pressed), switches (checked), dialogs (modal), busy and status.
- Focus moves to the page heading after each route change, without resetting a multi-step flow.
- Polite live region for toasts, notifications, Free now countdown milestones and booking updates. The countdown announces at set points, not every second.
- 48 px tap targets. Pairs such as Accept and Decline are well separated.
- Nothing needs hover. Nothing is conveyed by colour alone.
- Respects reduced motion and data saver. Works at 200% zoom and 30% longer text. WCAG AA contrast per section 2.4.
- Informative images have alt text. Decorative images are hidden from assistive technology.

---

## 19. Privacy rules in the interface

- No phone numbers or exact locations on any list, profile or Passport.
- The Call button and exact job location appear only after a booking is confirmed.
- Codes: customer only, hidden until tapped, auto-hide after 30 seconds, never cached or shown in a notification.
- Employer names are masked by default.
- Every public or private setting names its audience.
- Reports and dispute notes stay private to support.

---

## 20. Never do this

1. Never show a rating, job count or review that is not real or not labelled Sample.
2. Never use "verified" for identity. Phone numbers are not verified.
3. Never show the words hash, chain, blockchain or crypto to users.
4. Never put a QR code, share button or public link in the product.
5. Never cache or copy booking codes.
6. Never use more than one primary button in the same context.
7. Never use clay or ochre as small text colour.
8. Never rely on colour alone for a state.
9. Never add a new hex value, font size or shadow.
10. Never repeat the same card three times in a row as the page's answer to everything.

---

## 21. Final checklist (per component, per phase)

**Look**
- [ ] Only tokens from section 2.2 are used; `npm run lint:tokens` passes and every variable used is defined.
- [ ] Only Newsreader, Plus Jakarta Sans or the supplied monospace is used, sizes from the `--text-*` scale.
- [ ] At most one signature device of each kind per screen, and not on every screen.
- [ ] Large areas vary in composition. No page is a column of identical cards.
- [ ] Sample data carries the Sample label.

**State**
- [ ] Loading, empty, offline, disabled, success, warning, error and history-check states all have words.
- [ ] Queued, cached, saved and sent are never confused.
- [ ] Async buttons prevent double-submit and announce progress.

**Access**
- [ ] Keyboard-operable with visible focus.
- [ ] Persistent labels, linked hints and errors.
- [ ] Dialogs trap and restore focus, usable at 200% zoom.
- [ ] 48 px targets. Reduced motion respected.
- [ ] Contrast rules in section 2.4 followed.

**Trust and privacy**
- [ ] No phone, exact location or codes outside their allowed moments.
- [ ] Verification wording says what was checked and what it does not prove.
- [ ] Cash is described as "reported by customer".
- [ ] No claim anywhere that the build does not make true.

**Layout**
- [ ] Checked at 320, 375, 390 and 768 px.
- [ ] Bottom bar clear of safe areas and the keyboard.
- [ ] Tab labels expand to two lines when needed.

---

## 22. The intended result

A person opens WorkCred and feels they are holding something real: a clean paper record, a stamped line in a ledger, a ticket with a tear edge. Clay says "do this next". Moss says "this checked out". Ochre says "take care". Plain words and unhurried layouts do the rest. Nothing sparkles, nothing is fake, and every screen could only belong to this product.
