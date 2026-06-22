# Phase 8 Design — Playground "Dark Command-Console" Restyle

> **Status:** brainstorm output. A sleek visual restyle of the playground into a premium all-dark
> "command console" aesthetic. Content, features, structure, and logic are unchanged — this is almost
> entirely a `styles.css` rewrite (plus making JSON-highlight token colors suit dark panels everywhere).
> `engine.js`, `scenarios.js`, `app.js`, `features.js`, and tests are untouched.

## Goal

Make the playground look genuinely premium and modern — a dark, glassy, glowing developer-console feel —
without changing what it does. Keep it static / zero-build / zero-dep and XSS-safe.

## Scope

- **Rewrite `playground/styles.css`** for the dark theme.
- **Tiny `index.html` touch** only if needed for theme color meta (`<meta name="theme-color">`) — no
  structural change.
- **No change** to `app.js`/`features.js`/`engine.js`/`scenarios.js`/`highlight.js`/tests. The existing DOM
  ids/classes are the styling targets; the JSON highlighter already emits `.t-key/.t-str/.t-num/.t-punct/.t-plain`
  spans — we just recolor them for dark backgrounds globally (drop the separate light-panel variants).

## Visual system

- **Base:** `--bg:#0b0d12` near-black navy; a subtle fixed radial glow (`radial-gradient` top-center, very
  low alpha blue) for depth. `--ink:#e6e8ee`, `--muted:#8a90a0`.
- **Glass panels:** `--panel:rgba(255,255,255,.035)` with `backdrop-filter:blur(10px)`, `1px` border
  `rgba(255,255,255,.08)`, `border-radius:16px`, soft shadow. Hover/active raise border alpha + a faint
  inner glow.
- **Accents (brightened for dark):** `--blue:#5b9bff`, `--good:#46d39a`, `--bad:#ff6b6b`. Accent glows via
  `box-shadow` (e.g. run button `0 0 0 1px + 0 8px 24px rgba(91,155,255,.35)`).
- **Type:** DM Serif Display for the brand/headings (light ink), DM Sans for UI, Fira Code for code/console.
- **JSON highlight (all dark panels):** `.t-key:#7cc7ff .t-str:#9ece6a .t-num:#e0af68 .t-punct:#7c8190
  .t-plain:#cfd2dc`.

## Component treatments

- **Masthead:** dark, hairline bottom border; brand white + blue `Playground`; metrics as subtle glass
  pills; the **caught counter** pill gets a green glow; the "simulated environment" badge muted amber-on-dark.
- **Rail:** glass cards; the active card ringed with a blue glow (`box-shadow:0 0 0 1px var(--blue), 0 0 18px
  rgba(91,155,255,.25)`); search input dark; filter chips as pills (active = filled blue, glow); status dots
  glow (`box-shadow:0 0 8px`).
- **Panels (1·2·3):** glass; panel headers in light ink; the world toggle keeps the ✅/❌ slider; JSON shown
  with the dark token colors.
- **Run row:** primary **▶ Run** button blue with glow; play/step/replay as ghost glass buttons.
- **Timeline (centerpiece):** an inset darker console (`#06070b`) inside a glass panel; each stage row a thin
  divider; ✓ glows green, ✗ glows red; the verdict row larger with a tinted background (green/red wash);
  fade/slide-in animation retained (reduced-motion gated).
- **Diff:** two glass columns; "Without TrueCall" red-tinted header, "With TrueCall" green-tinted; reality
  line bold colored.
- **Challenge bar:** glass with a blue border glow; guess buttons blue.
- **Intro overlay:** dim backdrop with blur; a dark glass card, large DM Serif heading, blue CTA.

## Constraints (carried)

- Static, zero-build, **zero deps**; XSS-safe (no markup changes; styling only).
- `packages/core` + the playground JS/tests unchanged.
- Motion gated by `@media (prefers-reduced-motion: no-preference)`.
- Brand-consistent (navy/blue/green); no employer references.
- Accessible contrast: body text `#e6e8ee` on `#0b0d12` (~13:1); muted text kept ≥ 4.5:1; accents used for
  emphasis, not body copy.

## Testing
- `node --test` (engine + highlighter) still passes — no JS changed.
- Render check: serve over http, headless-Chrome screenshot at desktop + a narrow width; eyeball the dark UI
  (masthead, glass rail, panels, timeline) and confirm the intro/challenge bar hidden states still hold
  (the global `[hidden]{display:none!important}` rule is preserved).

## Deploy
Redeploy `playground/` to `ai-edge-gallery/truecall` (public `truecall-eosin.vercel.app`).

## Acceptance
- The playground reads as a cohesive premium dark "command console": glassy panels, glowing accents, the
  timeline as a centerpiece — with all Phase 7 features intact and tests green.
