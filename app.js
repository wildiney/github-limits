const STORAGE_KEY = 'github_credits_settings';
const QUOTA = 100;       // usage is tracked as % of the monthly allowance (may exceed 100)
const KEEP_CYCLES = 4; // history is pruned by cycle, not by entry count

const DEFAULT_SETTINGS = {
    resetDay: 1,        // day of month (UTC) the cycle resets
    resetTime: '00:00', // UTC
    workStart: '08:00', // local
    workEnd: '20:00',   // local
    usage: 0,           // % of the monthly allowance used in the current cycle (may exceed 100)
    usageCycle: null,   // cycle key (ISO of cycle start) that `usage` belongs to
    darkMode: true,
    history: []         // { cycle: ISO of cycle start, dayIndex: local-day index in cycle, value: % of allowance }
};

// Business days only (Mon-Fri) count, for the ideal pace, the chart and the editor.
const BUSINESS_DAYS = [1, 2, 3, 4, 5];

class CreditsTracker {
    constructor() {
        let stored = {};
        try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { stored = {}; }
        stored = this._migrateFromCredits(stored);
        this.settings = this._sanitize({ ...DEFAULT_SETTINGS, ...stored, workDays: BUSINESS_DAYS });
        this.stats = this.calculateStats();
        this._rolloverIfNeeded();
        this.initElements();
        this.initChart();
        this.addEventListeners();
        this.update();
        this.applyTheme(this.settings.darkMode);
        setInterval(() => this.update(), 60000);
    }

    /** Early builds stored absolute credits + quota; convert to % of the allowance. */
    _migrateFromCredits(stored) {
        if (!(stored.quota > 0)) {
            delete stored.quota;
            delete stored.plan;
            return stored; // whole-% rounding of older decimals happens in _sanitize
        }
        const q = stored.quota;
        const pct = v => Math.round((Number(v) / q) * 100);
        stored.usage = pct(stored.usage || 0);
        stored.history = (Array.isArray(stored.history) ? stored.history : [])
            .filter(h => h && typeof h === 'object')
            .map(h => ({ ...h, value: pct(h.value) }));
        delete stored.quota;
        delete stored.plan;
        return stored;
    }

