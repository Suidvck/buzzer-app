const socket = io();

let role = null;
let playerName = '';
let isLocked = true;
let startTime = null;
let localStartTime = null;
let hasBuzzed = false;

// Auto-click detection
const clickTimestamps = [];
const CLICK_WINDOW = 5000;
const MIN_CLICKS_FOR_CHECK = 5;
const AUTOCLICK_THRESHOLD_MS = 2;

function selectRole(r) {
    role = r;
    document.getElementById('role-select').classList.add('hidden');
    if (r === 'host') {
        document.getElementById('host-panel').classList.remove('hidden');
        socket.emit('register-host');
    } else {
        document.getElementById('name-input').classList.remove('hidden');
        document.getElementById('player-name').focus();
    }
}

function submitName() {
    const input = document.getElementById('player-name');
    const name = input.value.trim();
    if (!name) return;
    playerName = name;
    socket.emit('register-player', name);
    document.getElementById('name-input').classList.add('hidden');
    document.getElementById('player-panel').classList.remove('hidden');
    document.getElementById('welcome-msg').textContent = name;
}

document.getElementById('player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitName();
});

function hostAction(action) {
    socket.emit(action);
}

// --- Host: receive updates ---
socket.on('players-update', (players) => {
    document.getElementById('player-count').textContent = players.length;
});

socket.on('results-update', (results) => {
    const tbody = document.getElementById('leaderboard-body');
    const noResults = document.getElementById('no-results');

    if (results.length === 0) {
        tbody.innerHTML = '';
        noResults.classList.remove('hidden');
        return;
    }

    noResults.classList.add('hidden');
    tbody.innerHTML = results.map((r, i) => {
        const warn = r.isAutoClick
            ? '<td class="warn-cell">[⚠️ อาจใช้ Auto Click]</td>'
            : '<td>-</td>';
        return `<tr>
            <td>${i + 1}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${r.timeMs}</td>
            <td>${r.cps}</td>
            ${warn}
        </tr>`;
    }).join('');
});

socket.on('button-state', (data) => {
    isLocked = data.locked;
    startTime = data.startTime;

    const status = document.getElementById('host-status');
    if (isLocked) {
        status.textContent = 'LOCKED';
        status.className = 'status-lock';
    } else {
        status.textContent = 'UNLOCKED';
        status.className = 'status-unlock';
    }
});

// --- Player: button state ---
socket.on('button-state', (data) => {
    isLocked = data.locked;
    startTime = data.startTime;
    hasBuzzed = false;

    if (!isLocked) {
        localStartTime = Date.now();
    } else {
        localStartTime = null;
    }
    const btn = document.getElementById('buzzer-btn');
    const resultDiv = document.getElementById('buzz-result');
    const statusText = document.getElementById('player-status-text');

    resultDiv.classList.add('hidden');

    if (isLocked) {
        btn.className = 'buzzer-btn locked';
        btn.textContent = 'LOCKED';
        btn.disabled = true;
        statusText.textContent = 'รอ host เปิดปุ่ม...';
        statusText.style.color = '#666';
    } else {
        btn.className = 'buzzer-btn unlocked';
        btn.textContent = 'BUZZ!';
        btn.disabled = false;
        statusText.textContent = 'กดปุ่มเร็วที่สุด!';
        statusText.style.color = '#44ff44';
    }
});

// --- Player: buzz ---
const buzzerBtn = document.getElementById('buzzer-btn');
const mousedownHandler = (e) => {
    e.preventDefault();
    handleBuzz();
};
buzzerBtn.addEventListener('mousedown', mousedownHandler);
buzzerBtn.addEventListener('touchstart', mousedownHandler, { passive: false });

function handleBuzz() {
    const now = Date.now();

    // Track click for auto-click detection (always, even when locked)
    trackClick(now);

    if (isLocked || !localStartTime) return;
    if (hasBuzzed) return;

    hasBuzzed = true;

    const timeMs = now - localStartTime;
    const { isAutoClick, cps } = analyzeClicks();

    socket.emit('buzz', { timeMs, isAutoClick, cps });

    const btn = document.getElementById('buzzer-btn');
    btn.className = 'buzzer-btn locked';
    btn.textContent = 'SENT!';
    btn.disabled = true;
}

socket.on('buzz-confirmed', (data) => {
    const resultDiv = document.getElementById('buzz-result');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = `<span class="time">${data.timeMs} ms</span> <span class="rank">อันดับ #${data.rank}</span>`;
});

// --- Auto-click detection ---
function trackClick(now) {
    clickTimestamps.push(now);
    while (clickTimestamps.length > 10) {
        clickTimestamps.shift();
    }
}

function analyzeClicks() {
    if (clickTimestamps.length < MIN_CLICKS_FOR_CHECK) {
        return { isAutoClick: false, cps: calcCPS() };
    }

    const intervals = [];
    for (let i = 1; i < clickTimestamps.length; i++) {
        intervals.push(clickTimestamps[i] - clickTimestamps[i - 1]);
    }

    const recent = intervals.slice(-5);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const maxDeviation = Math.max(...recent.map(v => Math.abs(v - mean)));

    const isAutoClick = maxDeviation < AUTOCLICK_THRESHOLD_MS;
    return { isAutoClick, cps: calcCPS() };
}

function calcCPS() {
    if (clickTimestamps.length < 2) return 0;
    const recent = clickTimestamps.filter(t => Date.now() - t < CLICK_WINDOW);
    if (recent.length < 2) return 0;
    const duration = (recent[recent.length - 1] - recent[0]) / 1000;
    if (duration === 0) return 0;
    return ((recent.length - 1) / duration).toFixed(1);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
