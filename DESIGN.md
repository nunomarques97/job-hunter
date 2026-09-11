# DESIGN.md — Job Hunter

The visual identity of the Job Hunter desktop application. Every UI change follows this
file. Where this file and a screenshot disagree, this file wins.

Direction: **Midnight Command** — a dense, dark, violet-accented operations console.
Chosen by the Sponsor and supplied as `mock.png`, which is the reference render.
All tokens below were sampled from that image, not invented.

---

## 1. Colour roles

Dark is the only theme. There is no light theme and none is planned; the app is a
night-shift command centre and a light variant would dilute the identity.

### Surfaces

| Token | Value | Role |
|---|---|---|
| `--bg-app` | `#0B111A` | Application canvas, behind everything |
| `--bg-rail` | `#161B2B` | Left navigation rail |
| `--bg-chrome` | `#0F1522` | Title bar and top command bar |
| `--surface-1` | `#141B27` | Cards, panels, the default raised surface |
| `--surface-2` | `#192130` | Rows inside a card, hover state of `surface-1` |
| `--surface-3` | `#20293A` | Pressed state, active row, input field fill |
| `--overlay` | `#070B12` @ 72% | Behind modals and command palette |

### Lines

| Token | Value | Role |
|---|---|---|
| `--border` | `#1B222F` | Default 1px hairline on cards and dividers |
| `--border-strong` | `#28324A` | Input borders, table headers, anything that must read as a boundary |
| `--border-focus` | `#5F44ED` | Focus ring, 2px, always paired with a 2px offset |

### Text

| Token | Value | Role |
|---|---|---|
| `--text-primary` | `#EEF2F9` | Headings, values, primary labels |
| `--text-secondary` | `#9BA6BD` | Supporting copy, column headers, metadata |
| `--text-muted` | `#63718C` | Timestamps, counts, placeholder, disabled |
| `--text-inverse` | `#0B111A` | Text on an accent or status fill |

### Accent

| Token | Value | Role |
|---|---|---|
| `--accent` | `#5F44ED` | Primary action. One per screen region, never two competing |
| `--accent-hover` | `#7059F2` | Hover |
| `--accent-press` | `#4A33D6` | Active |
| `--accent-soft` | `#3F2C92` | Selected nav item, selected row |
| `--accent-ghost` | `#5F44ED` @ 14% | Tinted background for secondary accent chips |

### Status

Status colour is never the only carrier of meaning. Every status pairs a colour with a
label, and pipeline columns additionally carry a shape (the dot).

| Token | Fill | Tint background | Meaning |
|---|---|---|---|
| `--status-success` | `#47BB68` | `#163732` | Offer, healthy, submitted, strong match |
| `--status-info` | `#4170EF` | `#132440` | Applied, running, in progress |
| `--status-warn` | `#F7B650` | `#2E2415` | Screening, action required, near a limit |
| `--status-danger` | `#F64955` | `#33171C` | Rejected, failed, emergency stop |
| `--status-neutral` | `#63718C` | `#1B2230` | Closed, archived, unknown |
| `--status-pipeline` | `#6953D3` | `#211C42` | Discovered, interested, unprocessed |

### Match score scale

Match score is the most repeated number in the product, so it gets its own ramp.
The weak band is lighter than `--status-neutral` because it sits on a tinted
background at 11.5px, where the neutral grey falls below 4.5:1.

| Range | Colour | Tint |
|---|---|---|
| 85–100 | `#47BB68` | `#163732` |
| 70–84 | `#4170EF` | `#132440` |
| 55–69 | `#F7B650` | `#2E2415` |
| 0–54 | `#8C9AB4` | `#1B2230` |

---

## 2. Type

Two faces. No third.

- **UI / everything**: `Inter`, variable, fallback `Segoe UI Variable Text, Segoe UI, system-ui, sans-serif`. Shipped with the app, never fetched at runtime.
- **Numeric / code / identifiers**: `JetBrains Mono`, fallback `Cascadia Mono, Consolas, monospace`. Used for match scores, salary figures, counts in tables, job IDs, log lines. Tabular figures everywhere numbers stack in a column.

| Step | Size / line-height | Weight | Letter-spacing | Use |
|---|---|---|---|---|
| `display` | 28 / 34 | 650 | −0.02em | Greeting on the dashboard only |
| `h1` | 22 / 28 | 620 | −0.015em | Page title |
| `h2` | 17 / 24 | 600 | −0.01em | Card title, section header |
| `h3` | 14 / 20 | 600 | 0 | Sub-section, group label |
| `body` | 13.5 / 20 | 450 | 0 | Default reading size |
| `small` | 12.5 / 18 | 450 | 0 | Secondary copy, metadata |
| `caption` | 11.5 / 16 | 500 | 0.01em | Timestamps, helper text |
| `overline` | 11 / 14 | 600 | 0.08em, uppercase | Column headers, kanban column labels |
| `metric` | 26 / 30 | 640 | −0.02em, tabular | KPI values |

The app is dense. Body text does not go above 13.5px, and no screen introduces a size
that is not in this table.

---

## 3. Spacing

4px base. The permitted scale is `4, 8, 12, 16, 20, 24, 32, 40, 48`. Nothing else.

- Card padding: `20`. A card that contains its own rows uses `16` and the rows use `12` vertical.
- Gap between cards in a grid: `16`.
- Page gutter: `24` horizontal, `20` top.
- Navigation rail: `240` wide, items `40` high, `12` horizontal padding.
- Top command bar: `56` high. Title bar: `32` high.
- Control heights: `28` small, `34` default, `40` large. Inputs are `34`.
- Table rows `44`, dense tables `36`.

---

