---
version: alpha
name: Quiesco
description: Visual identity for Quiesco, gray-box end-to-end testing for Expo apps. Calm, precise, quiet. Klein blue on ink and paper, Geist type, one round dot as the signature.
colors:
  # Brand
  primary: "#002fa7"
  primary-hover: "#00258a"
  signal: "#6f86ff"
  signal-hover: "#8c9eff"
  # Light theme neutrals
  ink: "#0c0f1a"
  ink-muted: "#555c6e"
  canvas: "#f5f6f8"
  surface: "#ffffff"
  surface-sunken: "#f0f2f5"
  line: "#e3e6ec"
  # Dark theme neutrals
  ink-dark: "#eef0f5"
  ink-muted-dark: "#9aa1b2"
  canvas-dark: "#090b12"
  surface-dark: "#10131c"
  surface-sunken-dark: "#0b0e15"
  line-dark: "#232838"
  # Test status, light theme
  passed: "#0a7a4f"
  passed-soft: "#e3f4ec"
  failed: "#c0262d"
  failed-soft: "#fbe8e8"
  skipped: "#9a5500"
  skipped-soft: "#fbf0dc"
  running-soft: "#e7ecff"
  # Test status, dark theme
  passed-dark: "#3ecf8e"
  passed-soft-dark: "#0f2a20"
  failed-dark: "#ff7a7a"
  failed-soft-dark: "#361518"
  skipped-dark: "#f5b544"
  skipped-soft-dark: "#33260e"
  running-soft-dark: "#18204a"
typography:
  wordmark:
    fontFamily: Geist
    fontSize: 22px
    fontWeight: 500
    lineHeight: 1
    letterSpacing: -0.035em
  headline-display:
    fontFamily: Geist
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.025em
  headline-md:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: -0.02em
  title-md:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  label-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1
  label-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1
    letterSpacing: 0.01em
  code-md:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.65
  code-sm:
    fontFamily: Geist Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: '"zero" 1'
rounded:
  none: 0px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  control-sm: 28px
  control-md: 36px
  row: 32px
  gutter: 16px
  content-max: 1200px
components:
  page:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  page-dark:
    backgroundColor: "{colors.canvas-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.body-md}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  card-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  text-muted:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body-sm}"
  text-muted-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-muted-dark}"
    typography: "{typography.body-sm}"
  divider:
    backgroundColor: "{colors.line}"
    height: 1px
  divider-dark:
    backgroundColor: "{colors.line-dark}"
    height: 1px
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-md}"
    padding: 14px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
  button-primary-dark:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.canvas-dark}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-md}"
    padding: 14px
  button-primary-dark-hover:
    backgroundColor: "{colors.signal-hover}"
    textColor: "{colors.canvas-dark}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-md}"
    padding: 14px
  button-secondary-hover:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink}"
  button-secondary-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-md}"
    padding: 14px
  button-secondary-dark-hover:
    backgroundColor: "{colors.line-dark}"
    textColor: "{colors.ink-dark}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-md}"
    padding: "{spacing.md}"
  input-dark:
    backgroundColor: "{colors.surface-sunken-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control-md}"
    padding: "{spacing.md}"
  link:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
  link-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.signal}"
  list-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.row}"
    padding: "{spacing.sm}"
  list-row-selected:
    backgroundColor: "{colors.running-soft}"
    textColor: "{colors.ink}"
  list-row-dark:
    backgroundColor: "{colors.surface-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    height: "{spacing.row}"
    padding: "{spacing.sm}"
  list-row-selected-dark:
    backgroundColor: "{colors.running-soft-dark}"
    textColor: "{colors.ink-dark}"
  status-passed:
    backgroundColor: "{colors.passed-soft}"
    textColor: "{colors.passed}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "{spacing.sm}"
  status-failed:
    backgroundColor: "{colors.failed-soft}"
    textColor: "{colors.failed}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "{spacing.sm}"
  status-skipped:
    backgroundColor: "{colors.skipped-soft}"
    textColor: "{colors.skipped}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "{spacing.sm}"
  status-running:
    backgroundColor: "{colors.running-soft}"
    textColor: "{colors.primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "{spacing.sm}"
  status-passed-dark:
    backgroundColor: "{colors.passed-soft-dark}"
    textColor: "{colors.passed-dark}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "{spacing.sm}"
  status-failed-dark:
    backgroundColor: "{colors.failed-soft-dark}"
    textColor: "{colors.failed-dark}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "{spacing.sm}"
  status-skipped-dark:
    backgroundColor: "{colors.skipped-soft-dark}"
    textColor: "{colors.skipped-dark}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "{spacing.sm}"
  status-running-dark:
    backgroundColor: "{colors.running-soft-dark}"
    textColor: "{colors.signal}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: "{spacing.sm}"
  status-dot:
    backgroundColor: "{colors.signal}"
    rounded: "{rounded.full}"
    size: 8px
  code-block:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink}"
    typography: "{typography.code-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  code-block-dark:
    backgroundColor: "{colors.surface-sunken-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.code-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  kbd:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.code-sm}"
    rounded: "{rounded.xs}"
    padding: "{spacing.xs}"
  headline:
    textColor: "{colors.ink}"
    typography: "{typography.headline-lg}"
  section-title:
    textColor: "{colors.ink}"
    typography: "{typography.headline-md}"
  hero-title:
    textColor: "{colors.ink}"
    typography: "{typography.headline-display}"
  panel-title:
    textColor: "{colors.ink}"
    typography: "{typography.title-md}"
  prose:
    textColor: "{colors.ink}"
    typography: "{typography.body-lg}"
  logo-lockup:
    textColor: "{colors.ink}"
    typography: "{typography.wordmark}"
    height: 28px
  app-icon:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.lg}"
    size: 32px
