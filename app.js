// HealthTracker - Core Logic & Data Controller

// Wrapped in an IIFE so nothing leaks onto window: in a classic script, every
// top-level function declaration would otherwise become a global property.
(function () {
    'use strict';

// --- Small DOM helpers ---
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = value => clamp(value, 0, 1);

/** localStorage reads/writes that never throw (private mode, quota, corrupt JSON). */
const storage = {
    get(key, fallback = null) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : raw;
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (err) {
            console.warn(`Could not persist "${key}"`, err);
            return false;
        }
    },
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch {
            /* ignore */
        }
    },
    getJSON(key, fallback) {
        const raw = storage.get(key);
        if (raw === null) return fallback;
        try {
            const parsed = JSON.parse(raw);
            return parsed ?? fallback;
        } catch (err) {
            console.warn(`Corrupt value for "${key}", falling back to default.`, err);
            return fallback;
        }
    }
};

// Key names are legacy (from the AuraFit prototype) but kept verbatim so existing
// installs keep their data and customisations.
const STORAGE_KEYS = {
    data: 'aurafit_data',
    wallpaper: 'aurafit_custom_bg',
    sidebarColor: 'aurafit_sidebar_color',
    bgBlur: 'aurafit_bg_blur',
    recentColors: 'aurafit_recent_colors'
};

const DEFAULT_SIDEBAR_COLOR = '#0d0f19';
const SIDEBAR_TEXT_COLOR = '#f3f4f6'; // --text-primary, used for the contrast readout

const EMPTY_STATES = {
    screentime: 'No screen time logged today yet.',
    calories: 'No meals logged today yet.',
    water: 'No water intake logged today yet.'
};

const CATEGORY_LABELS = {
    screentime: 'Screen Time',
    calories: 'Calories',
    water: 'Hydration'
};

const DEFAULT_GOALS = { screentime: 0, calories: 0, water: 0 };

const TAB_INFO = {
    dashboard: { title: 'Dashboard Overview', subtitle: 'Your vitals and digital habits at a glance' },
    screentime: { title: 'Screen Time Tracker', subtitle: 'Monitor and reduce your digital usage' },
    calories: { title: 'Nutrition & Calories', subtitle: 'Fuel your body and keep track of intake' },
    water: { title: 'Hydration Tracker', subtitle: 'Log water and reach your daily target' }
};

const CATEGORY_CONFIG = {
    screentime: {
        ring: 'ring-screentime',
        pill: '.limit-screentime',
        pillText: goal => (goal > 0 ? `Goal: max ${goal}h` : 'Goal: Not set'),
        ringValue: totals => `${totals.screentime}h`,
        ringLabel: (pct, goal) => (goal > 0 ? `${pct}% of limit` : 'No limit set'),
        dateLabel: today => `Logs for ${formatHumanDate(today)}`,
        noGoal: 'No limit',
        remainingId: 'screentime-remaining',
        sessionCountId: 'screentime-session-count',
        overText: () => 'Exceeded!',
        overTone: 'text-red',
        underText: remaining => `${remaining.toFixed(1)} hrs`,
        underTone: 'text-green'
    },
    calories: {
        ring: 'ring-calories',
        pill: '.target-calories',
        pillText: goal => (goal > 0 ? `Target: ${goal.toLocaleString()} kcal` : 'Target: Not set'),
        ringValue: totals => `${totals.calories}`,
        ringLabel: (pct, goal) => (goal > 0 ? `${pct}% of budget` : 'No budget set'),
        dateLabel: today => `Meals eaten on ${formatHumanDate(today)}`,
        noGoal: 'No budget',
        remainingId: 'calories-remaining',
        totalId: 'calories-total-val',
        totalValue: totals => `${totals.calories} kcal`,
        overText: remaining => `${Math.abs(remaining)} kcal over`,
        overTone: 'text-orange',
        underText: remaining => `${remaining} kcal`,
        underTone: 'text-green'
    },
    water: {
        ring: 'ring-water',
        pill: '.target-water',
        pillText: goal => (goal > 0 ? `Target: ${goal.toLocaleString()} ml` : 'Target: Not set'),
        ringValue: totals => `${totals.water}ml`,
        ringLabel: (pct, goal) => (goal > 0 ? `${pct}% of goal` : 'No goal set'),
        dateLabel: today => `Water intake on ${formatHumanDate(today)}`,
        noGoal: 'No goal',
        remainingId: 'water-remaining',
        totalId: 'water-total-val',
        totalValue: totals => `${totals.water} ml`,
        overText: () => 'Goal Achieved!',
        overTone: 'text-green',
        underText: remaining => `${remaining} ml`,
        underTone: 'text-blue'
    }
};

let appData = { goals: { ...DEFAULT_GOALS }, logs: [] };
let activeTab = 'dashboard';
let searchQuery = '';
let currentSidebarColor = DEFAULT_SIDEBAR_COLOR;
let bgBlurred = false;
let unifiedChart = null;
let toastTimer = null;
let searchDebounceTimer = null;

// --- Date Utilities ---
const formatDateToString = date =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getTodayDateString = () => formatDateToString(new Date());

function formatHumanDate(dateStr) {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
    });
}

function getPastDates(numDays) {
    const dates = [];
    const today = new Date();
    for (let i = numDays - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dates.push(formatDateToString(d));
    }
    return dates;
}

function getAllTimeDates() {
    const today = getTodayDateString();
    if (appData.logs.length === 0) return [today];
    const earliest = appData.logs.reduce((min, log) => (log.date < min ? log.date : min), today);
    const diffDays = Math.max(0, Math.round((new Date(`${today}T00:00:00`) - new Date(`${earliest}T00:00:00`)) / 86400000));
    return getPastDates(diffDays + 1);
}