## 4. Radii

Three values. Nothing else.

| Token | Value | Applies to |
|---|---|---|
| `--r-sm` | `6px` | Badges, chips, small buttons, inputs |
| `--r-md` | `10px` | Buttons, nav items, rows, menu items |
| `--r-lg` | `14px` | Cards, panels, modals, popovers |

Pills (`999px`) are allowed for exactly one thing: the match-score badge and status
badges. Nothing else is fully rounded.

---

## 5. Depth

Depth comes from surface value first, shadow second. A card is legible because it is
lighter than the canvas, not because it floats.

| Token | Value | Use |
|---|---|---|
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.35)` | Default card |
| `--shadow-raised` | `0 4px 16px rgba(0,0,0,.45)` | Dropdown, popover, dragged kanban card |
| `--shadow-modal` | `0 24px 64px rgba(0,0,0,.6)` | Modal, command palette |

Permitted gradients, and no others:

1. A `160deg` wash inside a card, `rgba(255,255,255,.03)` to transparent, top-left to bottom-right.
2. The accent button: `#6B4FF0` to `#5F44ED`, top to bottom.
3. Chart area fills: the series colour at 22% fading to 0%.

Glassmorphism, blur-behind panels, glowing borders and animated gradient backgrounds are
forbidden.

---

## 6. Motion

Fast, short, and only where it carries information. Durations: `120ms` for state changes
(hover, press, checkbox), `180ms` for entry and exit, `240ms` for layout changes such as a
kanban card moving column. Easing is `cubic-bezier(.2,.8,.2,1)` for entry and
`cubic-bezier(.4,0,1,1)` for exit.

**One signature moment per screen**, and it is always the same idea: *a value arriving*.

- Dashboard: KPI numbers count up from 0 once, on first mount only, over 420ms.
- Job Search: a newly discovered row slides in from the left edge of its container with a 1px accent bar that fades over 600ms.
- Pipeline: a card that changes column lands with a single 240ms spring and its new column header count ticks.
- Automation: the active stage in the pipeline strip pulses its dot at 1.6s, and only while a run is actually in progress.

Everything else is instant. No page transitions, no staggered list reveals, no parallax.
`prefers-reduced-motion: reduce` disables all four signature moments and every transition
longer than 120ms.

---

## 7. Icons

One inline SVG set, drawn on a 24px grid with a 1.5px stroke, round caps and joins, and no
fills. It lives in `frontend/src/components/Icon.tsx`; a glyph the product needs is added
there rather than pulled from a package, which keeps every icon on the same grid and the
bundle free of an icon dependency. Sizes: 16px in rows and buttons, 18px in the navigation
rail, 20px in KPI tiles. Icons are `--text-secondary` unless the item is active or the icon
is the only content of a button, and an icon-only control always carries a title. Company logos come from the source when the source provides
one; otherwise a monogram tile on `--surface-3` with the company initials in
`--text-secondary`. Never an emoji as an icon, anywhere, including empty states.

---

## 8. Layout

Fixed three-zone desktop shell:

```
┌──────────────────────────────────────────────┐
│ title bar 32                                 │
├────────┬─────────────────────────────────────┤
│ rail   │ command bar 56                      │
│ 240    ├─────────────────────────────────────┤
│        │ page, scrolls independently         │
│        │ max content width 1560, centred     │
└────────┴─────────────────────────────────────┘
```

The rail collapses to 64px icons-only below 1100px. The dashboard grid is 12 columns with
a 16px gutter; it drops to 8 columns below 1280 and 4 below 980. Minimum supported window
is 1024 × 700. The page body is the only scroll container; the rail and command bar never
scroll.

---

## 9. States

Every list, table and panel implements four states, and they are built at the same time as
the happy path, not afterwards.

- **Empty**: an outlined icon at 32px in `--text-muted`, one sentence saying what would appear here, and exactly one primary action. Never an illustration, never a joke.
- **Loading**: skeleton blocks on `--surface-2` at the real row height and count, pulsing opacity .5→.8 over 1.2s. Never a centred spinner for content that has a known shape.
- **Error**: the danger tint background, the reason in one plain sentence, and a retry button. Show the underlying message in a `caption` monospace line beneath it, never a raw stack trace.
- **Partial**: when one job source of several fails, the content renders and a warn-tinted strip names the failed source. A degraded result is never presented as a complete one.

---

## 10. Do / Don't

**Do**

- Let density carry the premium feel. More real information per pixel, smaller type, tighter rows.
- Use one accent action per region, and make everything else a ghost or outline control.
- Right-align every number and set it in the mono face with tabular figures.
- Say what a number means underneath it, in `small`, in `--text-secondary`.
- Pair every status colour with a word.
- Truncate with an ellipsis and a native tooltip rather than wrapping a table cell.

**Don't**

- Don't use a second accent hue. Violet is the only brand colour; status colours are functional, not decorative.
- Don't put a card inside a card. Use `--surface-2` rows and dividers instead.
- Don't use emoji anywhere in the product surface.
- Don't animate on scroll, fade in sections, or transition between pages.
- Don't add a gradient that is not one of the three permitted in §5.
- Don't centre body text or use text above 28px anywhere.
- Don't show a spinner where a skeleton is possible.
- Don't introduce a shadow value, radius, spacing step or type size that is not in this file.

---

## 11. Rejected clusters

These were checked against explicitly and none is present: cream with serif and
terracotta; near-black with acid green or vermilion; newspaper hairline grid; purple-to-blue
gradient hero; glassmorphism; emoji as icons; cards inside cards. The violet here is a flat
accent on a blue-black console, not a gradient hero, and it is used for action affordance
rather than decoration.
