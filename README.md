# GitHub Credits Tracker

A PWA to track your **GitHub Copilot AI Credits** against an ideal pace within a **monthly** reset cycle. Sibling of the weekly `claude-limits` tracker, with a GitHub dark look to tell them apart.

## What does it track?

Your **Copilot monthly usage as a percentage** of the allowance, the number you read on [github.com/settings/billing](https://github.com/settings/billing). Since 2026-06-01 GitHub Copilot bills with AI Credits (previously premium requests); working in % keeps the app independent of the plan, the unit and the quota.

The reset is assumed to be **00:00 UTC on day 1** of each month (editable in Settings). Confirm against your billing page.

## How it works

You manually enter your current usage (% used this month) via the slider or number field. The app calculates an **ideal usage** from how much of your configured work time has elapsed since the last monthly reset. Usage above the ideal means you're spending credits too fast.

Compared to claude-limits (weekly):

- Reset is **fixed and automatic** (day of month + UTC time); at the reset, usage returns to 0 and the previous month stays in history.
- Cycle length is 28–31 days, so the chart, ideal line and history editor adapt to the month.
- Usage is stored in **%** (whole numbers only, may exceed 100).
- Extra cards: remaining %, budget per remaining business day, and end-of-cycle projection.
- Business days only: only **business days (Mon–Fri)** count. The chart and history editor show business days only; weekend entries are attached to the preceding Friday.
- Displayed days are the calendar days 1..N of the month (31 is the last day of a 31-day month); the 21h–24h UTC-3 before the UTC reset is not shown as a day.

Data is stored in `localStorage` (key `github_credits_settings`). No backend, no account.

## Development

No build step. Serve the folder statically (`npx serve .`). Time logic lives in `logic.js` as pure functions with tests:

```bash
TZ=Etc/GMT+3 node --test test/logic.test.js
```

## Deploy

Pushing to `main` runs the tests and deploys to GitHub Pages. In the repo settings, set **Pages → Source: GitHub Actions**.

## Install as PWA

Open the live URL in Chrome/Edge and use "Install app".