// --- Data Management & Persistence ---
function loadData() {
    appData = storage.getJSON(STORAGE_KEYS.data, null) || { goals: { ...DEFAULT_GOALS }, logs: [] };
    appData.goals = { ...DEFAULT_GOALS, ...(appData.goals || {}) };
    if (!Array.isArray(appData.logs)) appData.logs = [];
}

function saveToStorage() {
    storage.set(STORAGE_KEYS.data, JSON.stringify(appData));
}

// --- Aggregate Data Calculators ---
function getDailyTotals(dateStr) {
    const totals = { calories: 0, water: 0, screenMinutes: 0 };
    for (const log of appData.logs) {
        if (log.date !== dateStr) continue;
        if (log.type === 'screentime') totals.screenMinutes += log.amount;
        else if (log.type === 'calories') totals.calories += log.amount;
        else if (log.type === 'water') totals.water += log.amount;
    }
    return { ...totals, screentime: parseFloat((totals.screenMinutes / 60).toFixed(1)) };
}

function getAggregatedDataForDates(datesArray) {
    return datesArray.map(dateStr => {
        const totals = getDailyTotals(dateStr);
        return { date: dateStr, screentime: totals.screentime, calories: totals.calories, water: totals.water };
    });
}

// --- Log Formatting Helpers ---
function formatLogAmount(log) {
    if (log.type === 'screentime') {
        const h = Math.floor(log.amount / 60);
        const m = log.amount % 60;
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
    return log.type === 'calories' ? `${log.amount} kcal` : `${log.amount} ml`;
}

const formatLogTime = timestamp =>
    new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

/** The text a log entry can be found by: title, category, amount and type. */
function logSearchText(log) {
    return `${log.notes || ''} ${log.category || ''} ${formatLogAmount(log)} ${CATEGORY_LABELS[log.type] || ''}`
        .toLowerCase();
}

const matchesSearch = (log, needle) => logSearchText(log).includes(needle);
const byNewestFirst = (a, b) => b.timestamp - a.timestamp;

// --- Search ---
function setSearchQuery(value) {
    searchQuery = value;
    const clearBtn = $('#search-clear');
    if (clearBtn) clearBtn.classList.toggle('is-hidden', !value.trim());
    renderActiveTab();
}

function clearSearch() {
    const input = $('#log-search');
    if (input) input.value = '';
    setSearchQuery('');
}

function getSearchResults() {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return [];
    return appData.logs.filter(log => matchesSearch(log, needle)).sort(byNewestFirst);
}

function renderSearchResults() {
    const panel = $('#search-results');
    if (!panel) return;

    const needle = searchQuery.trim();
    panel.classList.toggle('is-hidden', !needle);
    if (!needle) return;

    const results = getSearchResults();
    const summary = $('#search-results-summary');
    const list = $('#search-results-list');
    if (summary) {
        summary.textContent = results.length
            ? `${results.length} ${results.length === 1 ? 'entry' : 'entries'} matching “${needle}”`
            : `No entries matching “${needle}”`;
    }
    if (!list) return;

    list.innerHTML = results.length
        ? results.map(searchResultItemHtml).join('')
        : `<li class="empty-state">Try a different word, or log a new entry first.</li>`;
}

function searchResultItemHtml(log) {
    return `
        <li class="log-item">
            <button type="button" class="search-hit" data-goto="${log.type}">
                <div class="log-info">
                    <span class="log-title">${escapeHtml(log.notes || 'Unnamed entry')}</span>
                    <div class="log-meta">
                        <span class="log-meta-tag tag-${log.type}">${escapeHtml(CATEGORY_LABELS[log.type])}</span>
                        <span>${escapeHtml(log.category) || CATEGORY_LABELS[log.type]} · ${formatLogTime(log.timestamp)}</span>
                    </div>
                </div>
                <div class="log-right">
                    <span class="log-amount">${formatLogAmount(log)}</span>
                    <svg class="search-hit-arrow" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                        <polyline points="9 18 15 12 9 6" fill="none" stroke="currentColor" stroke-width="2" />
                    </svg>
                </div>
            </button>
        </li>`;
}

function setupSearch() {
    const input = $('#log-search');
    if (!input) return;

    input.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => setSearchQuery(input.value), 120);
    });

    input.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        clearSearch();
        input.blur();
    });

    $('#search-clear')?.addEventListener('click', () => {
        clearSearch();
        input.focus();
    });

    $('#search-clear-all')?.addEventListener('click', () => {
        clearSearch();
        input.focus();
    });
}

