// Run: TZ=Etc/GMT+3 node --test test/
// (on PowerShell: $env:TZ='Etc/GMT+3'; node --test test/)
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../logic.js');

const CFG = { resetDay: 1, resetTime: '00:00' };
const WORK_ALL = { workStart: '08:00', workEnd: '20:00', workDays: [0, 1, 2, 3, 4, 5, 6] };
const WORK_WEEKDAYS = { workStart: '08:00', workEnd: '20:00', workDays: [1, 2, 3, 4, 5] };

// UTC-3 is a fixed offset (no DST). Helper builds an instant from UTC-3 wall clock.
const utc3 = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m - 1, d, h + 3, mi));

test('timezone sanity: tests must run with TZ=Etc/GMT+3', () => {
    assert.equal(new Date().getTimezoneOffset(), 180, 'set TZ=Etc/GMT+3 before running');
});

test('30 Nov 20:59 UTC-3 is still the November cycle', () => {
    const b = L.cycleBounds(utc3(2026, 11, 30, 20, 59), CFG);
    assert.equal(b.key, '2026-11-01T00:00:00.000Z');
});

test('30 Nov 21:01 UTC-3 is the December cycle (UTC reset), day index 0', () => {
    const now = utc3(2026, 11, 30, 21, 1);
    const b = L.cycleBounds(now, CFG);
    assert.equal(b.key, '2026-12-01T00:00:00.000Z');
    assert.equal(L.dayIndexOf(b, now), 0); // local date 30/11 is the cycle's first (sliver) day
});

test('displayed days are calendar days 1..N: no sliver from the previous month, 31 is the last', () => {
    const b = L.cycleBounds(utc3(2026, 12, 15), CFG);
    assert.equal(L.dayDate(b, 0).getDate(), 1);
    assert.equal(L.dayDate(b, 0).getMonth(), 11);
    assert.equal(L.dayCount(b), 31);
    assert.equal(L.dayDate(b, 30).getDate(), 31);
    const nov = L.cycleBounds(utc3(2026, 11, 15), CFG);
    assert.equal(L.dayDate(nov, 0).getDate(), 1);
    assert.equal(L.dayCount(nov), 30);
    assert.equal(L.dayDate(nov, 29).getDate(), 30);
});

test('sliver time (21h-24h UTC-3 before reset) clamps into the first day, never index -1', () => {
    const now = utc3(2026, 10, 31, 22, 0); // Nov cycle already started in UTC
    const b = L.cycleBounds(now, CFG);
    assert.equal(b.key, '2026-11-01T00:00:00.000Z');
    assert.equal(L.dayIndexOf(b, now), 0);
});

test('last evening of the cycle stays on the last day', () => {
    const b = L.cycleBounds(utc3(2026, 11, 15), CFG);
    assert.equal(L.dayIndexOf(b, utc3(2026, 11, 30, 20, 59)), 29);
});

test('visibleDays keeps business days only (Nov 2026 has 21)', () => {
    const b = L.cycleBounds(utc3(2026, 11, 15), CFG);
    const vis = L.visibleDays(b, [1, 2, 3, 4, 5]);
    assert.equal(vis.length, 21);
    assert.ok(vis.every(i => [1, 2, 3, 4, 5].includes(L.dayDate(b, i).getDay())));
    assert.equal(L.dayDate(b, vis[0]).getDate(), 2); // 01/11/2026 is a Sunday
});

test('February cycle (non-leap 2027) is 28 days long and shows 28 calendar days', () => {
    const b = L.cycleBounds(utc3(2027, 2, 10, 12), CFG);
    assert.equal((b.end - b.start) / 86400000, 28);
    assert.equal(L.dayCount(b), 28);
});

test('31-day month and previous-cycle alignment', () => {
    const b = L.cycleBounds(utc3(2026, 12, 15), CFG);
    const p = L.previousCycleBounds(b, CFG);
    assert.equal(p.key, '2026-11-01T00:00:00.000Z');
    assert.equal(p.end.getTime(), b.start.getTime());
    assert.equal((b.end - b.start) / 86400000, 31);
    assert.equal((p.end - p.start) / 86400000, 30);
});

test('year rollover: Jan 2027 cycle, previous is Dec 2026', () => {
    const b = L.cycleBounds(utc3(2027, 1, 5), CFG);
    assert.equal(b.key, '2027-01-01T00:00:00.000Z');
    assert.equal(L.previousCycleBounds(b, CFG).key, '2026-12-01T00:00:00.000Z');
});

test('custom reset day/time (day 15 at 12:00 UTC)', () => {
    const cfg = { resetDay: 15, resetTime: '12:00' };
    assert.equal(L.cycleBounds(new Date(Date.UTC(2026, 10, 15, 11, 59)), cfg).key, '2026-10-15T12:00:00.000Z');
    assert.equal(L.cycleBounds(new Date(Date.UTC(2026, 10, 15, 12, 0)), cfg).key, '2026-11-15T12:00:00.000Z');
});

test('ideal is 0 at start, 100 at end, and monotonic', () => {
    const b = L.cycleBounds(utc3(2026, 11, 10), CFG);
    assert.equal(L.idealPercentAt(b, b.start, WORK_ALL), 0);
    assert.ok(Math.abs(L.idealPercentAt(b, b.end, WORK_ALL) - 100) < 1e-9);
    let prev = -1;
    for (let i = 0; i < L.dayCount(b); i++) {
        const v = L.idealPercentAtDayEnd(b, i, WORK_ALL);
        assert.ok(v >= prev);
        prev = v;
    }
    assert.ok(Math.abs(prev - 100) < 1e-9);
});

test('ring and chart agree: ideal at end of today equals ideal at that instant', () => {
    const now = utc3(2026, 11, 10, 14);
    const b = L.cycleBounds(now, CFG);
    const idx = L.dayIndexOf(b, now);
    const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    assert.equal(L.idealPercentAtDayEnd(b, idx, WORK_ALL), L.idealPercentAt(b, endToday, WORK_ALL));
});

test('weekday-only work excludes weekends', () => {
    // Sat 14 Nov 2026 -> Sun 15 Nov 2026 inclusive: zero work minutes
    const a = utc3(2026, 11, 14, 0);
    const z = utc3(2026, 11, 16, 0);
    assert.equal(L.workMinutesBetween(a, z, WORK_WEEKDAYS), 0);
    assert.equal(L.workMinutesBetween(a, z, WORK_ALL), 2 * 720);
});

test('zero work time falls back to wall-clock ideal (no NaN)', () => {
    const noDays = { workStart: '08:00', workEnd: '20:00', workDays: [] };
    const inverted = { workStart: '20:00', workEnd: '08:00', workDays: [1, 2, 3, 4, 5] };
    const now = utc3(2026, 11, 16, 12);
    const b = L.cycleBounds(now, CFG);
    for (const w of [noDays, inverted]) {
        const v = L.idealPercentAt(b, now, w);
        assert.ok(Number.isFinite(v) && v > 0 && v < 100);
    }
});

test('projection is null early, linear later', () => {
    const early = L.computeStats(utc3(2026, 10, 31, 22, 0), CFG, WORK_ALL);
    assert.equal(L.projectUsage(10, early), null);
    const later = L.computeStats(utc3(2026, 11, 16, 12), CFG, WORK_ALL);
    const proj = L.projectUsage(500, later);
    assert.ok(proj > 500);
    assert.ok(Math.abs(proj - 500 * (later.totalWork / later.passedWork)) < 1e-6);
});
