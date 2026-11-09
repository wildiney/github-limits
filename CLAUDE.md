# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

Pushing to `main` runs `node --test` and deploys to GitHub Pages via `.github/workflows/deploy.yml` (Pages source must be "GitHub Actions"). No build step: pure static HTML/JS.

## Architecture

Single-page PWA, no framework, no bundler, no dependencies to install. Monthly sibling of `claude-limits` (weekly).

- `index.html` — markup/layout (Tailwind CDN, Chart.js CDN). Colors are CSS variables (GitHub Primer palette, dark by default) exposed as Tailwind colors (`bg-surface`, `text-muted`, `text-accent`…). Change the palette only in the `:root` / `html.dark` blocks.
- `logic.js` — **pure** cycle/time functions (`CreditsLogic`), no DOM, take `now` as input. Tested in Node.
- `app.js` — single `CreditsTracker` class: state, DOM, chart.
- `sw.js` — service worker, network-first with cache fallback.
- `test/logic.test.js` — run `TZ=Etc/GMT+3 node --test test/logic.test.js` (first test asserts the TZ took effect).

## Same-origin caveat

This app and `claude-limits` are both served from the same GitHub Pages user origin, so they share `localStorage` and `CacheStorage`. Therefore: storage key is `github_credits_settings` (also used by the pre-paint script in `<head>`), cache names are prefixed `github-credits-`, and `sw.js` activate must delete **only** caches with that prefix. Never use generic keys/cache names.

## Cycle model (important, timezone-sensitive)

- A cycle is an **instant range** `[start, end)` anchored in **UTC**: `resetDay` of the month at `resetTime` (UTC). Default: day 1, 00:00 UTC, which is 21:00 UTC-3 on the last day of the previous month.
- Which cycle an entry/usage belongs to is decided by comparing instants against the reset (`cycleBounds`), never by local dates.
- Displayed days are the **calendar days 1..N of the billing month** in local time (`dayIndexOf`, `dayDate`, `dayCount`): first = local date 12h after the reset, last = local date 12h before the next reset. So UTC-3's 21h–24h sliver before the UTC reset is NOT a day (never show 31/10 as D1 of November); instants in the sliver clamp into day 0. Don't bucket by UTC date: that makes entries logged 21h–24h UTC-3 show up as tomorrow.
- Business days only: work days are fixed to Mon–Fri (`BUSINESS_DAYS`, forced on load). Chart and history editor show only business days (`visibleDays`); weekend entries attach to the preceding business day; previous-month line aligns by business-day ordinal.
- Ring and chart share `workMinutesBetween`; don't add a second ideal-usage formula. If no work minutes exist (no days selected / end <= start) ideal falls back to wall-clock fraction.
- History: `{ cycle: ISO of cycle start, dayIndex, value }`, pruned by cycle (`KEEP_CYCLES`). `dayIndex` is the displayed-day index (0 = day 1 of the month). Previous-month line is padded with nulls.
- `settings.usageCycle` records which cycle `usage` belongs to; a mismatch on load/tick resets usage to 0. Saving settings re-anchors it so changing the reset schedule doesn't wipe usage.
- Usage and history values are **% of the monthly allowance** (`QUOTA = 100`, whole numbers only, rounded in `_parsePct`, may exceed 100). The UI never shows credits/US$ or asks for a quota. `_migrateFromCredits` converts data saved by early builds (absolute credits + `quota`).

## Service worker cache

Bump `CACHE_NAME` (`github-credits-vN`) in `sw.js` when deploying changes that must invalidate the cache.

## Debugging

When fixing bugs, always check for deeper root causes (e.g., timezone issues behind date calculations). Don't stop at the surface-level fix.