/** "/" focuses search, "Escape" steps back out of it. Ignored while typing elsewhere. */
function setupSearchShortcut() {
    document.addEventListener('keydown', e => {
        const target = e.target;
        const typing =
            target instanceof HTMLElement &&
            (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

        if (e.key === '/' && !typing && !$('.modal-overlay.visible')) {
            const input = $('#log-search');
            if (input) {
                e.preventDefault();
                input.focus();
                input.select();
            }
            return;
        }

        if (e.key === 'Escape' && document.activeElement === $('#log-search')) {
            e.preventDefault();
            clearSearch();
        }
    });
}

// --- Navigation ---
function switchTab(tabName) {
    if (!TAB_INFO[tabName]) return;
    activeTab = tabName;

    $$('.nav-btn[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
    $$('.tab-content').forEach(section => section.classList.toggle('active-content', section.id === `tab-${tabName}`));

    const info = TAB_INFO[tabName];
    const title = $('#page-title');
    const subtitle = $('#page-subtitle');
    if (title) title.textContent = info.title;
    if (subtitle) subtitle.textContent = info.subtitle;

    renderActiveTab();
}

function renderActiveTab() {
    if (activeTab === 'dashboard') renderDashboard();
    else renderCategoryTab(activeTab);
}

// --- Progress Ring Renderer ---
function updateProgressCircle(ringClass, pct, valueText, subLabelText) {
    const circleBar = $(`.progress-ring-bar.${ringClass}`);
    if (!circleBar) return;

    const circumference = 2 * Math.PI * circleBar.r.baseVal.value;
    const clampedPct = clamp(pct, 0, 100);
    circleBar.style.strokeDasharray = `${circumference} ${circumference}`;
    circleBar.style.strokeDashoffset = circumference - (clampedPct / 100) * circumference;

    const container = circleBar.closest('.circular-progress-section');
    if (!container) return;
    const valueEl = $('.circle-value', container);
    const labelEl = $('.circle-label', container);
    if (valueEl) valueEl.textContent = valueText;
    if (labelEl) labelEl.textContent = subLabelText;
}

// --- Renderers ---
function renderDashboard() {
    const totals = getDailyTotals(getTodayDateString());
    const { goals } = appData;

    const setValue = (id, value, unit) => {
        const el = $(`#${id}`);
        if (el) el.innerHTML = `${value} <span class="unit">${unit}</span>`;
    };
    setValue('dash-screentime-val', totals.screentime, 'hrs');
    setValue('dash-calories-val', totals.calories, 'kcal');
    setValue('dash-water-val', totals.water, 'ml');

    const asPercent = (value, goal) => (goal > 0 ? Math.round((value / goal) * 100) : 0);
    const screenPct = asPercent(totals.screentime, goals.screentime);
    const caloriePct = asPercent(totals.calories, goals.calories);
    const waterPct = asPercent(totals.water, goals.water);

    const screenBar = $('#dash-screentime-progress');
    if (screenBar) {
        screenBar.style.width = `${clamp(screenPct, 0, 100)}%`;
        screenBar.style.background =
            screenPct > 100
                ? 'linear-gradient(to right, #f87171, #fca5a5)'
                : 'linear-gradient(to right, var(--color-screentime), var(--color-screentime-light))';
    }
    const calorieBar = $('#dash-calories-progress');
    if (calorieBar) calorieBar.style.width = `${clamp(caloriePct, 0, 100)}%`;
    const waterBar = $('#dash-water-progress');
    if (waterBar) waterBar.style.width = `${clamp(waterPct, 0, 100)}%`;

    const setDesc = (id, pct, goal, suffix) => {
        const el = $(`#${id}`);
        if (el) el.textContent = goal > 0 ? `${pct}% of ${goal}${suffix}` : 'Not set';
    };
    setDesc('dash-screentime-desc', screenPct, goals.screentime, 'h max limit');
    setDesc('dash-calories-desc', caloriePct, goals.calories, ' kcal budget');
    setDesc('dash-water-desc', waterPct, goals.water, ' ml goal');

    renderUnifiedChart();
    renderSearchResults();
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function renderCategoryTab(type) {
    const config = CATEGORY_CONFIG[type];
    if (!config) return;

    const today = getTodayDateString();
    const todayLogs = appData.logs.filter(log => log.date === today && log.type === type).sort(byNewestFirst);
    const totals = getDailyTotals(today);
    const goal = appData.goals[type] || 0;
    const pct = goal > 0 ? Math.round((totals[type] / goal) * 100) : 0;

    updateProgressCircle(config.ring, pct, config.ringValue(totals), config.ringLabel(pct, goal));

    const pill = $(config.pill);
    if (pill) pill.textContent = config.pillText(goal);

    if (config.sessionCountId) {
        const countEl = $(`#${config.sessionCountId}`);
        if (countEl) countEl.textContent = todayLogs.length;
    }

    if (config.totalId) {
        const totalEl = $(`#${config.totalId}`);
        if (totalEl) totalEl.textContent = config.totalValue(totals);
    }

    const remainingEl = $(`#${config.remainingId}`);
    if (remainingEl) {
        const remaining = goal - totals[type];
        if (goal <= 0) {
            remainingEl.textContent = config.noGoal;
            remainingEl.className = 'c-stat-val text-muted';
        } else if (remaining <= 0) {
            remainingEl.textContent = config.overText(remaining);
            remainingEl.className = `c-stat-val ${config.overTone}`;
        } else {
            remainingEl.textContent = config.underText(remaining);
            remainingEl.className = `c-stat-val ${config.underTone}`;
        }
    }

    const dateLabel = $(`#${type}-date-label`);
    if (dateLabel) dateLabel.textContent = config.dateLabel(today);

    renderLogsList(type, todayLogs);
}

function renderLogsList(type, logs) {
    const listEl = $(`#${type}-list`);
    const emptyEl = $(`#${type}-empty`);
    const headingEl = $(`#${type}-logs-title`);
    if (!listEl || !emptyEl) return;

    const needle = searchQuery.trim().toLowerCase();
    const visible = needle ? logs.filter(log => matchesSearch(log, needle)) : logs;

    if (headingEl) {
        headingEl.textContent = needle
            ? `${headingEl.dataset.label} (${visible.length} of ${logs.length})`
            : headingEl.dataset.label;
    }

    const isEmpty = visible.length === 0;
    listEl.style.display = isEmpty ? 'none' : 'flex';
    emptyEl.style.display = isEmpty ? 'block' : 'none';
    if (isEmpty) {
        emptyEl.textContent = needle
            ? `Nothing logged today matches “${searchQuery.trim()}”.`
            : EMPTY_STATES[type];
        return;
    }

    listEl.innerHTML = visible.map(logItemHtml).join('');
}

function logItemHtml(log) {
    const tag = log.type === 'water' ? CATEGORY_LABELS.water : log.category;
    return `
        <li class="log-item">
            <div class="log-info">
                <span class="log-title">${escapeHtml(log.notes || 'Unnamed entry')}</span>
                <div class="log-meta">
                    <span class="log-meta-tag tag-${log.type}">${escapeHtml(tag)}</span>
                    <span>Logged at ${formatLogTime(log.timestamp)}</span>
                </div>
            </div>
            <div class="log-right">
                <span class="log-amount">${formatLogAmount(log)}</span>
                <button class="delete-btn" type="button" data-delete-id="${escapeHtml(log.id)}"
                    title="Delete entry" aria-label="Delete entry">
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                        <use href="#icon-trash"></use>
                    </svg>
                </button>
            </div>
        </li>`;
}

function deleteLog(id) {
    appData.logs = appData.logs.filter(log => log.id !== id);
    saveToStorage();
    renderActiveTab();
}

function addLog(type, amount, category, notes) {
    appData.logs.push({
        id: `${type}_${Date.now()}`,
        date: getTodayDateString(),
        type,
        amount,
        category: category || '',
        notes: notes || '',
        timestamp: Date.now()
    });
    saveToStorage();
    renderActiveTab();
}

// --- Chart.js Integration ---
const CHART_FONT = 'Outfit';
const CHART_TICK_FONT = { family: CHART_FONT, size: 11 };
const CHART_GRID = { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false };

const CHART_LINE_BASE = {
    type: 'line',
    borderWidth: 3,
    pointBorderColor: 'rgba(255, 255, 255, 0.8)',
    pointHoverRadius: 7,
    tension: 0.35,
    fill: true
};

const CHART_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
        legend: {
            position: 'top',
            labels: {
                color: '#9ca3af',
                font: { family: CHART_FONT, size: 12, weight: '500' },
                padding: 20,
                usePointStyle: true,
                pointStyle: 'circle'
            }
        },
        tooltip: {
            backgroundColor: 'rgba(13, 15, 25, 0.95)',
            titleColor: '#fff',
            titleFont: { family: CHART_FONT, size: 14, weight: '700' },
            bodyFont: { family: 'Plus Jakarta Sans', size: 13 },
            bodyColor: '#d1d5db',
            borderColor: 'rgba(255, 255, 255, 0.08)',
            borderWidth: 1,
            padding: 12,
            boxPadding: 6,
            usePointStyle: true
        }
    },
    scales: {
        x: { grid: CHART_GRID, ticks: { color: '#9ca3af', font: CHART_TICK_FONT } },
        yLeft: {
            type: 'linear',
            position: 'left',
            grid: CHART_GRID,
            ticks: { color: '#9ca3af', font: CHART_TICK_FONT },
            title: {
                display: true,
                text: 'Calories (kcal) / Water (ml)',
                color: '#9ca3af',
                font: { family: CHART_FONT, size: 12, weight: '500' }
            },
            min: 0
        },
        yRight: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false, drawBorder: false },
            ticks: { color: '#9ca3af', font: CHART_TICK_FONT },
            title: {
                display: true,
                text: 'Screen Time (hours)',
                color: '#9ca3af',
                font: { family: CHART_FONT, size: 12, weight: '500' }
            },
            min: 0,
            suggestedMax: 12
        }
    }
};

