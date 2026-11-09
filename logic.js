/**
 * Pure time/cycle logic for the monthly GitHub Copilot credit tracker.
 * No DOM access: every function takes `now` / dates explicitly so it can be tested in Node.
 *
 * Model:
 *  - A cycle is an INSTANT range [start, end), anchored in UTC (GitHub bills in UTC).
 *    start = resetDay of the month at resetTime (UTC); end = same moment next month.
 *  - Which cycle an entry belongs to is decided by comparing instants against the reset.
 *  - Chart "days" are LOCAL calendar dates that intersect the cycle, so what the user sees
 *    matches their wall clock (e.g. the sliver 21h-24h UTC-3 before a 00:00 UTC reset).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CreditsLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const MIN = 60000;
    const DAY = 86400000;

    function parseHM(str) {
        const [h, m] = String(str || '0:0').split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    }

    function _cycleStartAt(year, month, resetDay, resetTime) {
        const mins = parseHM(resetTime);
        return new Date(Date.UTC(year, month, resetDay, Math.floor(mins / 60), mins % 60));
    }

    /** Cycle containing `now`. cfg: { resetDay: 1-28, resetTime: "HH:MM" (UTC) } */
    function cycleBounds(now, cfg) {
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        let start = _cycleStartAt(y, m, cfg.resetDay, cfg.resetTime);
        if (start > now) start = _cycleStartAt(y, m - 1, cfg.resetDay, cfg.resetTime);
        const end = _cycleStartAt(start.getUTCFullYear(), start.getUTCMonth() + 1, cfg.resetDay, cfg.resetTime);
        return { start, end, key: start.toISOString() };
    }

    function previousCycleBounds(bounds, cfg) {
        return cycleBounds(new Date(bounds.start.getTime() - 1), cfg);
    }

    /** Local calendar day number (days since epoch, by local Y/M/D). DST-safe. */
    function localDayNumber(d) {
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
    }

    /**
     * Displayed days of a cycle are the calendar days 1..N of the billing month, not the
     * slivers that spill over because of the UTC reset (e.g. 21h-24h UTC-3 on the 31st).
     * First day = local date 12h after the reset; last day = local date 12h before the next reset.
     */
    function firstDayNumber(bounds) {
        return localDayNumber(new Date(bounds.start.getTime() + 12 * 3600000));
    }
    function lastDayNumber(bounds) {
        return localDayNumber(new Date(bounds.end.getTime() - 12 * 3600000));
    }

    /** Number of displayed calendar days in the cycle (28-31 for a day-1 reset). */
    function dayCount(bounds) {
        return lastDayNumber(bounds) - firstDayNumber(bounds) + 1;
    }

    /** Index (0-based) of the displayed day holding instant `t`; sliver time is clamped into the range. */
    function dayIndexOf(bounds, t) {
        const i = localDayNumber(t) - firstDayNumber(bounds);
        return Math.min(dayCount(bounds) - 1, Math.max(0, i));
    }

    /** Local calendar date (local midnight) of displayed day i. */
    function dayDate(bounds, i) {
        const base = new Date(firstDayNumber(bounds) * DAY);
        return new Date(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + i);
    }

    /** Indices of displayed days that are work days (business days). */
    function visibleDays(bounds, workDays) {
        const out = [];
        for (let i = 0; i < dayCount(bounds); i++) {
            if (workDays.includes(dayDate(bounds, i).getDay())) out.push(i);
        }
        return out;
    }

    /**
     * Work minutes inside [a, b], counting only workStart-workEnd (local) on workDays (getDay values).
     * Single source of truth for ring AND chart.
     */
    function workMinutesBetween(a, b, work) {
        if (!(b > a)) return 0;
        const sm = parseHM(work.workStart);
        const em = parseHM(work.workEnd);
        if (em <= sm) return 0;
        const days = work.workDays || [0, 1, 2, 3, 4, 5, 6];
        let total = 0;
        let d = new Date(a.getFullYear(), a.getMonth(), a.getDate());
        while (d < b) {
            if (days.includes(d.getDay())) {
                const ds = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, sm);
                const de = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, em);
                const s = ds > a ? ds : a;
                const e = de < b ? de : b;
                if (e > s) total += (e - s) / MIN;
            }
            d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        }
        return total;
    }

    function dailyWorkMinutes(work) {
        return Math.max(0, parseHM(work.workEnd) - parseHM(work.workStart));
    }

    /** Ideal % of the quota consumed by instant t. Falls back to wall-clock if there is no work time. */
    function idealPercentAt(bounds, t, work) {
        const upTo = t < bounds.end ? t : bounds.end;
        const total = workMinutesBetween(bounds.start, bounds.end, work);
        if (total > 0) {
            return Math.min(100, Math.max(0, (workMinutesBetween(bounds.start, upTo, work) / total) * 100));
        }
        const frac = (upTo - bounds.start) / (bounds.end - bounds.start);
        return Math.min(100, Math.max(0, frac * 100));
    }

    /** Ideal % at the end of local calendar day i (clamped to the cycle end). */
    function idealPercentAtDayEnd(bounds, i, work) {
        const d = dayDate(bounds, i);
        const endOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        return idealPercentAt(bounds, endOfDay, work);
    }

    function computeStats(now, cfg, work) {
        const bounds = cycleBounds(now, cfg);
        const upTo = now < bounds.end ? now : bounds.end;
        const totalWork = workMinutesBetween(bounds.start, bounds.end, work);
        const passedWork = workMinutesBetween(bounds.start, upTo, work);
        const daily = dailyWorkMinutes(work);
        return {
            bounds,
            totalWork,
            passedWork,
            remainingWork: Math.max(0, totalWork - passedWork),
            remainingWorkDays: daily > 0 ? Math.max(0, totalWork - passedWork) / daily : 0,
            idealPercent: idealPercentAt(bounds, now, work),
            timeRemaining: bounds.end - now
        };
    }

    /** Projected usage at cycle end at the current work-time pace; null when too early to tell. */
    function projectUsage(used, stats) {
        if (stats.totalWork <= 0 || stats.passedWork < 60) return null;
        return (used / stats.passedWork) * stats.totalWork;
    }

    return {
        parseHM, cycleBounds, previousCycleBounds, localDayNumber, dayIndexOf, dayCount, dayDate, visibleDays,
        workMinutesBetween, dailyWorkMinutes, idealPercentAt, idealPercentAtDayEnd,
        computeStats, projectUsage
    };
});