---

# Quiesco

## Overview

Quiesco is gray-box end-to-end testing for Expo apps. Its job is to wait until the app is quiet (no network, timers, renders or animations in flight) and only then act. The name is Latin *quiēscō*, "to come to rest", and the whole identity is built on that moment.

The personality is **calm, precise and engineered**. Quiesco is a developer tool that sits next to a running app and a stream of test results, so the interface must stay out of the way: no decoration, no gradients on content, no motion that is not reporting a real state change. Confidence comes from restraint, exact alignment and good type rather than from colour.

The audience is mobile and web engineers who live in terminals, editors and CI logs. They scan more than they read. Density should be comfortable, not cramped: closer to a well-set editor than to a marketing page.

The signature is **the dot**. The logo is a Q whose tail is reduced to a single round dot, a full stop: the app has come to rest. That dot carries through the product as the only fully round shape, used for status. Everything else is squared off with small radii.

Logo files live in `docs/logo/`. The mark is an ink ring with a dot in Signal blue, set next to the wordmark "quiesco" in lowercase Geist Medium with tight tracking. On dark backgrounds the ring and wordmark switch to Ink Dark; the dot stays Signal.

## Colors

The palette is two neutrals (ink and paper) and one blue, used at two strengths. Status colours are separate and only ever mean test results.

