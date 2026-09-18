// HealthTracker - Core Logic & Data Controller

const STORAGE_KEY = 'aurafit_data';
const GOALS = { screentime: 0.0, calories: 0, water: 0 };

let appData = { goals: { ...GOALS }, logs: [] };
let activeTab = 'dashboard';
let unifiedChartInstance = null;

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

// --- Data Management & LocalStorage ---
function loadData() {
    try {
        const rawData = localStorage.getItem(STORAGE_KEY);
        appData = rawData ? JSON.parse(rawData) : { goals: { ...GOALS }, logs: [] };
    } catch (e) {
        console.error('Failed to parse app data, resetting storage.', e);
        appData = { goals: { ...GOALS }, logs: [] };
    }
    if (!appData.goals) appData.goals = { ...GOALS };
    if (!Array.isArray(appData.logs)) appData.logs = [];
}

function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

// --- Aggregate Data Calculators ---
function getDailyTotals(dateStr) {
    const totals = { screentime: 0, calories: 0, water: 0, screenMinutes: 0 };
    for (const log of appData.logs) {
        if (log.date === dateStr) {
            if (log.type === 'screentime') totals.screenMinutes += log.amount;
            else if (log.type === 'calories') totals.calories += log.amount;
            else if (log.type === 'water') totals.water += log.amount;
        }
    }
    totals.screentime = parseFloat((totals.screenMinutes / 60).toFixed(1));
    return totals;
}

function getAggregatedDataForDates(datesArray) {
    return datesArray.map(dateStr => {
        const totals = getDailyTotals(dateStr);
        return { date: dateStr, screentime: totals.screentime, calories: totals.calories, water: totals.water };
    });
}

// --- Navigation Tab Switching ---
const TAB_INFO = {
    dashboard: { title: 'Dashboard Overview', subtitle: 'Your vitals and digital habits at a glance' },
    screentime: { title: 'Screen Time Tracker', subtitle: 'Monitor and reduce your digital usage' },
    calories: { title: 'Nutrition & Calories', subtitle: 'Fuel your body and keep track of intake' },
    water: { title: 'Hydration Tracker', subtitle: 'Log water and reach your daily target' }
};

function switchTab(tabName) {
    activeTab = tabName;

    document.querySelectorAll('.nav-btn').forEach(btn =>
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName)
    );
    document.querySelectorAll('.tab-content').forEach(section =>
        section.classList.toggle('active-content', section.id === `tab-${tabName}`)
    );

    const info = TAB_INFO[tabName];
    if (info) {
        document.getElementById('page-title').textContent = info.title;
        document.getElementById('page-subtitle').textContent = info.subtitle;
    }

    if (tabName === 'dashboard') {
        renderDashboard();
    } else {
        renderCategoryTab(tabName);
    }
}
window.switchTab = switchTab;

// --- Progress Circle Ring Renderer ---
function updateProgressCircle(ringClass, pct, valueText, subLabelText) {
    const circleBar = document.querySelector(`.progress-ring-bar.${ringClass}`);
    if (circleBar) {
        const radius = circleBar.r.baseVal.value;
        const circumference = 2 * Math.PI * radius;
        const clampedPct = Math.min(100, Math.max(0, pct));
        circleBar.style.strokeDasharray = `${circumference} ${circumference}`;
        circleBar.style.strokeDashoffset = circumference - (clampedPct / 100) * circumference;

        const container = circleBar.closest('.circular-progress-section');
        if (container) {
            const valEl = container.querySelector('.circle-value');
            const pctEl = container.querySelector('.circle-label');
            if (valEl) valEl.textContent = valueText;
            if (pctEl) pctEl.textContent = subLabelText;
        }
    }
}

// --- Render Functions ---