/** Vertical fade used as the line/bar fill. Built once per chart instance. */
function fadeGradient(ctx, [r, g, b], startAlpha, endAlpha = 0) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${startAlpha})`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${endAlpha})`);
    return gradient;
}

function buildChartDatasets(ctx) {
    return [
        {
            label: 'Water (ml)',
            type: 'bar',
            data: [],
            backgroundColor: fadeGradient(ctx, [103, 232, 249], 0.4, 0.05),
            borderColor: 'rgba(103, 232, 249, 0.8)',
            borderWidth: 1.5,
            borderRadius: 6,
            yAxisID: 'yLeft',
            order: 3
        },
        {
            ...CHART_LINE_BASE,
            label: 'Calories (kcal)',
            data: [],
            borderColor: '#f6e05c',
            pointBackgroundColor: '#f6e05c',
            backgroundColor: fadeGradient(ctx, [246, 224, 92], 0.3),
            yAxisID: 'yLeft',
            order: 2
        },
        {
            ...CHART_LINE_BASE,
            label: 'Screen Time (hrs)',
            data: [],
            borderColor: '#a855f7',
            pointBackgroundColor: '#a855f7',
            backgroundColor: fadeGradient(ctx, [168, 85, 247], 0.4),
            yAxisID: 'yRight',
            order: 1
        }
    ];
}

function getChartSeries() {
    const timeframe = $('#chart-timeframe')?.value || '7days';
    const dates =
        timeframe === 'all' ? getAllTimeDates() : getPastDates(timeframe === '30days' ? 30 : 7);
    const rows = getAggregatedDataForDates(dates);
    return {
        labels: rows.map(row => new Date(`${row.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        series: [
            rows.map(row => row.water),
            rows.map(row => row.calories),
            rows.map(row => row.screentime)
        ]
    };
}

/**
 * The chart is created once and afterwards only its data is swapped in, so
 * switching tabs / logging an entry no longer tears down and rebuilds it.
 */
function renderUnifiedChart() {
    const canvas = $('#unifiedChart');
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js unavailable - analytics chart disabled.');
        return;
    }

    const { labels, series } = getChartSeries();

    if (unifiedChart) {
        unifiedChart.data.labels = labels;
        unifiedChart.data.datasets.forEach((dataset, i) => {
            dataset.data = series[i];
        });
        unifiedChart.update();
        return;
    }

    const datasets = buildChartDatasets(canvas.getContext('2d'));
    datasets.forEach((dataset, i) => {
        dataset.data = series[i];
    });

    unifiedChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels, datasets },
        options: CHART_OPTIONS
    });
}

// --- Form Handlers ---
function bindForm(formId, handler) {
    const form = $(`#${formId}`);
    if (form) form.addEventListener('submit', handler);
}

function setupForms() {
    bindForm('form-screentime', e => {
        e.preventDefault();
        const hours = parseInt($('#screen-hours').value, 10) || 0;
        const minutes = parseInt($('#screen-minutes').value, 10) || 0;
        const category = $('#screen-category').value;
        const notes = $('#screen-notes').value || `Screen Session: ${category}`;
        const totalMinutes = hours * 60 + minutes;

        if (totalMinutes <= 0) {
            showToast('Enter a screen time greater than 0 minutes');
            return;
        }

        addLog('screentime', totalMinutes, category, notes);
        e.target.reset();
        $('#screen-hours').value = 0;
        $('#screen-minutes').value = 0;
    });

    bindForm('form-calories', e => {
        e.preventDefault();
        const kcal = parseInt($('#calorie-amount').value, 10) || 0;
        const meal = $('#calorie-meal').value;
        const food = $('#calorie-food').value;

        if (kcal <= 0) {
            showToast('Enter calories greater than 0');
            return;
        }

        addLog('calories', kcal, meal, food);
        e.target.reset();
    });

    bindForm('form-water', e => {
        e.preventDefault();
        const amount = parseInt($('#water-amount').value, 10) || 0;
        const notes = $('#water-notes').value || 'Glass of water';

        if (amount <= 0) {
            showToast('Enter a water amount greater than 0 ml');
            return;
        }

        addLog('water', amount, '', notes);
        e.target.reset();
    });

    $('#chart-timeframe')?.addEventListener('change', renderUnifiedChart);

    $$('.quick-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const amount = parseInt(btn.dataset.amount, 10);
            addLog('water', amount, '', `Quick added +${amount}ml`);
        });
    });

    bindForm('form-modal-goal', e => {
        e.preventDefault();
        const type = $('#modal-category-type').value;
        const raw = $('#modal-goal-input').value;
        appData.goals[type] = type === 'screentime' ? parseFloat(raw) || 0 : parseInt(raw, 10) || 0;
        saveToStorage();
        closeGoalModal();
        renderActiveTab();
    });
}