- **Klein (`primary`, #002fa7):** International Klein Blue. The interactive colour in the light theme: primary buttons, links, the running state, selection. Deep enough to carry white text (10.7:1).
- **Signal (`signal`, #6f86ff):** Klein lifted for dark backgrounds. It is the logo dot in both themes, and in the dark theme it replaces Klein for every interactive element. On light backgrounds use it only for the logo dot and focus rings, never for text (3.2:1 on white).
- **Ink (`ink`, #0c0f1a):** A near-black with a trace of blue. All text, the logo ring, the app icon tile.
- **Ink Muted (`ink-muted`, #555c6e):** Secondary text, metadata, durations, file paths.
- **Canvas / Surface (`canvas` #f5f6f8, `surface` #ffffff):** The page sits on a faint cool grey; panels and cards are white. `surface-sunken` (#f0f2f5) is for code, inputs on cards and hovered rows.
- **Line (`line`, #e3e6ec):** Hairline borders and dividers, always 1px.

The dark theme mirrors this with `-dark` tokens: a blue-black canvas (#090b12), slightly lifted surfaces (#10131c), Ink Dark text (#eef0f5) and Signal as the accent. Dark is not an inversion of light; surfaces get lighter as they come forward.

**Test status** has its own fixed set, each with a soft background for pills and rows:

- **Passed:** green, #0a7a4f light / #3ecf8e dark.
- **Failed:** red, #c0262d light / #ff7a7a dark.
- **Skipped / pending:** amber, #9a5500 light / #f5b544 dark.
- **Running:** the brand blue (Klein light / Signal dark), because "waiting for quiet" is what Quiesco itself is doing.

Status colours never appear as decoration, and brand blue never means pass or fail.

## Typography

One family, **Geist**, in two cuts: **Geist** for everything readable and **Geist Mono** for code, selectors, test ids, step text quoted from feature files, timings and anything a user might copy. Both are on Google Fonts and the wordmark is set in Geist, so the product and the logo share a voice.

- **Headlines** (`headline-display`, `headline-lg`, `headline-md`): Geist Semibold with negative tracking that tightens as the size grows. Used sparingly; a tool screen usually needs one headline at most.
- **Titles** (`title-md`): Panel and card headings at 15px Semibold.
- **Body** (`body-md` 14px is the default in the product; `body-lg` 16px for docs and long prose; `body-sm` 13px for secondary text).
- **Labels** (`label-md`, `label-sm`): Medium weight, for buttons, tabs, pills and table headers. Sentence case, never all caps.
- **Code** (`code-md`, `code-sm`): Geist Mono with a slashed zero in small sizes so ids and hashes read unambiguously.
- **Wordmark**: Geist Medium, -0.035em, lowercase. Only for the logo lockup; never type the product name this way in running text, where it is "Quiesco".

Use tabular figures (`font-variant-numeric: tabular-nums`) wherever numbers line up: counts, durations, progress. Use at most two weights on one screen (400 and 500, or 400 and 600).

Chinese and Japanese text falls back to the system CJK fonts (PingFang SC, Hiragino Sans, Noto Sans CJK) after Geist.

## Layout

A **4px base unit** with a working scale of 4, 8, 12, 16, 24, 32 and 48. Controls are 36px tall (`control-md`) or 28px when compact (`control-sm`); list rows are 32px so a long test tree stays scannable.

Tool screens (the test UI) use a **fluid app layout**: a header bar, then panes that fill the window, separated by 1px lines rather than gaps of empty space. Panes scroll independently. Documentation and marketing pages use a centred column with a 1200px maximum and a readable text measure of about 70 characters.

Gutters are 16px at every width. On narrow screens panes stack vertically; nothing scrolls the page sideways except code blocks, which scroll inside themselves.

Group related things by proximity and alignment first, a hairline second, and a card only when the group really is a separate object.

## Elevation & Depth

Quiesco is **flat**. Depth comes from tonal layers, not shadows:

- Light theme: canvas (#f5f6f8) → surface (#ffffff) → sunken (#f0f2f5) for code and inset areas. Edges are 1px `line` borders.
- Dark theme: canvas (#090b12) → surface (#10131c), with sunken areas going darker (#0b0e15). Surfaces that come forward get lighter.

The only shadow is for things that float above the page (menus, popovers, toasts): `0 8px 24px rgba(12, 15, 26, 0.12)` in light, `0 8px 24px rgba(0, 0, 0, 0.5)` plus a 1px `line-dark` border in dark.

Focus is shown with a 2px Signal outline offset by 2px, in both themes.

## Shapes

The shape language is **squared, with one circle**. Rectangles use small radii so the interface feels engineered: 4px for keycaps and tiny chips, 6px for list rows, 8px for buttons, inputs and code blocks, 12px for cards and panels. Radii never exceed 12px on rectangles.

Full rounding (`rounded.full`) is reserved for things that echo the logo's dot: status dots, status pills, avatars and progress ends. A rounded element should read as "this is a state", not as decoration.

Icons are 16px or 20px line icons with a 1.5px stroke and square ends, matching the logo ring's weight. The app icon is an Ink tile with a 22.5% corner radius (14.5 on a 64 grid), a white ring and a Signal dot.

## Components

- **Buttons:** Primary is Klein with white text in light, Signal with canvas-dark text in dark; one per view, for the main action (Run). Secondary is a surface button with a 1px line border. Icon buttons are square at the control height. Hover darkens or lightens one step; pressed adds nothing extra; disabled is 50% opacity.
- **Inputs:** Same height and radius as buttons, 1px line border, Signal focus ring. Search fields carry a leading icon and a trailing keyboard hint in a `kbd`.
- **List rows (test tree):** 32px rows, 6px radius, no borders between rows. Hover uses `surface-sunken`; the selected row uses the running soft blue. Each row starts with a status dot.
- **Status:** An 8px dot for dense lists and a pill (dot plus label) for headers and summaries. Running dots may pulse slowly (1.6s ease-in-out opacity); nothing else animates.
- **Code blocks:** `surface-sunken` background, Geist Mono 13px, 16px padding, 8px radius, horizontal scroll inside the block. Failing lines are marked with the failed soft background across the full width.
- **Cards and panels:** Surface background, 1px line border, 12px radius, 16px padding. No shadow.
- **Logo lockup:** 28px tall in app headers and navbars. Minimum mark size is 16px; below 24px use the mark without the wordmark. Keep clear space of at least the dot's diameter on every side.

## Do's and Don'ts

- Do use Klein or Signal for one primary action per view, and for nothing decorative.
- Do keep status colours for test results only; never use green for a "Get started" button.
- Do write ids, selectors, step text and durations in Geist Mono so they look copyable.
- Do keep borders at 1px and radii at 12px or below.
- Don't use Signal (#6f86ff) for text on light backgrounds; it fails contrast. Use Klein.
- Don't add gradients, glows or glassmorphism to content. The app icon's subtle tile gradient is the only one.
- Don't use shadows to separate panels; use a hairline or a tonal step.
- Don't animate anything that is not reporting a real state change. Quiesco is about stillness.
- Don't recolour, rotate, outline or add effects to the logo, and don't separate the dot from the ring.
- Do maintain WCAG AA contrast (4.5:1 for text, 3:1 for icons and focus rings) in both themes.