// 1. Dashboard Render
function renderDashboard() {
    const today = getTodayDateString();
    const totals = getDailyTotals(today);
    const { goals } = appData;

    document.getElementById('dash-screentime-val').innerHTML = `${totals.screentime} <span class="unit">hrs</span>`;
    document.getElementById('dash-calories-val').innerHTML = `${totals.calories} <span class="unit">kcal</span>`;
    document.getElementById('dash-water-val').innerHTML = `${totals.water} <span class="unit">ml</span>`;

    const screenPct = goals.screentime > 0 ? Math.round((totals.screentime / goals.screentime) * 100) : 0;
    const caloriePct = goals.calories > 0 ? Math.round((totals.calories / goals.calories) * 100) : 0;
    const waterPct = goals.water > 0 ? Math.round((totals.water / goals.water) * 100) : 0;

    const screenBar = document.getElementById('dash-screentime-progress');
    screenBar.style.width = `${Math.min(100, screenPct)}%`;
    document.getElementById('dash-calories-progress').style.width = `${Math.min(100, caloriePct)}%`;
    document.getElementById('dash-water-progress').style.width = `${Math.min(100, waterPct)}%`;

    document.getElementById('dash-screentime-desc').textContent = goals.screentime > 0 ? `${screenPct}% of ${goals.screentime}h max limit` : 'No limit set';
    document.getElementById('dash-calories-desc').textContent = goals.calories > 0 ? `${caloriePct}% of ${goals.calories} kcal budget` : 'No budget set';
    document.getElementById('dash-water-desc').textContent = goals.water > 0 ? `${waterPct}% of ${goals.water} ml goal` : 'No goal set';

    screenBar.style.background = screenPct > 100
        ? 'linear-gradient(to right, #ef4444, #f87171)'
        : 'linear-gradient(to right, var(--color-screentime), var(--color-screentime-light))';

    renderUnifiedChart();
}

// Helper to escape HTML characters
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// 2. Individual Category Tab Render
function renderCategoryTab(type) {
    const today = getTodayDateString();
    const todayLogs = appData.logs
        .filter(log => log.date === today && log.type === type)
        .sort((a, b) => b.timestamp - a.timestamp);

    const totals = getDailyTotals(today);
    const goal = appData.goals[type] || 0;
    const pct = goal > 0 ? Math.round((totals[type] / goal) * 100) : 0;

    if (type === 'screentime') {
        updateProgressCircle('ring-screentime', pct, `${totals.screentime}h`, goal > 0 ? `${pct}% of limit` : 'No limit set');

        const pill = document.querySelector('.limit-screentime');
        if (pill) pill.textContent = goal > 0 ? `Goal: max ${goal}h` : 'Goal: Not set';

        document.getElementById('screentime-session-count').textContent = todayLogs.length;
        const remaining = goal - totals.screentime;
        const remVal = document.getElementById('screentime-remaining');

        if (goal <= 0) {
            remVal.textContent = 'No limit';
            remVal.className = 'c-stat-val text-muted';
        } else if (remaining <= 0) {
            remVal.textContent = 'Exceeded!';
            remVal.className = 'c-stat-val text-red';
        } else {
            remVal.textContent = `${remaining.toFixed(1)} hrs`;
            remVal.className = 'c-stat-val text-green';
        }

        document.getElementById('screentime-date-label').textContent = `Logs for ${formatHumanDate(today)}`;

    } else if (type === 'calories') {
        updateProgressCircle('ring-calories', pct, `${totals.calories}`, goal > 0 ? `${pct}% of budget` : 'No budget set');

        const pill = document.querySelector('.target-calories');
        if (pill) pill.textContent = goal > 0 ? `Target: ${goal.toLocaleString()} kcal` : 'Target: Not set';

        document.getElementById('calories-total-val').textContent = `${totals.calories} kcal`;
        const remaining = goal - totals.calories;
        const remVal = document.getElementById('calories-remaining');

        if (goal <= 0) {
            remVal.textContent = 'No budget';
            remVal.className = 'c-stat-val text-muted';
        } else if (remaining <= 0) {
            remVal.textContent = `${Math.abs(remaining)} kcal over`;
            remVal.className = 'c-stat-val text-orange';
        } else {
            remVal.textContent = `${remaining} kcal`;
            remVal.className = 'c-stat-val text-green';
        }

        document.getElementById('calories-date-label').textContent = `Meals eaten on ${formatHumanDate(today)}`;

    } else if (type === 'water') {
        updateProgressCircle('ring-water', pct, `${totals.water}ml`, goal > 0 ? `${pct}% of goal` : 'No goal set');

        const pill = document.querySelector('.target-water');
        if (pill) pill.textContent = goal > 0 ? `Target: ${goal.toLocaleString()} ml` : 'Target: Not set';

        document.getElementById('water-total-val').textContent = `${totals.water} ml`;
        const remaining = goal - totals.water;
        const remVal = document.getElementById('water-remaining');

        if (goal <= 0) {
            remVal.textContent = 'No goal';
            remVal.className = 'c-stat-val text-muted';
        } else if (remaining <= 0) {
            remVal.textContent = 'Goal Achieved!';
            remVal.className = 'c-stat-val text-green';
        } else {
            remVal.textContent = `${remaining} ml`;
            remVal.className = 'c-stat-val text-blue';
        }

        document.getElementById('water-date-label').textContent = `Water intake on ${formatHumanDate(today)}`;
    }

    renderLogsList(type, todayLogs);
}