    /**
     * localStorage is shared by every app on this Pages origin and can hold anything, so never trust its
     * shape: coerce each field to a safe type/range before it reaches the DOM or the date math.
     */
    _sanitize(s) {
        const whole = (v, min, fallback) => (Number.isFinite(v) && v >= min ? Math.round(v) : fallback);
        const hhmm = (v, fallback) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback);
        s.usage = whole(s.usage, 0, 0);
        s.resetDay = Math.min(28, whole(s.resetDay, 1, DEFAULT_SETTINGS.resetDay));
        s.resetTime = hhmm(s.resetTime, DEFAULT_SETTINGS.resetTime);
        s.workStart = hhmm(s.workStart, DEFAULT_SETTINGS.workStart);
        s.workEnd = hhmm(s.workEnd, DEFAULT_SETTINGS.workEnd);
        if (CreditsLogic.parseHM(s.workEnd) <= CreditsLogic.parseHM(s.workStart)) {
            s.workStart = DEFAULT_SETTINGS.workStart;
            s.workEnd = DEFAULT_SETTINGS.workEnd;
        }
        s.darkMode = s.darkMode !== false;
        s.usageCycle = typeof s.usageCycle === 'string' && !Number.isNaN(Date.parse(s.usageCycle)) ? s.usageCycle : null;
        s.history = (Array.isArray(s.history) ? s.history : [])
            .filter(h => h && typeof h.cycle === 'string' && !Number.isNaN(Date.parse(h.cycle))
                && Number.isInteger(h.dayIndex) && h.dayIndex >= 0 && h.dayIndex < 40
                && Number.isFinite(h.value) && h.value >= 0)
            .map(h => ({ cycle: h.cycle, dayIndex: h.dayIndex, value: Math.round(h.value) }));
        return s;
    }

    // ---------- config helpers ----------
    get cfg() { return { resetDay: this.settings.resetDay, resetTime: this.settings.resetTime }; }
    get work() {
        return { workStart: this.settings.workStart, workEnd: this.settings.workEnd, workDays: this.settings.workDays };
    }

    _persist() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch (e) { /* storage unavailable */ }
    }

    /** Monthly reset: when the cycle changes, usage goes back to 0. Old cycles stay in history. */
    _rolloverIfNeeded() {
        const key = this.stats.bounds.key;
        if (this.settings.usageCycle === key) return false;
        this.settings.usage = 0;
        this.settings.usageCycle = key;
        this._pruneHistory();
        this._persist();
        return true;
    }

    _pruneHistory() {
        const keys = [...new Set(this.settings.history.map(h => h.cycle))].sort();
        const keep = new Set(keys.slice(-KEEP_CYCLES));
        keep.add(this.stats.bounds.key);
        this.settings.history = this.settings.history.filter(h => keep.has(h.cycle));
    }

    // ---------- DOM ----------
    initElements() {
        const $ = id => document.getElementById(id);
        this.slider = $('usage-slider');
        this.usageInput = $('usage-input');
        this.currentUsageVal = $('current-usage-val');
        this.idealUsageVal = $('ideal-usage-val');
        this.progressCircle = $('progress-circle');
        this.statusText = $('current-status-text');
        this.diffText = $('diff-text');
        this.nextResetText = $('next-reset-time');
        this.timeRemainingText = $('time-remaining');
        this.remainingEl = $('remaining-credits');
        this.remainingSub = $('remaining-sub');
        this.dailyBudgetEl = $('daily-budget');
        this.dailyBudgetSub = $('daily-budget-sub');
        this.projectionEl = $('projection');
        this.projectionSub = $('projection-sub');

        this.modal = $('modal-settings');
        this.btnSettings = $('btn-settings');
        this.btnCloseModal = $('close-modal');
        this.btnSaveSettings = $('save-settings');
        this.settingsError = $('settings-error');

        this.inResetDay = $('reset-day');
        this.inResetTime = $('reset-time');
        this.resetHint = $('reset-local-hint');
        this.inWorkStart = $('work-start');
        this.inWorkEnd = $('work-end');

        this.btnToggleDark = $('toggle-dark-mode');
        this.toggleThumb = $('toggle-dark-mode-thumb');


        this._syncSettingsInputs();
        this._syncToggleVisual(this.settings.darkMode);
    }

    _syncSettingsInputs() {
        this.inResetDay.value = this.settings.resetDay;
        this.inResetTime.value = this.settings.resetTime;
        this.inWorkStart.value = this.settings.workStart;
        this.inWorkEnd.value = this.settings.workEnd;
        this._updateResetHint();
    }

    _updateResetHint() {
        const day = parseInt(this.inResetDay.value, 10);
        const time = this.inResetTime.value;
        if (!(day >= 1 && day <= 28) || !time) { this.resetHint.textContent = ' '; return; }
        const b = CreditsLogic.cycleBounds(new Date(), { resetDay: day, resetTime: time });
        this.resetHint.textContent = `Próximo reset no seu fuso: ${this._fmtDateTime(b.end)}`;
    }

    _syncUsageInputs() {
        const usage = this.settings.usage;
        this.slider.value = Math.min(usage, QUOTA);
        const fill = Math.min(100, (usage / QUOTA) * 100);
        this.slider.style.background = `linear-gradient(to right, var(--c-accent) ${fill}%, var(--c-border) ${fill}%)`;
        if (document.activeElement !== this.usageInput) this.usageInput.value = usage;
    }

    // ---------- formatting ----------
    _fmtPct(n) { return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`; }
    _parsePct(raw) {
        const v = parseFloat(String(raw).replace(',', '.'));
        return Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
    }
    _fmtDateTime(d) {
        return d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    // ---------- chart ----------
    _cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

    _rgba(hex, a) {
        const m = /^#([0-9a-f]{6})$/i.exec(hex);
        if (!m) return hex;
        const n = parseInt(m[1], 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }

    initChart() {
        const ctx = document.getElementById('historyChart').getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.getCycleLabels(),
                datasets: [
                    { label: 'Uso Real', data: this.getCycleHistoryData(), fill: true, tension: 0.3, spanGaps: true },
                    { label: 'Ideal', data: this.getCycleIdealData(), borderDash: [5, 5], fill: false, tension: 0.3, pointRadius: 2 },
                    { label: 'Ciclo Anterior', data: this.getPreviousCycleData(), borderDash: [4, 4], borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 2, spanGaps: true }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: { y: { beginAtZero: true, max: QUOTA } },
                plugins: {
                    legend: { display: true },
                    tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y === null ? '—' : this._fmtPct(c.parsed.y)}` } }
                }
            }
        });
    }

    updateChartColors() {
        const accent = this._cssVar('--c-accent');
        const ok = this._cssVar('--c-ok');
        const muted = this._cssVar('--c-muted');
        const grid = this._rgba(this._cssVar('--c-border'), 0.6);
        const ds = this.chart.data.datasets;
        ds[0].borderColor = accent;
        ds[0].backgroundColor = this._rgba(accent, 0.15);
        ds[0].pointBackgroundColor = accent;
        ds[1].borderColor = ok;
        ds[1].backgroundColor = 'transparent';
        ds[1].pointBackgroundColor = ok;
        ds[2].borderColor = this._rgba(muted, 0.8);
        ds[2].backgroundColor = 'transparent';
        ds[2].pointBackgroundColor = this._rgba(muted, 0.8);
        const o = this.chart.options;
        o.scales.y.grid = { color: grid };
        o.scales.y.ticks = { color: muted, callback: v => `${v}%` };
        o.scales.x = { grid: { color: grid }, ticks: { color: muted, maxRotation: 0, autoSkip: true } };
        o.plugins.legend.labels = { color: muted };
        this.chart.update();
    }

    updateChart() {
        const history = this.getCycleHistoryData();
        const ideal = this.getCycleIdealData();
        const prev = this.getPreviousCycleData();
        this.chart.data.labels = this.getCycleLabels();
        this.chart.data.datasets[0].data = history;
        this.chart.data.datasets[1].data = ideal;
        this.chart.data.datasets[2].data = prev;
        const peak = Math.max(QUOTA, ...history.filter(v => v !== null), ...prev.filter(v => v !== null));
        this.chart.options.scales.y.max = peak;
        this.chart.update();
    }

    _visibleDays(bounds) { return CreditsLogic.visibleDays(bounds, BUSINESS_DAYS); }

    getCycleLabels() {
        const b = this.stats.bounds;
        return this._visibleDays(b).map(i =>
            CreditsLogic.dayDate(b, i).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
    }

    /**
     * One value per business day of the cycle. A value logged on a weekend (hidden) is attached to
     * the preceding business day, so nothing the user typed disappears from the chart.
     */
    _historySeries(bounds) {
        const visible = this._visibleDays(bounds);
        const total = CreditsLogic.dayCount(bounds);
        const entries = this.settings.history.filter(h => h.cycle === bounds.key);
        return visible.map((start, k) => {
            const stop = k + 1 < visible.length ? visible[k + 1] : total;
            const inRange = entries.filter(h => h.dayIndex >= start && h.dayIndex < stop);
            if (!inRange.length) return null;
            return inRange.reduce((a, b) => (b.dayIndex > a.dayIndex ? b : a)).value;
        });
    }

    getCycleHistoryData() {
        return this._historySeries(this.stats.bounds);
    }

    /** Previous cycle aligned by business-day ordinal (k-th business day), padded/truncated to this cycle. */
    getPreviousCycleData() {
        const prev = CreditsLogic.previousCycleBounds(this.stats.bounds, this.cfg);
        const series = this._historySeries(prev);
        const len = this._visibleDays(this.stats.bounds).length;
        return Array.from({ length: len }, (_, k) => (k < series.length ? series[k] : null));
    }

    getCycleIdealData() {
        const b = this.stats.bounds;
        return this._visibleDays(b).map(i =>
            CreditsLogic.idealPercentAtDayEnd(b, i, this.work));
    }

    // ---------- events ----------
    addEventListeners() {
        this.slider.addEventListener('input', e => this.setUsage(e.target.value));
        this.usageInput.addEventListener('input', e => {
            if (e.target.value !== '') this.setUsage(e.target.value);
        });
        this.usageInput.addEventListener('blur', () => { this.usageInput.value = this.settings.usage; });

        this.btnSettings.addEventListener('click', () => {
            this._syncSettingsInputs();
            this.renderHistoryEditor();
            this.settingsError.classList.add('hidden');
            this.modal.classList.remove('hidden');
        });
        this.btnCloseModal.addEventListener('click', () => this.modal.classList.add('hidden'));
        this.btnSaveSettings.addEventListener('click', () => this.saveSettings());

        [this.inResetDay, this.inResetTime].forEach(el => el.addEventListener('input', () => this._updateResetHint()));

        document.getElementById('history-edit-list').addEventListener('change', e => {
            if (!e.target.matches('.history-edit-input')) return;
            const dayIndex = parseInt(e.target.dataset.dayIndex, 10);
            const value = this._parsePct(e.target.value);
            e.target.value = value;
            this.updateHistory(this.stats.bounds.key, dayIndex, value);
            if (dayIndex === this._currentDayIndex()) {
                this.settings.usage = value;
                this._persist();
            }
            this.update();
        });

        this.btnToggleDark.addEventListener('click', () => {
            const isDark = !this.settings.darkMode;
            this.settings.darkMode = isDark;
            this._persist();
            this._syncToggleVisual(isDark);
            this.applyTheme(isDark);
        });
    }

    // ---------- usage / history ----------
    _currentDayIndex() {
        return Math.max(0, CreditsLogic.dayIndexOf(this.stats.bounds, new Date()));
    }

    setUsage(raw) {
        const value = this._parsePct(raw);
        this.settings.usage = value;
        this.updateHistory(this.stats.bounds.key, this._currentDayIndex(), value);
        this._persist();
        this.updateUI();
        this._syncUsageInputs();
    }

    updateHistory(cycle, dayIndex, value) {
        const existing = this.settings.history.find(h => h.cycle === cycle && h.dayIndex === dayIndex);
        if (existing) existing.value = value;
        else this.settings.history.push({ cycle, dayIndex, value });
        this._pruneHistory();
        this._persist();
        this.updateChart();
    }

    renderHistoryEditor() {
        const container = document.getElementById('history-edit-list');
        container.innerHTML = '';
        const b = this.stats.bounds;
        const current = this._currentDayIndex();
        for (const i of this._visibleDays(b)) {
            const d = CreditsLogic.dayDate(b, i);
            const entry = this.settings.history.find(h => h.cycle === b.key && h.dayIndex === i);
            const dateLabel = d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
            const isToday = i === current;
            const isFuture = i > current;
            const shown = entry && Number.isFinite(Number(entry.value)) ? Number(entry.value) : '';
            const row = document.createElement('div');
            row.className = 'flex items-center gap-3';
            row.innerHTML = `
                <span class="text-xs ${isToday ? 'text-accent font-semibold' : 'text-muted'} w-32 shrink-0">D${i + 1} · ${dateLabel}${isToday ? ' ◀' : ''}</span>
                <input type="number" min="0" step="1" value="${shown}" placeholder="—"
                       data-day-index="${i}"
                       class="history-edit-input field w-24 p-1 text-sm text-right disabled:opacity-40"
                       ${isFuture ? 'disabled' : ''}>
                <span class="text-xs text-muted">%</span>`;
            container.appendChild(row);
        }
    }

    saveSettings() {
        const resetDay = parseInt(this.inResetDay.value, 10);
        const resetTime = this.inResetTime.value;
        const workStart = this.inWorkStart.value;
        const workEnd = this.inWorkEnd.value;

        let error = null;
        if (!(resetDay >= 1 && resetDay <= 28)) error = 'Dia do reset deve ficar entre 1 e 28.';
        else if (!resetTime) error = 'Informe a hora do reset (UTC).';
        else if (!workStart || !workEnd || CreditsLogic.parseHM(workEnd) <= CreditsLogic.parseHM(workStart)) {
            error = 'O fim da jornada deve ser depois do início.';
        }

        if (error) {
            this.settingsError.textContent = error;
            this.settingsError.classList.remove('hidden');
            return;
        }

        Object.assign(this.settings, { resetDay, resetTime, workStart, workEnd });

        // Changing the reset schedule must not wipe the current usage: re-anchor it to the new cycle key.
        this.stats = this.calculateStats();
        this.settings.usageCycle = this.stats.bounds.key;
        this._persist();
        this.modal.classList.add('hidden');
        this.update();
    }

    // ---------- stats / UI ----------
    update() {
        this.stats = this.calculateStats();
        this._rolloverIfNeeded();
        this._syncUsageInputs();
        this.updateUI();
        this.updateChart();
    }

    calculateStats() {
        return CreditsLogic.computeStats(new Date(), this.cfg, this.work);
    }

    updateUI() {
        const { idealPercent, bounds, timeRemaining } = this.stats;
        const pct = this.settings.usage;

        this.currentUsageVal.innerText = `${pct.toFixed(pct < 10 && pct > 0 ? 1 : 0)}%`;
        this.idealUsageVal.innerText = `${idealPercent.toFixed(1)}%`;
        this.progressCircle.style.strokeDashoffset = 263.89 - (Math.min(100, pct) / 100) * 263.89;

        const diff = pct - idealPercent;
        this.progressCircle.classList.remove('text-accent', 'text-warn', 'text-bad');
        let colorClass = 'text-ok';
        let status = 'Dentro do limite';
        if (diff > 10) {
            colorClass = 'text-bad';
            status = 'Excedendo Limite!';
            this.progressCircle.classList.add('text-bad');
        } else if (diff > 0) {
            colorClass = 'text-warn';
            status = 'Atenção: Uso elevado';
            this.progressCircle.classList.add('text-warn');
        } else {
            this.progressCircle.classList.add('text-accent');
        }
        this.diffText.innerText = status;
        this.diffText.className = `text-xs font-semibold mt-1 ${colorClass}`;
        this.statusText.innerText = `Você está ${Math.abs(diff).toFixed(1)} p.p. ${diff > 0 ? 'acima' : 'abaixo'} da meta ideal.`;

        this.nextResetText.innerText = this._fmtDateTime(bounds.end);
        const days = Math.floor(timeRemaining / 86400000);
        const hours = Math.floor((timeRemaining % 86400000) / 3600000);
        this.timeRemainingText.innerText = `${days}d ${hours}h`;

        this._updatePlanningCards(pct);
    }

    _setTone(el, tone) {
        el.classList.remove('text-fg', 'text-ok', 'text-warn', 'text-bad');
        el.classList.add(tone);
    }

    _updatePlanningCards(usage) {
        const remaining = QUOTA - usage;
        if (remaining >= 0) {
            this.remainingEl.innerText = this._fmtPct(remaining);
            this.remainingSub.innerText = `da cota mensal (usado ${this._fmtPct(usage)})`;
            this._setTone(this.remainingEl, 'text-fg');
        } else {
            this.remainingEl.innerText = `Excedeu ${this._fmtPct(-remaining)}`;
            this.remainingSub.innerText = 'Cota mensal ultrapassada';
            this._setTone(this.remainingEl, 'text-bad');
        }

        const days = this.stats.remainingWorkDays;
        if (remaining > 0 && days > 0.05) {
            this.dailyBudgetEl.innerText = `${this._fmtPct(remaining / days)} por dia`;
            this.dailyBudgetSub.innerText = `${days.toFixed(1)} dias úteis restantes`;
        } else {
            this.dailyBudgetEl.innerText = '—';
            this.dailyBudgetSub.innerText = remaining <= 0 ? 'Cota esgotada' : 'Sem dias úteis restantes';
        }

        const proj = CreditsLogic.projectUsage(usage, this.stats);
        if (proj === null) {
            this.projectionEl.innerText = '—';
            this.projectionSub.innerText = 'Poucos dados ainda';
            this._setTone(this.projectionEl, 'text-fg');
        } else if (proj > QUOTA) {
            this.projectionEl.innerText = this._fmtPct(proj);
            this.projectionSub.innerText = `Passa da cota em ${this._fmtPct(proj - QUOTA)} no ritmo atual`;
            this._setTone(this.projectionEl, 'text-bad');
        } else {
            this.projectionEl.innerText = this._fmtPct(proj);
            this.projectionSub.innerText = 'Dentro da cota no ritmo atual';
            this._setTone(this.projectionEl, 'text-ok');
        }
    }

    // ---------- theme ----------
    _syncToggleVisual(isDark) {
        this.btnToggleDark.setAttribute('aria-checked', String(isDark));
        this.btnToggleDark.classList.toggle('bg-btn', isDark);
        this.btnToggleDark.classList.toggle('bg-line', !isDark);
        this.toggleThumb.classList.toggle('translate-x-6', isDark);
        this.toggleThumb.classList.toggle('translate-x-1', !isDark);
    }

    applyTheme(isDark) {
        document.documentElement.classList.toggle('dark', isDark);
        document.querySelector('meta[name="theme-color"]')
            .setAttribute('content', isDark ? '#0d1117' : '#ffffff');
        this.updateChartColors();
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.tracker = new CreditsTracker();
});