/**
 * One delegated click handler replaces every inline `onclick` attribute, which
 * keeps the app's functions module-private. Order matters: the gear button
 * lives inside the clickable stat card, so it is matched first.
 */
function setupDelegatedActions() {
    document.addEventListener('click', e => {
        const gearBtn = e.target.closest('.gear-btn[data-goal]');
        if (gearBtn) {
            openGoalModal(gearBtn.dataset.goal);
            return;
        }

        const deleteBtn = e.target.closest('.delete-btn[data-delete-id]');
        if (deleteBtn) {
            deleteLog(deleteBtn.dataset.deleteId);
            return;
        }

        const navBtn = e.target.closest('[data-tab]');
        if (navBtn) {
            switchTab(navBtn.dataset.tab);
            return;
        }

        const gotoEl = e.target.closest('[data-goto]');
        if (gotoEl) {
            switchTab(gotoEl.dataset.goto);
            return;
        }

        const rangeBtn = e.target.closest('.reset-option-btn[data-range]');
        if (rangeBtn) resetStats(rangeBtn.dataset.range);
    });

    // Stat cards are divs, so give them real keyboard activation.
    $$('.stat-card[data-goto]').forEach(card => {
        card.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            switchTab(card.dataset.goto);
        });
    });

    $('#reset-stats-btn')?.addEventListener('click', openResetModal);

    $$('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay) closeModal(overlay);
        });
    });

    $$('[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.closest('.modal-overlay')));
    });
}

// --- Toast Notification ---
function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

// --- Wallpaper & Background Blur ---
function applyCustomBackground(bgDataUrl) {
    const overlay = $('#custom-bg-overlay');
    const resetBtn = $('#bg-reset-btn');
    const glowBg = $('.glow-bg');

    if (overlay) {
        overlay.style.backgroundImage = bgDataUrl ? `url("${bgDataUrl}")` : 'none';
        overlay.classList.toggle('visible', !!bgDataUrl);
    }
    if (glowBg) glowBg.style.opacity = bgDataUrl ? '0.15' : '1';
    if (resetBtn) resetBtn.classList.toggle('is-hidden', !bgDataUrl);
}