const DELETE_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;

function renderLogsList(type, logs) {
    const listEl = document.getElementById(`${type}-list`);
    const emptyEl = document.getElementById(`${type}-empty`);

    if (logs.length === 0) {
        listEl.style.display = 'none';
        emptyEl.style.display = 'block';
        return;
    }

    emptyEl.style.display = 'none';
    listEl.style.display = 'flex';

    listEl.innerHTML = logs.map(log => {
        const timeStr = new Date(log.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const metaTag = `<span class="log-meta-tag tag-${type}">${type === 'water' ? 'Hydration' : escapeHtml(log.category)}</span>`;

        let amountText = `${log.amount} ml`;
        if (type === 'screentime') {
            const h = Math.floor(log.amount / 60);
            const m = log.amount % 60;
            amountText = h > 0 ? `${h}h ${m}m` : `${m}m`;
        } else if (type === 'calories') {
            amountText = `${log.amount} kcal`;
        }

        return `
            <li class="log-item">
                <div class="log-info">
                    <span class="log-title">${escapeHtml(log.notes || 'Unnamed entry')}</span>
                    <div class="log-meta">
                        ${metaTag}
                        <span>Logged at ${timeStr}</span>
                    </div>
                </div>
                <div class="log-right">
                    <span class="log-amount">${amountText}</span>
                    <button class="delete-btn" onclick="deleteLog('${log.id}', '${type}')" title="Delete entry">
                        ${DELETE_ICON_SVG}
                    </button>
                </div>
            </li>`;
    }).join('');
}

function deleteLog(id, currentType) {
    appData.logs = appData.logs.filter(log => log.id !== id);
    saveToStorage();
    if (activeTab === 'dashboard') renderDashboard();
    else renderCategoryTab(currentType);
}
window.deleteLog = deleteLog;

// --- Helper for Adding Logs ---
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
    renderCategoryTab(type);
}

// --- Chart.js Integration ---
function createGradient(ctx, colorStops) {
    const grad = ctx.createLinearGradient(0, 0, 0, 400);
    colorStops.forEach(([offset, color]) => grad.addColorStop(offset, color));
    return grad;
}

