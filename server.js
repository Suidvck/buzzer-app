const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://suidvck.github.io';

const io = new Server(server, {
    cors: {
        origin: FRONTEND_URL,
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

app.get('/', (req, res) => {
    res.send('Buzzer App Backend - OK');
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

let isLocked = true;
let hostId = null;
let buzzStartTime = null;
let players = [];
let buzzResults = [];

const HOST_PASSWORD = 'godpleum69';

io.on('connection', (socket) => {
    console.log(`[+] ${socket.id} connected`);

    socket.on('register-host', (data) => {
        if (!data || data.password !== HOST_PASSWORD) {
            socket.emit('host-auth-failed');
            console.log(`[!] Host auth failed: ${socket.id}`);
            return;
        }
        hostId = socket.id;
        socket.join('host');
        socket.emit('host-auth-success');
        console.log(`[*] Host registered: ${socket.id}`);
    });

    socket.on('unlock', () => {
        if (socket.id !== hostId) return;
        isLocked = false;
        buzzResults = [];
        buzzStartTime = Date.now();
        io.emit('button-state', { locked: false, startTime: buzzStartTime });
        io.to('host').emit('results-update', buzzResults);
        console.log(`[UNLOCK] Button unlocked. t1=${buzzStartTime}`);
    });

    socket.on('lock', () => {
        if (socket.id !== hostId) return;
        isLocked = true;
        io.emit('button-state', { locked: true, startTime: null });
        console.log('[LOCK] Button locked');
    });

    socket.on('reset', () => {
        if (socket.id !== hostId) return;
        isLocked = true;
        buzzResults = [];
        buzzStartTime = null;
        io.emit('button-state', { locked: true, startTime: null });
        io.to('host').emit('results-update', []);
        console.log('[RESET] Round reset');
    });

    socket.on('register-player', (name) => {
        const existing = players.find(p => p.id === socket.id);
        if (existing) {
            existing.name = name;
        } else {
            players.push({ id: socket.id, name });
        }
        io.to('host').emit('players-update', players.map(p => p.name));
        console.log(`[*] Player registered: ${name} (${socket.id})`);
    });

    socket.on('buzz', (data) => {
        if (isLocked) return;
        const player = players.find(p => p.id === socket.id);
        if (!player) return;

        const alreadyBuzzed = buzzResults.find(r => r.playerId === socket.id);
        if (alreadyBuzzed) return;

        const result = {
            playerId: socket.id,
            name: player.name,
            timeMs: data.timeMs,
            isAutoClick: data.isAutoClick,
            cps: data.cps
        };

        buzzResults.push(result);
        buzzResults.sort((a, b) => a.timeMs - b.timeMs);

        io.to('host').emit('results-update', buzzResults);

        const rank = buzzResults.findIndex(r => r.playerId === socket.id) + 1;
        socket.emit('buzz-confirmed', { rank, timeMs: data.timeMs });

        console.log(`[BUZZ] ${player.name}: ${data.timeMs}ms (auto: ${data.isAutoClick}, cps: ${data.cps})`);
    });

    socket.on('disconnect', () => {
        if (socket.id === hostId) {
            hostId = null;
            console.log('[!] Host disconnected');
        }
        players = players.filter(p => p.id !== socket.id);
        io.to('host').emit('players-update', players.map(p => p.name));
        console.log(`[-] ${socket.id} disconnected`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  Buzzer App Backend running on port ${PORT}`);
    console.log(`  Frontend URL: ${FRONTEND_URL}`);
    console.log(`========================================\n`);
});
