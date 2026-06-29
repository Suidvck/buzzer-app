const socket = io(BACKEND_URL, {
    transports: ['websocket', 'polling']
});

let role = null;
let playerName = '';
let isLocked = true;
let localStartTime = null;
let hasBuzzed = false;
let buzzRetryInterval = null;

const clickTimestamps = [];
const CLICK_WINDOW = 5000;
const MIN_CLICKS_FOR_CHECK = 5;
const AUTOCLICK_THRESHOLD_MS = 2;

function selectRole(r) {
    role = r;
    document.getElementById('role-select').classList.add('hidden');
    if (r === 'host') {
        document.getElementById('host-panel').classList.add('hidden');
        document.getElementById('host-password-input').classList.remove('hidden');
        document.getElementById('host-password').focus();
    } else {
        document.getElementById('name-input').classList.remove('hidden');
        document.getElementById('player-name').focus();
    }
}

function submitHostPassword() {
    const input = document.getElementById('host-password');
    const password = input.value.trim();
    if (!password) return;
    socket.emit('register-host', { password });
}

document.getElementById('host-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitHostPassword();
});

socket.on('host-auth-failed', () => {
    document.getElementById('host-password-error').classList.remove('hidden');
    document.getElementById('host-password').value = '';
    document.getElementById('host-password').focus();
});

socket.on('host-auth-success', () => {
    document.getElementById('host-password-input').classList.add('hidden');
    document.getElementById('host-panel').classList.remove('hidden');
});

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

socket.on('connect', () => {
    console.log('Connected to server:', BACKEND_URL);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});

socket.on('buzz-confirmed', (data) => {
    if (buzzRetryInterval) {
        clearTimeout(buzzRetryInterval);
        buzzRetryInterval = null;
    }
    const resultDiv = document.getElementById('buzz-result');
    if (resultDiv) {
        resultDiv.innerHTML = `<span class="time">${data.timeMs} ms</span> <span class="rank">ส่งข้อมูลสำเร็จ! รอจัดอันดับ...</span>`;
    }
});

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

    if (role === 'player') {
        const myIndex = results.findIndex(r => r.playerId === socket.id);
        if (myIndex !== -1) {
            const resultDiv = document.getElementById('buzz-result');
            const rank = myIndex + 1;
            resultDiv.innerHTML = `<span class="time">${results[myIndex].timeMs} ms</span> <span class="rank">อันดับ #${rank}</span>`;
        }
    }
});

socket.on('button-state', (data) => {
    isLocked = data.locked;

    const status = document.getElementById('host-status');
    if (status) {
        if (isLocked) {
            status.textContent = 'LOCKED';
            status.className = 'status-lock';
        } else {
            status.textContent = 'UNLOCKED';
            status.className = 'status-unlock';
        }
    }

    if (role === 'player') {
        handleButtonState(data);
    }
});

function handleButtonState(data) {
    isLocked = data.locked;
    hasBuzzed = false;

    if (!isLocked) {
        localStartTime = performance.now();
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
}

const buzzerBtn = document.getElementById('buzzer-btn');
const mousedownHandler = (e) => {
    e.preventDefault();
    handleBuzz();
};
buzzerBtn.addEventListener('mousedown', mousedownHandler);
buzzerBtn.addEventListener('touchstart', mousedownHandler, { passive: false });

function handleBuzz() {
    const now = performance.now();
    trackClick(Date.now());

    if (isLocked || localStartTime === null) return;
    if (hasBuzzed) return;

    hasBuzzed = true;
 
    const timeMs = now - localStartTime;
    if (timeMs < 0) return;
 
    const { isAutoClick, cps } = analyzeClicks();
 
    const buzzData = { isAutoClick, cps };
    
    // Send immediately
    socket.emit('buzz', buzzData);
    
    // Setup slow retry mechanism: only if no confirmation is received after 1s
    buzzRetryInterval = setTimeout(() => {
        console.log('No confirmation received, retrying buzz...');
        socket.emit('buzz', buzzData);
    }, 1000);
    
    const btn = document.getElementById('buzzer-btn');


    btn.className = 'buzzer-btn locked';
    btn.textContent = 'SENT!';
    btn.disabled = true;

    const resultDiv = document.getElementById('buzz-result');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = `<span class="time">${timeMs} ms</span> <span class="rank">กำลังตรวจสอบ...</span>`;
}

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