function renderUnifiedChart() {
    const ctx = document.getElementById('unifiedChart').getContext('2d');
    const timeframe = document.getElementById('chart-timeframe').value;

    const dates = timeframe === 'all'
        ? getAllTimeDates()
        : getPastDates(timeframe === '30days' ? 30 : 7);
    const aggregatedData = getAggregatedDataForDates(dates);

    const labels = dates.map(d => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const screenHoursData = aggregatedData.map(d => d.screentime);
    const caloriesData = aggregatedData.map(d => d.calories);
    const waterData = aggregatedData.map(d => d.water);

    if (unifiedChartInstance) unifiedChartInstance.destroy();

    const purpleGradient = createGradient(ctx, [[0, 'rgba(168, 85, 247, 0.4)'], [1, 'rgba(168, 85, 247, 0.0)']]);
    const orangeGradient = createGradient(ctx, [[0, 'rgba(249, 115, 22, 0.3)'], [1, 'rgba(249, 115, 22, 0.0)']]);
    const blueGradient = createGradient(ctx, [[0, 'rgba(14, 165, 233, 0.4)'], [1, 'rgba(14, 165, 233, 0.05)']]);

    const commonLineOptions = {
        type: 'line',
        borderWidth: 3,
        pointBorderColor: 'rgba(255, 255, 255, 0.8)',
        pointHoverRadius: 7,
        tension: 0.35,
        fill: true
    };

    const fontOutfit = { family: 'Outfit', size: 11 };
    const gridStyle = { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false };

    unifiedChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Water (ml)',
                    data: waterData,
                    type: 'bar',
                    backgroundColor: blueGradient,
                    borderColor: 'rgba(14, 165, 233, 0.8)',
                    borderWidth: 1.5,
                    borderRadius: 6,
                    yAxisID: 'yLeft',
                    order: 3
                },
                {
                    ...commonLineOptions,
                    label: 'Calories (kcal)',
                    data: caloriesData,
                    borderColor: '#f97316',
                    pointBackgroundColor: '#f97316',
                    backgroundColor: orangeGradient,
                    yAxisID: 'yLeft',
                    order: 2
                },
                {
                    ...commonLineOptions,
                    label: 'Screen Time (hrs)',
                    data: screenHoursData,
                    borderColor: '#a855f7',
                    pointBackgroundColor: '#a855f7',
                    backgroundColor: purpleGradient,
                    yAxisID: 'yRight',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#9ca3af',
                        font: { family: 'Outfit', size: 12, weight: '500' },
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(13, 15, 25, 0.95)',
                    titleColor: '#fff',
                    titleFont: { family: 'Outfit', size: 14, weight: '700' },
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
                x: { grid: gridStyle, ticks: { color: '#9ca3af', font: fontOutfit } },
                yLeft: {
                    type: 'linear',
                    position: 'left',
                    grid: gridStyle,
                    ticks: { color: '#9ca3af', font: fontOutfit },
                    title: { display: true, text: 'Calories (kcal) / Water (ml)', color: '#9ca3af', font: { family: 'Outfit', size: 12, weight: '500' } },
                    min: 0
                },
                yRight: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false, drawBorder: false },
                    ticks: { color: '#9ca3af', font: fontOutfit },
                    title: { display: true, text: 'Screen Time (hours)', color: '#9ca3af', font: { family: 'Outfit', size: 12, weight: '500' } },
                    min: 0,
                    suggestedMax: 12
                }
            }
        }
    });
}

// --- Form & Submit Handlers ---
function setupEventListeners() {
    const timeframeSelect = document.getElementById('chart-timeframe');
    if (timeframeSelect) timeframeSelect.addEventListener('change', renderUnifiedChart);

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
    });

    const screenForm = document.getElementById('form-screentime');
    if (screenForm) {
        screenForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const h = parseInt(document.getElementById('screen-hours').value) || 0;
            const m = parseInt(document.getElementById('screen-minutes').value) || 0;
            const cat = document.getElementById('screen-category').value;
            const notes = document.getElementById('screen-notes').value || `Screen Session: ${cat}`;
            const totalMinutes = (h * 60) + m;

            if (totalMinutes <= 0) {
                alert('Please enter a screen time greater than 0 minutes.');
                return;
            }

            addLog('screentime', totalMinutes, cat, notes);
            screenForm.reset();
            document.getElementById('screen-hours').value = 0;
            document.getElementById('screen-minutes').value = 0;
        });
    }

    const calorieForm = document.getElementById('form-calories');
    if (calorieForm) {
        calorieForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const kcal = parseInt(document.getElementById('calorie-amount').value) || 0;
            const meal = document.getElementById('calorie-meal').value;
            const food = document.getElementById('calorie-food').value;

            if (kcal <= 0) {
                alert('Please enter calories greater than 0.');
                return;
            }

            addLog('calories', kcal, meal, food);
            calorieForm.reset();
        });
    }

    const waterForm = document.getElementById('form-water');
    if (waterForm) {
        waterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const amount = parseInt(document.getElementById('water-amount').value) || 0;
            const notes = document.getElementById('water-notes').value || 'Glass of water';

            if (amount <= 0) {
                alert('Please enter a water amount greater than 0 ml.');
                return;
            }

            logWater(amount, notes);
            waterForm.reset();
        });
    }

    document.querySelectorAll('.quick-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const amount = parseInt(btn.getAttribute('data-amount'));
            logWater(amount, `Quick added +${amount}ml`);
        });
    });

    const modalGoalForm = document.getElementById('form-modal-goal');
    if (modalGoalForm) {
        modalGoalForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const type = document.getElementById('modal-category-type').value;
            const rawVal = document.getElementById('modal-goal-input').value;
            const val = type === 'screentime' ? parseFloat(rawVal) || 0 : parseInt(rawVal) || 0;

            appData.goals[type] = val;
            saveToStorage();
            closeGoalModal();

            if (activeTab === 'dashboard') renderDashboard();
            else renderCategoryTab(type);
        });
    }

    const resetStatsBtn = document.getElementById('reset-stats-btn');
    if (resetStatsBtn) resetStatsBtn.addEventListener('click', openResetModal);

    document.querySelectorAll('.reset-option-btn').forEach(btn => {
        btn.addEventListener('click', () => resetStats(btn.getAttribute('data-range')));
    });

    setupFooterToolbarControls();
}

