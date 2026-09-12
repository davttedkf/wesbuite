const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const TICK_RATE = 30;

const TOWER_MAX_HP = 100;
const PLANE_MAX_HP = 100;

const planeData = {
small: {
name: "Small Jet",
maxSpeed: 7.5,
acceleration: 2.8,
braking: 4.5,
turn: 170,
climb: 145,
stall: 0.32
},
airliner: {
name: "Airliner",
maxSpeed: 5.5,
acceleration: 1.8,
braking: 3.0,
turn: 105,
climb: 100,
stall: 0.26
},
large: {
name: "Large Airliner",
maxSpeed: 4.7,
acceleration: 1.35,
braking: 2.7,
turn: 82,
climb: 82,
stall: 0.23
},
cargo: {
name: "Cargo Plane",
maxSpeed: 4.2,
acceleration: 1.1,
braking: 3.8,
turn: 70,
climb: 70,
stall: 0.21
},
fighter: {
name: "Fighter Jet",
maxSpeed: 10,
acceleration: 3.8,
braking: 5.5,
turn: 240,
climb: 190,
stall: 0.36
}
};

const gunData = {
mg: {
name: "Machine Gun",
damage: 5,
cooldown: 110,
bulletSpeed: 13
},
heavy: {
name: "Heavy MG",
damage: 10,
cooldown: 240,
bulletSpeed: 12
},
rapid: {
name: "Rapid MG",
damage: 3,
cooldown: 55,
bulletSpeed: 15
}
};

const queue = [];
const players = new Map();
const rooms = new Map();

let bulletId = 1;

function cleanName(name) {
return String(name || "Player")
.replace(/[<>]/g, "")
.trim()
.slice(0, 16) || "Player";
}

function send(ws, data) {
if (ws && ws.readyState === WebSocket.OPEN) {
ws.send(JSON.stringify(data));
}
}

function broadcast(room, data) {
send(room.player1.ws, data);
send(room.player2.ws, data);
}

