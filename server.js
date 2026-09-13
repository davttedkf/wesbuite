const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;

const TICK_RATE = 30;
const TICK_MS = 1000 / TICK_RATE;

const TOWER_MAX_HP = 100;
const PLANE_MAX_HP = 100;

const planeTypes = {
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

const gunTypes = {
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

const players = new Map();
const rooms = new Map();
const queue = [];

function randomId() {
    return crypto.randomBytes(8).toString("hex");
}

function send(ws, data) {
    if (!ws) return;
    if (ws.readyState !== WebSocket.OPEN) return;

    try {
        ws.send(JSON.stringify(data));
    } catch (err) {
        console.error("WebSocket send error:", err.message);
    }
}

function broadcast(room, data) {
    send(room.players[0].ws, data);
    send(room.players[1].ws, data);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function distance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
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

    return {
        x: 652,
        y: 465,
        w: 175,
        h: 330
    };
}

function planeHitsTower(room) {
    const s = room.state;
    const p = s.plane;

    for (let i = 1; i <= 2; i++) {
        const tower = towerRect(i);

        const left = tower.x - tower.w / 2;
        const right = tower.x + tower.w / 2;
        const top = tower.y - tower.h / 2;
        const bottom = tower.y + tower.h / 2;

        if (
            p.x >= left - 18 &&
            p.x <= right + 18 &&
            p.y >= top - 20 &&
            p.y <= bottom
        ) {
            return i;
        }
    }

    return 0;
}

function createPlayerState(ws) {
    const id = randomId();

    const player = {
        id: id,
        ws: ws,
        name: "Player",
        planeType: "airliner",
        gun: "mg",
        roomId: null,
        ready: false,
        input: {
            up: false,
            down: false,
            left: false,
            right: false,
            brake: false
        },
        aim: {
            x: 650,
            y: 245
        },
        lastFire: 0
    };

    players.set(id, player);

    return player;
}

function createRoom(player1, player2) {
    const room = {
        id: randomId(),

        players: [
            player1,
            player2
        ],

        state: {
            phase: "waiting",

            round: 1,

            roundWins: {
                player1: 0,
                player2: 0
            },

            tower1: {
                hp: TOWER_MAX_HP
            },

            tower2: {
                hp: TOWER_MAX_HP
            },

            plane: {
                x: 80,
                y: 270,

                vx: 4,
                vy: 0,

                speed: 4,
                pitch: 0,

                hp: PLANE_MAX_HP,

                planeType: player1.planeType,

                stalled: false
            },

            gunTower: 1,

            aim: {
                x: 650,
                y: 245
            },

            gun: player2.gun,

            gunnerReady: true,

            bullets: [],

            winnerName: "",
            reason: ""
        }
    };

    player1.roomId = room.id;
    player2.roomId = room.id;

    room.state.plane.planeType = player1.planeType;
    room.state.gun = player2.gun;

    rooms.set(room.id, room);

    return room;
}

function playerIndex(room, player) {
    if (room.players[0].id === player.id) {
        return 0;
    }

    if (room.players[1].id === player.id) {
        return 1;
    }

    return -1;
}

function getPilot(room) {
    const s = room.state;

    if (!s.pilotId) return null;

    if (room.players[0].id === s.pilotId) {
        return room.players[0];
    }

    if (room.players[1].id === s.pilotId) {
        return room.players[1];
    }

    return null;
}

function getGunner(room) {
    const s = room.state;

    if (!s.gunnerId) return null;

    if (room.players[0].id === s.gunnerId) {
        return room.players[0];
    }

    if (room.players[1].id === s.gunnerId) {
        return room.players[1];
    }

    return null;
}

function publicState(room) {
    const s = room.state;

    return {
        phase: s.phase,

        round: s.round,

        roundWins: s.roundWins,

        pilotId: s.pilotId || null,
        gunnerId: s.gunnerId || null,

        pilotName: s.pilotName || "",
        gunnerName: s.gunnerName || "",

        tower1: {
            hp: s.tower1.hp
        },

        tower2: {
            hp: s.tower2.hp
        },

        plane: {
            x: s.plane.x,
            y: s.plane.y,
            vx: s.plane.vx,
            vy: s.plane.vy,
            speed: s.plane.speed,
            pitch: s.plane.pitch,
            hp: s.plane.hp,
            planeType: s.plane.planeType,
            stalled: s.plane.stalled
        },

        gunTower: s.gunTower,

        aim: {
            x: s.aim.x,
            y: s.aim.y
        },

        gun: s.gun,

        gunnerReady: s.gunnerReady,

        bullets: s.bullets.map(function(b) {
            return {
                id: b.id,
                x: b.x,
                y: b.y
            };
        }),

        winnerName: s.winnerName || "",
        reason: s.reason || ""
    };
}

function sendState(room) {
    broadcast(room, {
        type: "state",
        state: publicState(room)
    });
}

function assignInitialRoles(room) {
    const firstPilot = Math.random() < 0.5;

    let pilot;
    let gunner;

    if (firstPilot) {
        pilot = room.players[0];
        gunner = room.players[1];
    } else {
        pilot = room.players[1];
        gunner = room.players[0];
    }

    room.state.pilotId = pilot.id;
    room.state.gunnerId = gunner.id;

    room.state.pilotName = pilot.name;
    room.state.gunnerName = gunner.name;

    room.state.plane.planeType = pilot.planeType;
    room.state.gun = gunner.gun;

    room.state.gunTower = 1;

    sendMatchFound(room);
}

function sendMatchFound(room) {
    const s = room.state;

    for (let i = 0; i < room.players.length; i++) {
        const player = room.players[i];

        send(player.ws, {
            type: "matchFound",

            roomId: room.id,

            role: player.id === s.pilotId ? "pilot" : "gunner",

            pilotName: s.pilotName,
            gunnerName: s.gunnerName,

            round: s.round,

            planeType: s.plane.planeType,
            gun: s.gun
        });
    }
}

function resetRound(room) {
    const s = room.state;

    const pilot = getPilot(room);
    const gunner = getGunner(room);

    s.tower1.hp = TOWER_MAX_HP;
    s.tower2.hp = TOWER_MAX_HP;

    s.plane = {
        x: 80,
        y: 270,

        vx: 4,
        vy: 0,

        speed: 4,
        pitch: 0,

        hp: PLANE_MAX_HP,

        planeType: pilot ? pilot.planeType : "airliner",

        stalled: false
    };

    s.gunTower = 1;

    s.aim = {
        x: 650,
        y: 245
    };

    s.gun = gunner ? gunner.gun : "mg";

    s.gunnerReady = true;

    s.bullets = [];

    s.winnerName = "";
    s.reason = "";

    if (pilot) {
        pilot.lastFire = 0;
    }

    if (gunner) {
        gunner.lastFire = 0;
    }
}

function startRound(room) {
    if (!rooms.has(room.id)) return;

    room.state.phase = "playing";

    resetRound(room);

    sendMatchFound(room);
    sendState(room);
}

function switchRoles(room) {
    const s = room.state;

    const oldPilotId = s.pilotId;

    if (room.players[0].id === oldPilotId) {
        s.pilotId = room.players[1].id;
        s.gunnerId = room.players[0].id;
    } else {
        s.pilotId = room.players[0].id;
        s.gunnerId = room.players[1].id;
    }

    const pilot = getPilot(room);
    const gunner = getGunner(room);

    s.pilotName = pilot ? pilot.name : "";
    s.gunnerName = gunner ? gunner.name : "";

    s.gunTower = s.gunTower === 1 ? 2 : 1;

    if (pilot) {
        s.plane.planeType = pilot.planeType;
    }

    if (gunner) {
        s.gun = gunner.gun;
    }
}

function awardRoundWin(room, player) {
    if (!player) return;

    if (room.players[0].id === player.id) {
        room.state.roundWins.player1++;
    } else if (room.players[1].id === player.id) {
        room.state.roundWins.player2++;
    }
}

function getWinnerOfMatch(room) {
    const wins = room.state.roundWins;

    if (wins.player1 >= 3) {
        return room.players[0];
    }

    if (wins.player2 >= 3) {
        return room.players[1];
    }

    return null;
}

function finishRound(room, winner, reason) {
    if (!room) return;
    if (room.state.phase !== "playing") return;

    room.state.phase = "roundEnd";
    room.state.winnerName = winner ? winner.name : "";
    room.state.reason = reason || "";

    awardRoundWin(room, winner);

    const matchWinner = getWinnerOfMatch(room);

    if (matchWinner) {
        room.state.phase = "ended";
        room.state.winnerName = matchWinner.name;
        room.state.reason = "Match complete";

        sendState(room);
        return;
    }

    sendState(room);

    setTimeout(function() {
        if (!rooms.has(room.id)) return;

        room.state.round++;
        switchRoles(room);

        room.state.phase = "waiting";

        resetRound(room);

        sendMatchFound(room);

        setTimeout(function() {
            if (!rooms.has(room.id)) return;
            startRound(room);
        }, 1200);
    }, 2500);
}

function updatePlane(room, dt) {
    const s = room.state;
    const pilot = getPilot(room);

    if (!pilot) return;

    const type = planeTypes[s.plane.planeType] || planeTypes.airliner;

    const input = pilot.input;

    if (input.up) {
        s.plane.vy -= type.climb * dt;
    }

    if (input.down) {
        s.plane.vy += type.climb * dt;
    }

    if (input.left) {
        s.plane.vy -= type.turn * 0.45 * dt;
    }

    if (input.right) {
        s.plane.vy += type.turn * 0.45 * dt;
    }

    s.plane.vy *= 0.94;

    const maxVerticalSpeed = 7;

    s.plane.vy = clamp(
        s.plane.vy,
        -maxVerticalSpeed,
        maxVerticalSpeed
    );

    if (input.brake) {
        s.plane.speed -= type.braking * dt;
    } else {
        s.plane.speed += type.acceleration * dt;
    }

    s.plane.speed = clamp(
        s.plane.speed,
        1.5,
        type.maxSpeed
    );

    s.plane.vx = s.plane.speed;

    s.plane.x += s.plane.vx * 60 * dt;
    s.plane.y += s.plane.vy * 60 * dt;

    s.plane.y = clamp(
        s.plane.y,
        85,
        425
    );

    s.plane.pitch = clamp(
        s.plane.vy * 8,
        -45,
        45
    );

    s.plane.stalled =
        s.plane.speed <= type.maxSpeed * type.stall;

    if (s.plane.x > WORLD_WIDTH + 55) {
        s.plane.x = -45;
    }

    if (s.plane.x < -60) {
        s.plane.x = -45;
    }
}

function updateBullets(room, dt) {
    const s = room.state;

    for (let i = s.bullets.length - 1; i >= 0; i--) {
        const bullet = s.bullets[i];

        bullet.x += bullet.vx * 60 * dt;
        bullet.y += bullet.vy * 60 * dt;

        if (
            bullet.x < -100 ||
            bullet.x > WORLD_WIDTH + 100 ||
            bullet.y < -100 ||
            bullet.y > WORLD_HEIGHT + 100
        ) {
            s.bullets.splice(i, 1);
            continue;
        }

        if (
            distance(
                bullet.x,
                bullet.y,
                s.plane.x,
                s.plane.y
            ) < 28
        ) {
            s.plane.hp -= bullet.damage;

            s.bullets.splice(i, 1);

            if (s.plane.hp <= 0) {
                s.plane.hp = 0;

                const gunner = getGunner(room);

                finishRound(
                    room,
                    gunner,
                    "Plane shot down"
                );

                return;
            }
        }
    }
}

function updateRoom(room, dt) {
    if (room.state.phase !== "playing") {
        return;
    }

    updatePlane(room, dt);

    const hitTower = planeHitsTower(room);

    if (hitTower !== 0) {
        if (hitTower === 1) {
            room.state.tower1.hp -= 25;

            if (room.state.tower1.hp < 0) {
                room.state.tower1.hp = 0;
            }
        }

        if (hitTower === 2) {
            room.state.tower2.hp -= 25;

            if (room.state.tower2.hp < 0) {
                room.state.tower2.hp = 0;
            }
        }

        if (hitTower === 1 && room.state.tower1.hp <= 0) {
            room.state.gunTower = 2;

            const pilot = getPilot(room);

            finishRound(
                room,
                pilot,
                "Tower destroyed"
            );

            return;
        }

        if (hitTower === 2 && room.state.tower2.hp <= 0) {
            room.state.gunTower = 1;

            const pilot = getPilot(room);

            finishRound(
                room,
                pilot,
                "Tower destroyed"
            );

            return;
        }

        // Knock the plane back and slow it down. Fixed: reduce plane.speed
        // (not just vx) since updatePlane() overwrites vx from speed every
        // tick — reducing vx alone was wiped out on the very next frame,
        // so the plane never actually slowed after hitting a tower.
        room.state.plane.x = room.state.plane.x - 30;
        room.state.plane.speed = Math.max(
            2,
            room.state.plane.speed * 0.8
        );
        room.state.plane.vx = room.state.plane.speed;
    }

    updateBullets(room, dt);

    if (room.state.phase !== "playing") {
        return;
    }

    const gunner = getGunner(room);

    if (gunner) {
        const gun = gunTypes[gunner.gun] || gunTypes.mg;

        const now = Date.now();

        room.state.gunnerReady =
            now - gunner.lastFire >= gun.cooldown;
    }

    sendState(room);
}

function fireGun(room, player) {
    if (room.state.phase !== "playing") {
        return;
    }

    if (player.id !== room.state.gunnerId) {
        return;
    }

    const gun = gunTypes[player.gun] || gunTypes.mg;

    const now = Date.now();

    if (now - player.lastFire < gun.cooldown) {
        return;
    }

    player.lastFire = now;

    const towerX =
        room.state.gunTower === 1
            ? 347
            : 652;

    const towerY = 245;

    const aimX = room.state.aim.x;
    const aimY = room.state.aim.y;

    let dx = aimX - towerX;
    let dy = aimY - towerY;

    const length = Math.sqrt(
        dx * dx +
        dy * dy
    );

    if (length <= 0) {
        return;
    }

    dx /= length;
    dy /= length;

    room.state.bullets.push({
        id: randomId(),

        x: towerX,
        y: towerY,

        vx: dx * gun.bulletSpeed,
        vy: dy * gun.bulletSpeed,

        damage: gun.damage
    });

    room.state.gunnerReady = false;

    sendState(room);
}

function removeFromQueue(player) {
    const index = queue.indexOf(player);

    if (index !== -1) {
        queue.splice(index, 1);
    }
}

function joinQueue(player) {
    removeFromQueue(player);

    if (player.roomId) {
        return;
    }

    queue.push(player);

    send(player.ws, {
        type: "queue",
        position: queue.length
    });

    tryCreateMatch();
}

function tryCreateMatch() {
    while (queue.length >= 2) {
        const player1 = queue.shift();
        const player2 = queue.shift();

        const p1Ok = !!player1 && player1.ws.readyState === WebSocket.OPEN;
        const p2Ok = !!player2 && player2.ws.readyState === WebSocket.OPEN;

        // Fixed: previously, if either socket was dead, both players were
        // dropped from the queue entirely (via `continue`) with no
        // requeue and no notification. Now a still-connected player is
        // put back at the front of the queue instead of vanishing.
        if (!p1Ok && !p2Ok) {
            continue;
        }

        if (!p1Ok) {
            queue.unshift(player2);
            continue;
        }

        if (!p2Ok) {
            queue.unshift(player1);
            continue;
        }

        const room = createRoom(
            player1,
            player2
        );

        assignInitialRoles(room);

        send(player1.ws, {
            type: "matchWaiting"
        });

        send(player2.ws, {
            type: "matchWaiting"
        });

        setTimeout(function() {
            if (!rooms.has(room.id)) return;

            startRound(room);
        }, 3200);
    }
}

function leaveRoom(player) {
    if (!player.roomId) {
        return;
    }

    const room = rooms.get(player.roomId);

    if (!room) {
        player.roomId = null;
        return;
    }

    const other =
        room.players[0].id === player.id
            ? room.players[1]
            : room.players[0];

    if (other) {
        send(other.ws, {
            type: "opponentLeft"
        });

        other.roomId = null;
    }

    rooms.delete(room.id);

    player.roomId = null;
}

function handleMessage(player, message) {
    if (!message || typeof message !== "object") {
        return;
    }

    if (message.type === "setName") {
        let name = String(message.name || "Player");

        name = name
            .replace(/[<>]/g, "")
            .trim()
            .slice(0, 18);

        if (!name) {
            name = "Player";
        }

        player.name = name;

        send(player.ws, {
            type: "nameSet",
            name: player.name
        });

        return;
    }

    if (message.type === "selectPlane") {
        if (planeTypes[message.planeType]) {
            player.planeType = message.planeType;
        }

        if (player.roomId) {
            const room = rooms.get(player.roomId);

            if (room) {
                if (room.state.pilotId === player.id) {
                    room.state.plane.planeType =
                        player.planeType;
                }
            }
        }

        return;
    }

    if (message.type === "selectGun") {
        if (gunTypes[message.gun]) {
            player.gun = message.gun;
        }

        if (player.roomId) {
            const room = rooms.get(player.roomId);

            if (room) {
                if (room.state.gunnerId === player.id) {
                    room.state.gun =
                        player.gun;
                }
            }
        }

        return;
    }

    if (message.type === "queue") {
        joinQueue(player);
        return;
    }

    if (message.type === "input") {
        if (!player.roomId) {
            return;
        }

        const room = rooms.get(player.roomId);

        if (!room) {
            return;
        }

        if (room.state.pilotId !== player.id) {
            return;
        }

        const input = message.input || {};

        player.input.up = !!input.up;
        player.input.down = !!input.down;
        player.input.left = !!input.left;
        player.input.right = !!input.right;
        player.input.brake = !!input.brake;

        return;
    }

    if (message.type === "aim") {
        if (!player.roomId) {
            return;
        }

        const room = rooms.get(player.roomId);

        if (!room) {
            return;
        }

        if (room.state.gunnerId !== player.id) {
            return;
        }

        const x = Number(message.x);
        const y = Number(message.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return;
        }

        room.state.aim.x = clamp(
            x,
            0,
            WORLD_WIDTH
        );

        room.state.aim.y = clamp(
            y,
            0,
            WORLD_HEIGHT
        );

        player.aim.x = room.state.aim.x;
        player.aim.y = room.state.aim.y;

        return;
    }

    if (message.type === "fire") {
        if (!player.roomId) {
            return;
        }

        const room = rooms.get(player.roomId);

        if (!room) {
            return;
        }

        fireGun(room, player);

        return;
    }

    if (message.type === "rematch") {
        if (!player.roomId) {
            return;
        }

        const room = rooms.get(player.roomId);

        if (!room) {
            return;
        }

        room.state.round = 1;

        room.state.roundWins = {
            player1: 0,
            player2: 0
        };

        assignInitialRoles(room);

        setTimeout(function() {
            if (!rooms.has(room.id)) return;

            startRound(room);
        }, 1000);

        return;
    }

    if (message.type === "leave") {
        removeFromQueue(player);
        leaveRoom(player);

        send(player.ws, {
            type: "left"
        });

        return;
    }
}

const server = http.createServer(function(req, res) {
    let requestPath = req.url || "/";

    requestPath = requestPath.split("?")[0];

    if (requestPath === "/") {
        requestPath = "/index.html";
    }

    let filePath = path.join(
        __dirname,
        requestPath
    );

    filePath = path.normalize(filePath);

    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, function(err, data) {
        if (err) {
            res.writeHead(404);
            res.end("Not Found");
            return;
        }

        let contentType = "text/plain";

        if (requestPath.endsWith(".html")) {
            contentType = "text/html; charset=utf-8";
        } else if (requestPath.endsWith(".js")) {
            contentType = "application/javascript; charset=utf-8";
        } else if (requestPath.endsWith(".css")) {
            contentType = "text/css; charset=utf-8";
        } else if (requestPath.endsWith(".mp3")) {
            contentType = "audio/mpeg";
        } else if (requestPath.endsWith(".json")) {
            contentType = "application/json; charset=utf-8";
        } else if (requestPath.endsWith(".png")) {
            contentType = "image/png";
        } else if (requestPath.endsWith(".jpg") || requestPath.endsWith(".jpeg")) {
            contentType = "image/jpeg";
        } else if (requestPath.endsWith(".svg")) {
            contentType = "image/svg+xml";
        }

        res.writeHead(200, {
            "Content-Type": contentType
        });

        res.end(data);
    });
});

const wss = new WebSocket.Server({
    server: server
});

wss.on("connection", function(ws) {
    const player = createPlayerState(ws);

    console.log(
        "Player connected:",
        player.id
    );

    send(ws, {
        type: "connected",
        playerId: player.id
    });

    ws.on("message", function(raw) {
        try {
            const message =
                JSON.parse(raw.toString());

            handleMessage(
                player,
                message
            );
        } catch (err) {
            console.error(
                "Message error:",
                err.message
            );
        }
    });

    ws.on("close", function() {
        console.log(
            "Player disconnected:",
            player.id
        );

        removeFromQueue(player);
        leaveRoom(player);

        players.delete(player.id);
    });

    ws.on("error", function(err) {
        console.error(
            "WebSocket error:",
            err.message
        );
    });
});

setInterval(function() {
    const now = Date.now();

    rooms.forEach(function(room) {
        if (room.state.phase === "playing") {
            updateRoom(
                room,
                TICK_MS / 1000
            );
        }
    });

    if (now % 10000 < TICK_RATE) {
        rooms.forEach(function(room) {
            if (
                room.players[0].ws.readyState !== WebSocket.OPEN &&
                room.players[1].ws.readyState !== WebSocket.OPEN
            ) {
                rooms.delete(room.id);
            }
        });
    }
}, TICK_MS);

server.listen(
    PORT,
    "0.0.0.0",
    function() {
        console.log(
            "Pixel Sky Crash server running on port " +
            PORT
        );
    }
);