// --- Custom Background & Customization Handlers ---
let isBgBlurred = false;

const DEFAULT_SIDEBAR_COLOR = '#0d0f19';

function hexToRgba(hex, alpha) {
    const normalized = hex.replace('#', '');
    const r = parseInt(normalized.substring(0, 2), 16);
    const g = parseInt(normalized.substring(2, 4), 16);
    const b = parseInt(normalized.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyCustomBackground(bgDataUrl) {
    const overlay = document.getElementById('custom-bg-overlay');
    const resetBtn = document.getElementById('bg-reset-btn');
    const glowBg = document.querySelector('.glow-bg');

    if (bgDataUrl) {
        if (overlay) {
            overlay.style.backgroundImage = `url("${bgDataUrl}")`;
            overlay.style.backgroundSize = 'cover';
            overlay.style.backgroundRepeat = 'no-repeat';
            overlay.style.backgroundPosition = 'center';
            overlay.classList.add('visible');
        }
        if (glowBg) glowBg.style.opacity = '0.15';
        if (resetBtn) resetBtn.style.display = 'inline-flex';
    } else {
        if (overlay) {
            overlay.style.backgroundImage = 'none';
            overlay.classList.remove('visible');
        }
        if (glowBg) glowBg.style.opacity = '1';
        if (resetBtn) resetBtn.style.display = 'none';
    }
}

function processAndSaveBgImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const rawDataUrl = e.target.result;

        if (file.size < 2 * 1024 * 1024) {
            try {
                localStorage.setItem('aurafit_custom_bg', rawDataUrl);
                applyCustomBackground(rawDataUrl);
                return;
            } catch (err) {
                console.warn('Quota exceeded for raw image, compressing...', err);
            }
        }

        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const maxDim = 1920;

            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
            try {
                localStorage.setItem('aurafit_custom_bg', compressedDataUrl);
            } catch (err) {
                console.error('LocalStorage quota exceeded:', err);
            }
            applyCustomBackground(compressedDataUrl);
        };
        img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
}

function applySidebarColor(hexColor) {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.style.backgroundColor = hexColor;
        sidebar.style.borderColor = hexToRgba(hexColor, 0.4);
    }
    const colorBtn = document.getElementById('sidebar-color-btn');
    if (colorBtn) {
        colorBtn.title = `Sidebar Color: ${hexColor} (Click to change)`;
    }
    const colorInput = document.getElementById('sidebar-color-input');
    if (colorInput) colorInput.value = hexColor;
    localStorage.setItem('aurafit_sidebar_color', hexColor);
}

function applyBgBlur(blurred) {
    isBgBlurred = !!blurred;
    const overlay = document.getElementById('custom-bg-overlay');
    const glowBg = document.querySelector('.glow-bg');
    const backdrop = document.getElementById('bg-blur-backdrop');
    const blurBtn = document.getElementById('bg-blur-btn');

    if (overlay) overlay.classList.toggle('blurred', isBgBlurred);
    if (glowBg) glowBg.classList.toggle('blurred', isBgBlurred);
    if (backdrop) backdrop.classList.toggle('active', isBgBlurred);

    if (blurBtn) {
        blurBtn.classList.toggle('active', isBgBlurred);
        blurBtn.title = isBgBlurred ? 'Background: Blurred (Click to unblur)' : 'Background: Unblurred (Click to blur)';
    }
}

function toggleBgBlur() {
    applyBgBlur(!isBgBlurred);
    localStorage.setItem('aurafit_bg_blur', isBgBlurred ? 'true' : 'false');
}