/** Persist the wallpaper, downscaling to 1920px first if localStorage refuses it. */
function processAndSaveBgImage(file) {
    const reader = new FileReader();
    reader.onload = e => {
        const rawDataUrl = e.target.result;

        if (file.size < 2 * 1024 * 1024 && storage.set(STORAGE_KEYS.wallpaper, rawDataUrl)) {
            applyCustomBackground(rawDataUrl);
            return;
        }

        const img = new Image();
        img.onload = () => {
            const MAX_DIM = 1920;
            let { width, height } = img;
            if (width > MAX_DIM || height > MAX_DIM) {
                const scale = MAX_DIM / Math.max(width, height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            const compressed = canvas.toDataURL('image/jpeg', 0.88);
            if (!storage.set(STORAGE_KEYS.wallpaper, compressed)) {
                showToast('Wallpaper too large to save');
            }
            applyCustomBackground(compressed);
        };
        img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
}

function applyBgBlur(blurred) {
    bgBlurred = !!blurred;
    $('#custom-bg-overlay')?.classList.toggle('blurred', bgBlurred);
    $('.glow-bg')?.classList.toggle('blurred', bgBlurred);
    $('#bg-blur-backdrop')?.classList.toggle('active', bgBlurred);

    const blurBtn = $('#bg-blur-btn');
    if (blurBtn) {
        blurBtn.classList.toggle('active', bgBlurred);
        blurBtn.setAttribute('aria-pressed', String(bgBlurred));
        blurBtn.title = bgBlurred ? 'Background: Blurred (Click to unblur)' : 'Background: Unblurred (Click to blur)';
    }
}

function toggleBgBlur() {
    applyBgBlur(!bgBlurred);
    storage.set(STORAGE_KEYS.bgBlur, bgBlurred ? 'true' : 'false');
}

// --- Sidebar Color ---
function hexToRgba(hex, alpha) {
    const value = normalizeHex(hex) || DEFAULT_SIDEBAR_COLOR;
    const r = parseInt(value.slice(1, 3), 16);
    const g = parseInt(value.slice(3, 5), 16);
    const b = parseInt(value.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applySidebarColor(hexColor, persist = true) {
    const normalized = normalizeHex(hexColor) || DEFAULT_SIDEBAR_COLOR;
    currentSidebarColor = normalized;

    const sidebar = $('.sidebar');
    if (sidebar) {
        sidebar.style.backgroundColor = normalized;
        sidebar.style.borderColor = hexToRgba(normalized, 0.4);
    }

    const colorBtn = $('#sidebar-color-btn');
    if (colorBtn) {
        colorBtn.title = `Sidebar Color: ${normalized.toUpperCase()} (Click to change)`;
        colorBtn.style.setProperty('--swatch', normalized);
    }

    if (persist) storage.set(STORAGE_KEYS.sidebarColor, normalized);
}

function setupWallpaperControls() {
    const uploadInput = $('#bg-upload-input');

    $('#bg-picker-btn')?.addEventListener('click', () => uploadInput?.click());
    uploadInput?.addEventListener('change', e => {
        const file = e.target.files && e.target.files[0];
        if (file) processAndSaveBgImage(file);
    });

    $('#bg-reset-btn')?.addEventListener('click', () => {
        storage.remove(STORAGE_KEYS.wallpaper);
        if (uploadInput) uploadInput.value = '';
        applyCustomBackground(null);
        showToast('Wallpaper reset');
    });

    $('#bg-blur-btn')?.addEventListener('click', toggleBgBlur);

    const savedBg = storage.get(STORAGE_KEYS.wallpaper);
    if (savedBg) applyCustomBackground(savedBg);

    applyBgBlur(storage.get(STORAGE_KEYS.bgBlur) === 'true');

    const savedSidebarColor = normalizeHex(storage.get(STORAGE_KEYS.sidebarColor));
    applySidebarColor(savedSidebarColor || DEFAULT_SIDEBAR_COLOR);
}

// --- Modals ---
function openModal(overlay) {
    if (overlay) overlay.classList.add('visible');
}

function closeModal(overlay) {
    if (!overlay) return;
    if (overlay.id === 'color-picker-modal') {
        closeColorPicker(false);
        return;
    }
    overlay.classList.remove('visible');
}

const GOAL_MODAL_CONFIG = {
    screentime: {
        title: 'Screen Time Limit',
        subtitle: 'Set the maximum screen time allowed per day',
        label: 'Daily Limit (hours)',
        step: '0.1',
        max: '24',
        placeholder: 'e.g. 6.0'
    },
    calories: {
        title: 'Calorie Budget',
        subtitle: 'Set your daily calorie intake target',
        label: 'Daily Budget (kcal)',
        step: '1',
        max: '10000',
        placeholder: 'e.g. 2200'
    },
    water: {
        title: 'Hydration Goal',
        subtitle: 'Set your daily hydration intake target',
        label: 'Daily Goal (ml)',
        step: '1',
        max: '10000',
        placeholder: 'e.g. 2500'
    }
};

function openGoalModal(type) {
    const config = GOAL_MODAL_CONFIG[type];
    if (!config) return;

    $('#modal-category-type').value = type;
    $('#modal-title').textContent = config.title;
    $('#modal-subtitle').textContent = config.subtitle;
    $('#modal-input-label').textContent = config.label;

    const inputEl = $('#modal-goal-input');
    inputEl.step = config.step;
    inputEl.max = config.max;
    inputEl.placeholder = config.placeholder;
    inputEl.value = appData.goals[type] || '';

    openModal($('#goal-modal'));
    inputEl.focus();
}

function closeGoalModal() {
    $('#goal-modal')?.classList.remove('visible');
}

function openResetModal() {
    openModal($('#reset-modal'));
}

function closeResetModal() {
    $('#reset-modal')?.classList.remove('visible');
}

function resetStats(range) {
    const today = getTodayDateString();

    if (range === 'all') {
        appData.logs = [];
    } else if (range === 'today') {
        appData.logs = appData.logs.filter(log => log.date !== today);
    } else {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - (range === 'week' ? 7 : 30));
        const cutoffTs = cutoff.getTime();
        appData.logs = appData.logs.filter(log => log.timestamp >= cutoffTs);
    }

    saveToStorage();
    closeResetModal();
    switchTab('dashboard');
    showToast('Stats reset successfully');
}

function setupEscapeToClose() {
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        const open = $('.modal-overlay.visible');
        if (!open) return;
        if (open.id === 'color-picker-modal') closeColorPicker(false);
        else open.classList.remove('visible');
    });
}

// --- Color Utilities ---
function normalizeHex(hex) {
    if (typeof hex !== 'string') return null;
    let value = hex.trim().replace(/^#/, '');
    if (value.length === 3) value = value.split('').map(char => char + char).join('');
    return /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : null;
}

function hexToRgb(hex) {
    const value = normalizeHex(hex) || '#000000';
    return {
        r: parseInt(value.slice(1, 3), 16),
        g: parseInt(value.slice(3, 5), 16),
        b: parseInt(value.slice(5, 7), 16)
    };
}

const rgbToHex = (r, g, b) =>
    `#${[r, g, b]
        .map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0'))
        .join('')}`;

function rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const hsvToHex = (h, s, v) => {
    const { r, g, b } = hsvToRgb(h, s, v);
    return rgbToHex(r, g, b);
};

/** WCAG 2.1 contrast ratio, used to warn about sidebar colors that hide the text. */
function contrastRatio(hexA, hexB) {
    const luminance = hex => {
        const { r, g, b } = hexToRgb(hex);
        const channel = value => {
            const s = value / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };

    const a = luminance(hexA);
    const b = luminance(hexB);
    const [high, low] = a > b ? [a, b] : [b, a];
    return (high + 0.05) / (low + 0.05);
}

// --- Custom Color Picker (hue ring + saturation/brightness square) ---
const COLOR_PRESETS = [
    '#0d0f19', '#111827', '#1f2937', '#374151', '#6b7280', '#9ca3af', '#d1d5db', '#f9fafb',
    '#f87171', '#f6e05c', '#f59e0b', '#fcd34d', '#22c55e', '#14b8a6', '#67e8f9',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899'
];

const MAX_RECENT_COLORS = 10;

const picker = {
    hsv: { h: 0, s: 0, v: 0 },
    original: DEFAULT_SIDEBAR_COLOR,
    open: false,
    geometry: null
};


/**
 * The wheel is measured once per open instead of on every pointermove: the
 * modal is position:fixed, so the box only changes on resize.
 *
 * The panel also scales in from 0.9, so a reading taken while that transition
 * runs is both shrunk and offset. Sizes therefore come from offsetWidth
 * (untransformed layout) and the scale is divided back out of the rects, which
 * keeps the hue ring and the SV square hit-tested against the settled layout.
 */
function measureWheelGeometry() {
    const wheel = $('#color-wheel');
    const svArea = $('#sv-area');
    if (!wheel || !svArea) return null;

    const wheelRect = wheel.getBoundingClientRect();
    const svRect = svArea.getBoundingClientRect();
    const ringPx = parseFloat(getComputedStyle(wheel).getPropertyValue('--cp-ring')) || 26;
    const size = wheel.offsetWidth;
    const scale = size ? wheelRect.width / size : 1;

    return {
        scale,
        centerX: wheelRect.left + wheelRect.width / 2,
        centerY: wheelRect.top + wheelRect.height / 2,
        size,
        ringPx,
        radius: size / 2 - ringPx / 2,
        svLeft: svRect.left,
        svTop: svRect.top,
        svWidth: svRect.width / scale,
        svHeight: svRect.height / scale
    };
}

function getWheelGeometry() {
    if (picker.geometry) return picker.geometry;

    const geometry = measureWheelGeometry();
    // A mid-transition reading is only good for this frame; wait for the panel to
    // settle before caching so a scaled box can never stick around.
    if (geometry && geometry.scale > 0.995) picker.geometry = geometry;
    return geometry;
}

function invalidateWheelGeometry() {
    picker.geometry = null;
    if (picker.open) renderPicker(false);
}

function setPickerColor(hex) {
    const valid = normalizeHex(hex);
    if (!valid) return false;
    const { r, g, b } = hexToRgb(valid);
    picker.hsv = rgbToHsv(r, g, b);
    renderPicker();
    return true;
}

function renderContrastNote(hex) {
    const note = $('#picker-contrast');
    if (!note) return;

    const ratio = contrastRatio(hex, SIDEBAR_TEXT_COLOR);
    const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : null;
    note.textContent = grade
        ? `Contrast ${ratio.toFixed(1)}:1 · ${grade} for sidebar text`
        : `Contrast ${ratio.toFixed(1)}:1 · sidebar text may be hard to read`;
    note.classList.toggle('is-warn', !grade);
}

function renderPicker(live = true) {
    const geometry = getWheelGeometry();
    const hueRing = $('#hue-ring');
    const svArea = $('#sv-area');
    if (!geometry || !hueRing || !svArea) return;

    const { h, s, v } = picker.hsv;
    const radians = (h * Math.PI) / 180;
    const hueHandle = $('#hue-handle');
    const svHandle = $('#sv-handle');

    if (hueHandle) {
        hueHandle.style.transform =
            `translate(-50%, -50%) translate(${geometry.size / 2 + geometry.radius * Math.sin(radians)}px, ` +
            `${geometry.size / 2 - geometry.radius * Math.cos(radians)}px)`;
    }
    if (svHandle) {
        svHandle.style.transform =
            `translate(-50%, -50%) translate(${s * geometry.svWidth}px, ${(1 - v) * geometry.svHeight}px)`;
    }

    svArea.style.backgroundColor = hsvToHex(h, 1, 1);

    const hex = hsvToHex(h, s, v);
    const preview = $('#picker-preview');
    if (preview) preview.style.backgroundColor = hex;

    const hexInput = $('#picker-hex');
    if (hexInput && document.activeElement !== hexInput) hexInput.value = hex.slice(1).toUpperCase();

    hueRing.setAttribute('aria-valuenow', String(Math.round(h)));
    svArea.setAttribute('aria-valuetext', `Saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`);

    $$('.preset-swatch').forEach(swatch => {
        swatch.setAttribute('aria-pressed', String(swatch.dataset.hex === hex));
    });

    renderContrastNote(hex);

    if (live && picker.open) applySidebarColor(hex, false);
}

function setHueFromPointer(clientX, clientY) {
    const geometry = getWheelGeometry();
    if (!geometry) return;
    const dx = clientX - geometry.centerX;
    const dy = clientY - geometry.centerY;
    if (Math.hypot(dx, dy) < geometry.size / 2 - geometry.ringPx) return;
    if (dx === 0 && dy === 0) return;

    const angle = Math.atan2(dx, -dy) * (180 / Math.PI);
    picker.hsv.h = angle < 0 ? angle + 360 : angle;
    renderPicker();
}

function setSvFromPointer(clientX, clientY) {
    const geometry = getWheelGeometry();
    if (!geometry) return;
    picker.hsv.s = clamp01((clientX - geometry.svLeft) / geometry.svWidth);
    picker.hsv.v = clamp01(1 - (clientY - geometry.svTop) / geometry.svHeight);
    renderPicker();
}

/**
 * Makes a slider-like element draggable and keyboard operable.
 * `onDrag` receives viewport coordinates, matching setHueFromPointer /
 * setSvFromPointer -- not the raw event.
 */
function bindSlider(el, onDrag, onKey) {
    if (!el) return;

    el.addEventListener('pointerdown', e => {
        e.preventDefault();
        $('#picker-hex')?.blur();
        el.setPointerCapture(e.pointerId);
        onDrag(e.clientX, e.clientY);
    });

    el.addEventListener('pointermove', e => {
        if (el.hasPointerCapture(e.pointerId)) onDrag(e.clientX, e.clientY);
    });

    ['pointerup', 'pointercancel'].forEach(event =>
        el.addEventListener(event, e => {
            if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
        })
    );

    el.addEventListener('keydown', onKey);
}

function onHueKeydown(e) {
    const step = e.shiftKey ? 10 : 1;
    let delta = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
    else if (e.key === 'Home') delta = -picker.hsv.h;
    else if (e.key === 'End') delta = 359 - picker.hsv.h;
    else return;

    e.preventDefault();
    picker.hsv.h = ((picker.hsv.h + delta) % 360 + 360) % 360;
    renderPicker();
}

function onSvKeydown(e) {
    const step = e.shiftKey ? 0.1 : 0.01;
    let dSaturation = 0;
    let dValue = 0;

    if (e.key === 'ArrowRight') dSaturation = step;
    else if (e.key === 'ArrowLeft') dSaturation = -step;
    else if (e.key === 'ArrowUp') dValue = step;
    else if (e.key === 'ArrowDown') dValue = -step;
    else if (e.key === 'Home') dSaturation = -picker.hsv.s;
    else if (e.key === 'End') dSaturation = 1 - picker.hsv.s;
    else return;

    e.preventDefault();
    picker.hsv.s = clamp01(picker.hsv.s + dSaturation);
    picker.hsv.v = clamp01(picker.hsv.v + dValue);
    renderPicker();
}

// --- Recent Colors ---
function getRecentColors() {
    return storage
        .getJSON(STORAGE_KEYS.recentColors, [])
        .filter(color => normalizeHex(color))
        .map(normalizeHex);
}

function rememberColor(hex) {
    const next = [hex, ...getRecentColors().filter(color => color !== hex)].slice(0, MAX_RECENT_COLORS);
    storage.set(STORAGE_KEYS.recentColors, JSON.stringify(next));
}

function buildSwatchGrid(container, colors) {
    container.innerHTML = colors
        .map(
            color => `
            <button class="preset-swatch" type="button" data-hex="${color}"
                style="background-color: ${color}"
                title="${color.toUpperCase()}" aria-label="Use ${color.toUpperCase()}"
                aria-pressed="false"></button>`
        )
        .join('');
}

function renderRecentColors() {
    const section = $('#picker-recents-section');
    const grid = $('#picker-recents');
    if (!section || !grid) return;

    const recents = getRecentColors();
    section.classList.toggle('is-hidden', recents.length === 0);
    if (recents.length) buildSwatchGrid(grid, recents);
}

// --- Picker Lifecycle ---
function openColorPicker() {
    picker.original = currentSidebarColor;
    picker.open = true;
    setPickerColor(currentSidebarColor);
    invalidateWheelGeometry();

    $('#color-picker-modal').classList.add('visible');
    renderRecentColors();
    requestAnimationFrame(() => renderPicker(false));
}

function closeColorPicker(commit) {
    const modal = $('#color-picker-modal');
    if (!modal || !picker.open) return;

    if (commit) {
        const hex = hsvToHex(picker.hsv.h, picker.hsv.s, picker.hsv.v);
        applySidebarColor(hex, true);
        rememberColor(hex);
        showToast(`Sidebar color set to ${hex.toUpperCase()}`);
    } else {
        applySidebarColor(picker.original, false);
    }

    picker.open = false;
    modal.classList.remove('visible');
    invalidateWheelGeometry();
}

async function copyHexToClipboard(hex) {
    try {
        await navigator.clipboard.writeText(hex);
        showToast(`Copied ${hex.toUpperCase()}`);
        return;
    } catch {
        /* fall through to the legacy path */
    }

    const scratch = document.createElement('textarea');
    scratch.value = hex;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    const copied = document.execCommand('copy');
    scratch.remove();
    showToast(copied ? `Copied ${hex.toUpperCase()}` : 'Copy failed');
}

function setupColorPicker() {
    if (!$('#color-picker-modal')) return;

    $('#sidebar-color-btn')?.addEventListener('click', openColorPicker);

    const presetGrid = $('#picker-presets');
    if (presetGrid) buildSwatchGrid(presetGrid, COLOR_PRESETS);

    bindSlider($('#hue-ring'), setHueFromPointer, onHueKeydown);
    bindSlider($('#sv-area'), setSvFromPointer, onSvKeydown);

    const hexInput = $('#picker-hex');
    hexInput?.addEventListener('input', () => setPickerColor(hexInput.value));
    hexInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            closeColorPicker(true);
        }
    });

    $('#picker-copy')?.addEventListener('click', () => copyHexToClipboard(hsvToHex(picker.hsv.h, picker.hsv.s, picker.hsv.v)));
    $('#picker-select')?.addEventListener('click', () => closeColorPicker(true));
    $$('[data-close-picker]').forEach(btn => btn.addEventListener('click', () => closeColorPicker(false)));

    // One delegated handler covers both swatch grids.
    $('#color-picker-modal').addEventListener('click', e => {
        const swatch = e.target.closest('.preset-swatch[data-hex]');
        if (swatch) setPickerColor(swatch.dataset.hex);
    });

    // The panel animates in from scale(0.9), which shrinks and offsets the wheel
    // under the pointer; re-measure once it has landed so the ring and the SV
    // square line up with the settled layout.
    $('.color-picker-panel')?.addEventListener('transitionend', e => {
        if (e.target === e.currentTarget && e.propertyName === 'transform') {
            invalidateWheelGeometry();
        }
    });

    // The overlay is fixed, so the wheel box only moves on resize.
    window.addEventListener('resize', invalidateWheelGeometry);
}

// --- App Initialization ---
function init() {
    const currentDate = $('#current-date');
    if (currentDate) {
        currentDate.textContent = new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    loadData();
    setupDelegatedActions();
    setupForms();
    setupSearch();
    setupSearchShortcut();
    setupColorPicker();
    setupWallpaperControls();
    setupEscapeToClose();
    switchTab('dashboard');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

})();