function makeState() {
return {
phase: "waiting",
round: 1,
roundWins: [0, 0],

```
    players: {
        tower1: "",
        tower2: ""
    },

    pilotName: "",
    gunnerName: "",

    pilotId: "",
    gunnerId: "",

    towers: [
        { hp: TOWER_MAX_HP },
        { hp: TOWER_MAX_HP }
    ],

    plane: {
        x: 80,
        y: 270,
        vx: 4,
        vy: 0,
        speed: 4,
        pitch: 0,
        hp: PLANE_MAX_HP,
        planeType: "airliner",
        stalled: false
    },

    gunTower: 1,

    aim: {
        x: 650,
        y: 245
    },

    gun: "mg",
    gunnerReady: true,

    bullets: [],

    winnerName: "",
    reason: ""
};
```

}

function makeRoom(a, b) {
const room = {
id: crypto.randomUUID(),
player1: a,
player2: b,
state: makeState(),
running: false,
lastFire: 0,
nextRoundTimer: null
};

```
const pilotFirst = Math.random() < 0.5;

if (pilotFirst) {
    room.state.pilotId = a.id;
    room.state.gunnerId = b.id;
    room.state.pilotName = a.name;
    room.state.gunnerName = b.name;
} else {
    room.state.pilotId = b.id;
    room.state.gunnerId = a.id;
    room.state.pilotName = b.name;
    room.state.gunnerName = a.name;
}

room.state.players.tower1 = room.state.gunnerName;
room.state.players.tower2 = room.state.pilotName;

a.room = room;
b.room = room;

rooms.set(room.id, room);

send(a.ws, {
    type: "matchFound",
    role: a.id === room.state.pilotId ? "Pilot" : "Gunner"
});

send(b.ws, {
    type: "matchFound",
    role: b.id === room.state.pilotId ? "Pilot" : "Gunner"
});

setTimeout(() => {
    if (!rooms.has(room.id)) return;

    room.running = true;
    room.state.phase = "playing";

    broadcast(room, room.state);
}, 3200);
```

}

function tryMatch() {
while (queue.length >= 2) {
const a = queue.shift();
const b = queue.shift();

```
    if (!a || !b) break;
    if (a.ws.readyState !== WebSocket.OPEN) continue;
    if (b.ws.readyState !== WebSocket.OPEN) continue;

    makeRoom(a, b);
}
```

}

function towerRect(number) {
if (number === 1) {
return {
x: 347,
y: 465,
w: 175,
h: 330
};
}

```
return {
    x: 652,
    y: 465,
    w: 175,
    h: 330
};
```

}

function resetRound(room) {
const s = room.state;

```
s.phase = "playing";

s.towers[0].hp = TOWER_MAX_HP;
s.towers[1].hp = TOWER_MAX_HP;

s.plane.x = 80;
s.plane.y = 270;
s.plane.vx = 4;
s.plane.vy = 0;
s.plane.speed = 4;
s.plane.pitch = 0;
s.plane.hp = PLANE_MAX_HP;
s.plane.stalled = false;

s.aim.x = s.gunTower === 1 ? 347 : 652;
s.aim.y = 245;

s.bullets = [];
room.lastFire = 0;
```

}

function switchRoles(room) {
const s = room.state;

```
const oldPilot = s.pilotId;
const oldGunner = s.gunnerId;

s.pilotId = oldGunner;
s.gunnerId = oldPilot;

const pilotPlayer =
    room.player1.id === s.pilotId ? room.player1 : room.player2;

const gunnerPlayer =
    room.player1.id === s.gunnerId ? room.player1 : room.player2;

s.pilotName = pilotPlayer.name;
s.gunnerName = gunnerPlayer.name;

s.players.tower1 = s.gunnerName;
s.players.tower2 = s.pilotName;

send(room.player1.ws, {
    type: "matchFound",
    role: room.player1.id === s.pilotId ? "Pilot" : "Gunner"
});

send(room.player2.ws, {
    type: "matchFound",
    role: room.player2.id === s.pilotId ? "Pilot" : "Gunner"
});
```

}

function startNextRound(room) {
if (!rooms.has(room.id)) return;

```
room.state.round++;

switchRoles(room);

room.state.gunTower =
    room.state.gunTower === 1 ? 2 : 1;

resetRound(room);

setTimeout(() => {
    if (!rooms.has(room.id)) return;
    broadcast(room, room.state);
}, 1200);
```

}

function finishMatch(room, winnerId, reason) {
if (!rooms.has(room.id)) return;

```
const s = room.state;

s.phase = "ended";

const winner =
    room.player1.id === winnerId
        ? room.player1
        : room.player2;

s.winnerName = winner ? winner.name : "";
s.reason = reason;

broadcast(room, s);
```

}

function finishRound(room, winnerId, reason) {
const s = room.state;

```
const playerIndex =
    winnerId === s.pilotId ? 0 : 1;

s.roundWins[playerIndex]++;

if (s.roundWins[playerIndex] >= 3) {
    finishMatch(room, winnerId, reason);
    return;
}

broadcast(room, {
    ...s,
    phase: "roundEnd",
    winnerName:
        winnerId === room.player1.id
            ? room.player1.name
            : room.player2.name,
    reason
});

if (room.nextRoundTimer) {
    clearTimeout(room.nextRoundTimer);
}

room.nextRoundTimer = setTimeout(() => {
    startNextRound(room);
}, 2500);
```

}

function handleInput(player, msg) {
const room = player.room;
if (!room || !room.running) return;

```
const s = room.state;

if (s.pilotId !== player.id) return;

player.input = {
    up: !!msg.up,
    down: !!msg.down,
    left: !!msg.left,
    right: !!msg.right,
    brake: !!msg.brake
};
```

}

function handleAim(player, msg) {
const room = player.room;
if (!room || !room.running) return;

```
const s = room.state;

if (s.gunnerId !== player.id) return;

let x = Number(msg.x);
let y = Number(msg.y);

if (!Number.isFinite(x)) x = s.aim.x;
if (!Number.isFinite(y)) y = s.aim.y;

s.aim.x = Math.max(0, Math.min(WORLD_WIDTH, x));
s.aim.y = Math.max(0, Math.min(WORLD_HEIGHT, y));
```

}

function handleFire(player, msg) {
const room = player.room;
if (!room || !room.running) return;

```
const s = room.state;

if (s.gunnerId !== player.id) return;

player.firing = !!msg.down;

if (player.firing) {
    fireBullet(room);
}
```

}

function fireBullet(room) {
const now = Date.now();
const s = room.state;

```
const gun = gunData[s.gun] || gunData.mg;

if (now - room.lastFire < gun.cooldown) {
    return;
}

room.lastFire = now;

const startX = s.gunTower === 1 ? 347 : 652;
const startY = 245;

let dx = s.aim.x - startX;
let dy = s.aim.y - startY;

const length = Math.sqrt(dx * dx + dy * dy) || 1;

dx /= length;
dy /= length;

s.bullets.push({
    id: bulletId++,
    x: startX,
    y: startY,
    vx: dx * gun.bulletSpeed,
    vy: dy * gun.bulletSpeed,
    life: 90,
    damage: gun.damage
});
```

}

function selectPlane(player, msg) {
const room = player.room;
if (!room) return;

```
const s = room.state;

if (s.pilotId !== player.id) return;

if (!planeData[msg.plane]) return;

s.plane.planeType = msg.plane;
```

}

function selectGun(player, msg) {
const room = player.room;
if (!room) return;

```
const s = room.state;

if (s.gunnerId !== player.id) return;

if (!gunData[msg.gun]) return;

s.gun = msg.gun;
```

}

function updatePlane(room) {
const s = room.state;

```
const pilot =
    room.player1.id === s.pilotId
        ? room.player1
        : room.player2;

const input = pilot.input || {};
const type =
    planeData[s.plane.planeType] ||
    planeData.airliner;

let acceleration = type.acceleration;

if (input.brake) {
    acceleration = -type.braking;
}

if (input.up) {
    s.plane.vy -= type.climb / TICK_RATE;
}

if (input.down) {
    s.plane.vy += type.climb / TICK_RATE;
}

if (input.left) {
    s.plane.vy -= type.turn / TICK_RATE * 0.45;
}

if (input.right) {
    s.plane.vy += type.turn / TICK_RATE * 0.45;
}

s.plane.speed += acceleration / TICK_RATE;

if (!input.brake) {
    s.plane.speed += 0.8 / TICK_RATE;
}

s.plane.speed = Math.max(
    1.0,
    Math.min(type.maxSpeed, s.plane.speed)
);

s.plane.vy *= 0.93;

const maxVerticalSpeed = 4.8;

s.plane.vy = Math.max(
    -maxVerticalSpeed,
    Math.min(maxVerticalSpeed, s.plane.vy)
);

s.plane.vx = s.plane.speed;

s.plane.x += s.plane.vx * 60 / TICK_RATE;
s.plane.y += s.plane.vy * 60 / TICK_RATE;

/*
    The plane NEVER turns around.
    When it leaves the right side,
    it appears on the left side.
*/
if (s.plane.x > WORLD_WIDTH + 55) {
    s.plane.x = -45;
}

if (s.plane.x < -60) {
    s.plane.x = -45;
}

s.plane.y = Math.max(
    90,
    Math.min(420, s.plane.y)
);

s.plane.pitch =
    Math.max(-22, Math.min(22, s.plane.vy * 5));

s.plane.stalled =
    s.plane.speed < type.maxSpeed * type.stall;
```

}

function checkPlaneCollision(room) {
const s = room.state;

```
const planeX = s.plane.x;
const planeY = s.plane.y;

for (let i = 1; i <= 2; i++) {
    const tower = s.towers[i - 1];

    if (tower.hp <= 0) continue;

    const rect = towerRect(i);

    const hit =
        planeX > rect.x - 45 &&
        planeX < rect.x + rect.w + 45 &&
        planeY > rect.y - rect.h &&
        planeY < rect.y + 30;

    if (!hit) continue;

    tower.hp -= 28;
    tower.hp = Math.max(0, tower.hp);

    s.plane.speed *= 0.58;
    s.plane.vy *= 0.35;

    if (tower.hp <= 0) {
        if (s.towers[0].hp <= 0 &&
            s.towers[1].hp <= 0) {

            finishRound(
                room,
                s.pilotId,
                "Both towers were destroyed."
            );

            return;
        }