function setupFooterToolbarControls() {
    const bgPickerBtn = document.getElementById('bg-picker-btn');
    const bgUploadInput = document.getElementById('bg-upload-input');
    const bgResetBtn = document.getElementById('bg-reset-btn');
    const sidebarColorBtn = document.getElementById('sidebar-color-btn');
    const bgBlurBtn = document.getElementById('bg-blur-btn');

    if (bgPickerBtn && bgUploadInput) {
        bgPickerBtn.addEventListener('click', () => bgUploadInput.click());
        bgUploadInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                processAndSaveBgImage(e.target.files[0]);
            }
        });
    }

    if (bgResetBtn) {
        bgResetBtn.addEventListener('click', () => {
            localStorage.removeItem('aurafit_custom_bg');
            if (bgUploadInput) bgUploadInput.value = '';
            applyCustomBackground(null);
        });
    }

    if (sidebarColorBtn) {
        const sidebarColorInput = document.getElementById('sidebar-color-input');
        sidebarColorBtn.addEventListener('click', () => {
            if (sidebarColorInput) sidebarColorInput.click();
        });
        if (sidebarColorInput) {
            sidebarColorInput.addEventListener('input', () => {
                applySidebarColor(sidebarColorInput.value);
            });
        }
    }

    if (bgBlurBtn) {
        bgBlurBtn.addEventListener('click', toggleBgBlur);
    }

    // Load saved preferences
    const savedBg = localStorage.getItem('aurafit_custom_bg');
    if (savedBg) applyCustomBackground(savedBg);

    const savedSidebarColor = localStorage.getItem('aurafit_sidebar_color');
    if (savedSidebarColor && /^#[0-9a-fA-F]{6}$/.test(savedSidebarColor)) {
        applySidebarColor(savedSidebarColor);
    } else {
        applySidebarColor(DEFAULT_SIDEBAR_COLOR);
    }

    const savedBlur = localStorage.getItem('aurafit_bg_blur') === 'true';
    applyBgBlur(savedBlur);
}

// --- Goal Settings Modal ---
const MODAL_CONFIGS = {
    screentime: { title: 'Screen Time Limit', subtitle: 'Set the maximum screen time allowed per day', label: 'Daily Limit (hours)', step: '0.1', max: '24', placeholder: 'e.g. 6.0' },
    calories: { title: 'Calorie Budget', subtitle: 'Set your daily calorie intake target', label: 'Daily Budget (kcal)', step: '1', max: '10000', placeholder: 'e.g. 2200' },
    water: { title: 'Hydration Goal', subtitle: 'Set your daily water intake target', label: 'Daily Goal (ml)', step: '1', max: '10000', placeholder: 'e.g. 2500' }
};

function openGoalModal(type) {
    const config = MODAL_CONFIGS[type];
    if (!config) return;

    document.getElementById('modal-category-type').value = type;
    document.getElementById('modal-title').textContent = config.title;
    document.getElementById('modal-subtitle').textContent = config.subtitle;
    document.getElementById('modal-input-label').textContent = config.label;

    const inputEl = document.getElementById('modal-goal-input');
    inputEl.step = config.step;
    inputEl.max = config.max;
    inputEl.placeholder = config.placeholder;
    inputEl.value = appData.goals[type] || '';

    document.getElementById('goal-modal').classList.add('visible');
    inputEl.focus();
}

function closeGoalModal() {
    document.getElementById('goal-modal').classList.remove('visible');
}

window.openGoalModal = openGoalModal;
window.closeGoalModal = closeGoalModal;

// --- Reset Stats ---
function openResetModal() {
    document.getElementById('reset-modal').classList.add('visible');
}

function closeResetModal() {
    document.getElementById('reset-modal').classList.remove('visible');
}

function resetStats(range) {
    const today = getTodayDateString();

    if (range === 'all') {
        appData.logs = [];
    } else if (range === 'today') {
        appData.logs = appData.logs.filter(log => log.date !== today);
    } else {
        const now = new Date();
        const cutoff = new Date(now);
        cutoff.setDate(now.getDate() - (range === 'week' ? 7 : 30));
        const cutoffTs = cutoff.getTime();
        appData.logs = appData.logs.filter(log => new Date(log.timestamp).getTime() >= cutoffTs);
    }

    saveToStorage();
    closeResetModal();
    switchTab('dashboard');
    showToast('Stats reset successfully');
}

window.closeResetModal = closeResetModal;

// --- Toast Notification ---
let toastTimer = null;

function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}

function logWater(amount, notes) {
    addLog('water', amount, '', notes);
}

// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    loadData();
    setupEventListeners();
    switchTab('dashboard');
});
