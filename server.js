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

    if (ws.readyState !== WebSocket.OPEN) {
        return;
    }

    try {
        ws.send(JSON.stringify(data));
    } catch (err) {
        console.error("WebSocket send error:", err.message);
    }
}

function broadcast(room, data) {
    if (!room) return;

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
            y: 402,
            w: 155,
            h: 396
        };
    }

    return {
        x: 652,
        y: 402,
        w: 155,
        h: 396
    };
}

function planeHitsTower(room) {
    const s = room.state;
    const p = s.plane;

    const planeRadiusX = 48;
    const planeRadiusY = 25;

    for (let i = 1; i <= 2; i++) {
        const tower = towerRect(i);

        const left = tower.x - tower.w / 2;
        const right = tower.x + tower.w / 2;
        const top = tower.y - tower.h / 2;
        const bottom = tower.y + tower.h / 2;

        const closestX = clamp(
            p.x,
            left,
            right
        );

        const closestY = clamp(
            p.y,
            top,
            bottom
        );

        const dx = p.x - closestX;
        const dy = p.y - closestY;

        if (
            (dx * dx) / (planeRadiusX * planeRadiusX) +
            (dy * dy) / (planeRadiusY * planeRadiusY)
            <= 1
        ) {
            return i;
        }
    }

    return 0;
}

function createPlayerState(ws) {
    const player = {
        id: randomId(),

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

        lastFire: 0,

        firing: false
    };

    players.set(player.id, player);

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

            pilotId: null,

            gunnerId: null,

            pilotName: "",

            gunnerName: "",

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

                lateralVelocity: 0,

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

            towerHitCooldown: 0,

            disabledTower: 0,

            planeDisabled: false,

            winnerName: "",

            reason: ""
        }
    };

    player1.roomId = room.id;
    player2.roomId = room.id;

    rooms.set(room.id, room);

    return room;
}

function getPlayerIndex(room, player) {
    if (!room || !player) {
        return -1;
    }

    if (room.players[0].id === player.id) {
        return 0;
    }

    if (room.players[1].id === player.id) {
        return 1;
    }

    return -1;
}

function getPilot(room) {
    if (!room) return null;

    if (room.players[0].id === room.state.pilotId) {
        return room.players[0];
    }

    if (room.players[1].id === room.state.pilotId) {
        return room.players[1];
    }

    return null;
}

function getGunner(room) {
    if (!room) return null;

    if (room.players[0].id === room.state.gunnerId) {
        return room.players[0];
    }

    if (room.players[1].id === room.state.gunnerId) {
        return room.players[1];
    }

    return null;
}

function publicState(room) {
    const s = room.state;

    return {
        phase: s.phase,

        round: s.round,

        roundWins: {
            player1: s.roundWins.player1,
            player2: s.roundWins.player2
        },

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

            stalled: !!s.plane.stalled,

            disabled: !!s.planeDisabled
        },

        gunTower: s.gunTower,

        aim: {
            x: s.aim.x,
            y: s.aim.y
        },

        gun: s.gun,

        gunnerReady: !!s.gunnerReady,

        disabledTower: s.disabledTower || 0,

        bullets: s.bullets.map(function(bullet) {
            return {
                id: bullet.id,

                x: bullet.x,
                y: bullet.y,

                vx: bullet.vx,
                vy: bullet.vy
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
    if (!room) return;

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

    room.state.aim.x = 650;
    room.state.aim.y = 245;

    sendMatchFound(room);
}

function sendMatchFound(room) {
    if (!room) return;

    const s = room.state;

    for (const player of room.players) {
        send(player.ws, {
            type: "matchFound",

            roomId: room.id,

            role:
                player.id === s.pilotId
                    ? "pilot"
                    : "gunner",

            pilotName: s.pilotName,

            gunnerName: s.gunnerName,

            round: s.round,

            planeType: s.plane.planeType,

            gun: s.gun
        });
    }
}

function resetInput(player) {
    if (!player) return;

    player.input = {
        up: false,
        down: false,
        left: false,
        right: false,
        brake: false
    };

    player.firing = false;
}

function resetRound(room) {
    if (!room) return;

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

        planeType:
            pilot && planeTypes[pilot.planeType]
                ? pilot.planeType
                : "airliner",

        lateralVelocity: 0,

        stalled: false
    };

    s.gunTower = 1;

    s.aim = {
        x: 650,
        y: 245
    };

    s.gun =
        gunner && gunTypes[gunner.gun]
            ? gunner.gun
            : "mg";

    s.gunnerReady = true;

    s.bullets = [];

    s.towerHitCooldown = 0;

    s.disabledTower = 0;

    s.planeDisabled = false;

    s.winnerName = "";

    s.reason = "";

    for (const player of room.players) {
        resetInput(player);
        player.lastFire = 0;
    }
}

function startRound(room) {
    if (!room) return;

    if (!rooms.has(room.id)) {
        return;
    }

    resetRound(room);

    room.state.phase = "playing";

    sendMatchFound(room);

    sendState(room);
}

function switchRoles(room) {
    if (!room) return;

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

    if (pilot && planeTypes[pilot.planeType]) {
        s.plane.planeType = pilot.planeType;
    }

    if (gunner && gunTypes[gunner.gun]) {
        s.gun = gunner.gun;
    }

    s.gunTower =
        s.gunTower === 1
            ? 2
            : 1;
}

function awardRoundWin(room, winner) {
    if (!room || !winner) return;

    if (room.players[0].id === winner.id) {
        room.state.roundWins.player1++;
    }

    if (room.players[1].id === winner.id) {
        room.state.roundWins.player2++;
    }
}

function getWinnerOfMatch(room) {
    if (!room) return null;

    if (room.state.roundWins.player1 >= 3) {
        return room.players[0];
    }

    if (room.state.roundWins.player2 >= 3) {
        return room.players[1];
    }

    return null;
}

function finishRound(room, winner, reason) {
    if (!room) return;

    if (room.state.phase !== "playing") {
        return;
    }

    const s = room.state;

    s.phase = "roundEnd";

    s.winnerName = winner
        ? winner.name
        : "";

    s.reason = reason || "";

    s.planeDisabled = true;

    s.plane.vx = 0;
    s.plane.vy = 0;
    s.plane.speed = 0;

    for (const player of room.players) {
        player.firing = false;
        resetInput(player);
    }

    awardRoundWin(room, winner);

    sendState(room);

    const matchWinner = getWinnerOfMatch(room);

    if (matchWinner) {
        setTimeout(function() {
            if (!rooms.has(room.id)) return;

            room.state.phase = "ended";

            room.state.winnerName =
                matchWinner.name;

            room.state.reason =
                "Match complete";

            sendState(room);
        }, 1200);

        return;
    }

    setTimeout(function() {
        if (!rooms.has(room.id)) {
            return;
        }

        room.state.round++;

        switchRoles(room);

        room.state.phase = "waiting";

        resetRound(room);

        sendMatchFound(room);
        sendState(room);

        setTimeout(function() {
            if (!rooms.has(room.id)) {
                return;
            }

            startRound(room);
        }, 1800);
    }, 3000);
}

function updatePlane(room, dt) {
    const s = room.state;

    const pilot = getPilot(room);

    if (!pilot || s.planeDisabled) {
        return;
    }

    const type =
        planeTypes[s.plane.planeType] ||
        planeTypes.airliner;

    const input = pilot.input;

    const verticalInput =
        (input.down ? 1 : 0) -
        (input.up ? 1 : 0);

    const horizontalInput =
        (input.right ? 1 : 0) -
        (input.left ? 1 : 0);

    if (input.brake) {
        s.plane.speed -=
            type.braking *
            1.35 *
            dt;
    } else {
        s.plane.speed +=
            type.acceleration *
            dt;
    }

    s.plane.speed = clamp(
        s.plane.speed,
        1.8,
        type.maxSpeed
    );

    const targetVy =
        verticalInput * 6.2;

    s.plane.vy +=
        (targetVy - s.plane.vy) *
        Math.min(
            1,
            dt * 5.5
        );

    s.plane.vy = clamp(
        s.plane.vy,
        -6.8,
        6.8
    );

    if (
        s.plane.lateralVelocity ===
        undefined
    ) {
        s.plane.lateralVelocity = 0;
    }

    const maxSide =
        Math.min(
            5.2,
            type.turn / 42
        );

    const targetLateral =
        horizontalInput * maxSide;

    s.plane.lateralVelocity +=
        (targetLateral -
            s.plane.lateralVelocity) *
        Math.min(
            1,
            dt * 7.5
        );

    s.plane.lateralVelocity =
        clamp(
            s.plane.lateralVelocity,
            -5.5,
            5.5
        );

    s.plane.vx =
        s.plane.speed +
        s.plane.lateralVelocity;

    s.plane.x +=
        s.plane.vx *
        60 *
        dt;

    s.plane.y +=
        s.plane.vy *
        60 *
        dt;

    if (s.plane.y < 65) {
        s.plane.y = 65;

        s.plane.vy =
            Math.max(
                0,
                s.plane.vy
            );
    }

    if (s.plane.y > 430) {
        s.plane.y = 430;

        s.plane.vy =
            Math.min(
                0,
                s.plane.vy
            );
    }

    const targetPitch =
        s.plane.vy * 7.5 +
        s.plane.lateralVelocity * 2.8;

    s.plane.pitch +=
        (targetPitch -
            s.plane.pitch) *
        Math.min(
            1,
            dt * 8
        );

    s.plane.pitch =
        clamp(
            s.plane.pitch,
            -38,
            38
        );

    s.plane.stalled =
        s.plane.speed <=
        type.maxSpeed *
        type.stall;

    if (
        s.plane.x >
        WORLD_WIDTH + 80
    ) {
        s.plane.x = -70;
    }

    if (
        s.plane.x < -80
    ) {
        s.plane.x = -70;
    }
}

function segmentDistanceToPoint(
    x1,
    y1,
    x2,
    y2,
    px,
    py
) {
    const dx = x2 - x1;
    const dy = y2 - y1;

    if (
        dx === 0 &&
        dy === 0
    ) {
        return distance(
            x1,
            y1,
            px,
            py
        );
    }

    const t = clamp(
        (
            (px - x1) * dx +
            (py - y1) * dy
        ) /
        (
            dx * dx +
            dy * dy
        ),
        0,
        1
    );

    const cx =
        x1 + dx * t;

    const cy =
        y1 + dy * t;

    return distance(
        cx,
        cy,
        px,
        py
    );
}

function sendShotResult(
    player,
    shotId,
    result,
    damage,
    hp
) {
    if (!player) return;

    send(player.ws, {
        type: "shotResult",

        shotId: shotId,

        result: result,

        damage:
            damage || 0,

        hp:
            hp === undefined
                ? null
                : hp
    });
}

function updateBullets(room, dt) {
    const s = room.state;

    for (
        let i = s.bullets.length - 1;
        i >= 0;
        i--
    ) {
        const bullet =
            s.bullets[i];

        const oldX =
            bullet.x;

        const oldY =
            bullet.y;

        bullet.x +=
            bullet.vx *
            60 *
            dt;

        bullet.y +=
            bullet.vy *
            60 *
            dt;

        bullet.life -= dt;

        const outOfBounds =
            bullet.x < -150 ||
            bullet.x >
                WORLD_WIDTH + 150 ||
            bullet.y < -150 ||
            bullet.y >
                WORLD_HEIGHT + 150;

        if (
            bullet.life <= 0 ||
            outOfBounds
        ) {
            const shooter =
                players.get(
                    bullet.ownerId
                );

            sendShotResult(
                shooter,
                bullet.id,
                "miss"
            );

            s.bullets.splice(
                i,
                1
            );

            continue;
        }

        const hitDistance =
            segmentDistanceToPoint(
                oldX,
                oldY,
                bullet.x,
                bullet.y,
                s.plane.x,
                s.plane.y
            );

        if (
            hitDistance <= 42 &&
            !s.planeDisabled
        ) {
            s.plane.hp -=
                bullet.damage;

            s.plane.hp =
                Math.max(
                    0,
                    s.plane.hp
                );

            const shooter =
                players.get(
                    bullet.ownerId
                );

            sendShotResult(
                shooter,
                bullet.id,
                "hit",
                bullet.damage,
                s.plane.hp
            );

            broadcast(room, {
                type: "impact",

                x: s.plane.x,

                y: s.plane.y,

                damage: bullet.damage,

                hp: s.plane.hp
            });

            s.bullets.splice(
                i,
                1
            );

            if (
                s.plane.hp <= 0
            ) {
                finishRound(
                    room,
                    getGunner(room),
                    "Plane shot down"
                );

                return;
            }
        }
    }
}

function updateRoom(room, dt) {
    if (
        !room ||
        room.state.phase !==
            "playing"
    ) {
        return;
    }

    updatePlane(
        room,
        dt
    );

    if (
        room.state.towerHitCooldown >
        0
    ) {
        room.state.towerHitCooldown -=
            dt;
    }

    if (
        room.state.towerHitCooldown <= 0 &&
        !room.state.planeDisabled
    ) {
        const hitTower =
            planeHitsTower(room);

        if (
            hitTower !== 0
        ) {
            room.state.disabledTower =
                hitTower;

            room.state.planeDisabled =
                true;

            room.state.plane.speed =
                0;

            room.state.plane.vx =
                0;

            room.state.plane.vy =
                0;

            room.state.plane.pitch =
                0;

            room.state.towerHitCooldown =
                999999;

            finishRound(
                room,
                getPilot(room),
                "Tower hit — tower disabled"
            );

            return;
        }
    }

    const gunner =
        getGunner(room);

    if (
        gunner &&
        gunner.firing
    ) {
        fireGun(
            room,
            gunner,
            true
        );
    }

    updateBullets(
        room,
        dt
    );

    if (
        room.state.phase !==
        "playing"
    ) {
        return;
    }

    if (gunner) {
        const gun =
            gunTypes[
                gunner.gun
            ] ||
            gunTypes.mg;

        room.state.gunnerReady =
            Date.now() -
                gunner.lastFire >=
            gun.cooldown;
    }

    sendState(room);
}

function fireGun(
    room,
    player,
    automatic
) {
    if (!room || !player) {
        return false;
    }

    if (
        room.state.phase !==
        "playing"
    ) {
        return false;
    }

    if (
        room.state.gunnerId !==
        player.id
    ) {
        return false;
    }

    const gun =
        gunTypes[player.gun] ||
        gunTypes.mg;

    const now =
        Date.now();

    if (
        now -
            player.lastFire <
        gun.cooldown
    ) {
        return false;
    }

    let towerX =
        room.state.gunTower === 1
            ? 347
            : 652;

    let towerY = 245;

    let targetX =
        Number(room.state.aim.x);

    let targetY =
        Number(room.state.aim.y);

    if (
        !Number.isFinite(targetX)
    ) {
        targetX =
            towerX + 100;
    }

    if (
        !Number.isFinite(targetY)
    ) {
        targetY =
            towerY;
    }

    let dx =
        targetX - towerX;

    let dy =
        targetY - towerY;

    let len =
        Math.sqrt(
            dx * dx +
            dy * dy
        );

    if (
        !Number.isFinite(len) ||
        len < 0.001
    ) {
        dx = 1;
        dy = 0;
        len = 1;
    }

    dx /= len;
    dy /= len;

    player.lastFire =
        now;

    const bulletId =
        randomId();

    const startX =
        towerX +
        dx * 42;

    const startY =
        towerY +
        dy * 42;

    room.state.bullets.push({
        id: bulletId,

        ownerId: player.id,

        x: startX,

        y: startY,

        vx:
            dx *
            gun.bulletSpeed,

        vy:
            dy *
            gun.bulletSpeed,

        damage:
            gun.damage,

        life: 2.5
    });

    room.state.gunnerReady =
        false;

    send(player.ws, {
        type: "shotFired",

        shotId: bulletId,

        x: startX,

        y: startY,

        vx:
            dx *
            gun.bulletSpeed,

        vy:
            dy *
            gun.bulletSpeed
    });

    return true;
}

function removeFromQueue(player) {
    if (!player) return;

    const index =
        queue.indexOf(player);

    if (index !== -1) {
        queue.splice(
            index,
            1
        );
    }
}

function joinQueue(player) {
    if (!player) return;

    removeFromQueue(player);

    if (player.roomId) {
        return;
    }

    if (
        !player.ws ||
        player.ws.readyState !==
            WebSocket.OPEN
    ) {
        return;
    }

    queue.push(player);

    send(player.ws, {
        type: "queue",

        position:
            queue.length
    });

    tryCreateMatch();
}

function tryCreateMatch() {
    while (
        queue.length >= 2
    ) {
        let player1 =
            queue.shift();

        let player2 =
            queue.shift();

        const p1Ok =
            player1 &&
            player1.ws &&
            player1.ws.readyState ===
                WebSocket.OPEN;

        const p2Ok =
            player2 &&
            player2.ws &&
            player2.ws.readyState ===
                WebSocket.OPEN;

        if (
            !p1Ok &&
            !p2Ok
        ) {
            continue;
        }

        if (!p1Ok) {
            queue.unshift(
                player2
            );

            continue;
        }

        if (!p2Ok) {
            queue.unshift(
                player1
            );

            continue;
        }

        if (
            player1.roomId ||
            player2.roomId
        ) {
            if (!player1.roomId) {
                queue.unshift(
                    player1
                );
            }

            if (!player2.roomId) {
                queue.unshift(
                    player2
                );
            }

            continue;
        }

        const room =
            createRoom(
                player1,
                player2
            );

        assignInitialRoles(
            room
        );

        send(player1.ws, {
            type: "matchWaiting"
        });

        send(player2.ws, {
            type: "matchWaiting"
        });

        setTimeout(function() {
            if (
                !rooms.has(
                    room.id
                )
            ) {
                return;
            }

            if (
                room.players[0].ws.readyState !==
                    WebSocket.OPEN ||
                room.players[1].ws.readyState !==
                    WebSocket.OPEN
            ) {
                return;
            }

            startRound(room);
        }, 3200);
    }
}

function leaveRoom(player) {
    if (!player) return;

    if (!player.roomId) {
        return;
    }

    const room =
        rooms.get(
            player.roomId
        );

    if (!room) {
        player.roomId = null;
        return;
    }

    const other =
        room.players[0].id ===
        player.id
            ? room.players[1]
            : room.players[0];

    if (other) {
        other.roomId = null;

        other.firing = false;

        resetInput(other);

        send(other.ws, {
            type: "opponentLeft"
        });
    }

    rooms.delete(
        room.id
    );

    player.roomId = null;

    player.firing = false;

    resetInput(player);
}

function sanitizeName(value) {
    let name =
        String(
            value ||
            "Player"
        );

    name =
        name
            .replace(
                /[<>]/g,
                ""
            )
            .trim()
            .slice(
                0,
                18
            );

    if (!name) {
        name = "Player";
    }

    return name;
}

function handleMessage(
    player,
    message
) {
    if (
        !player ||
        !message ||
        typeof message !==
            "object"
    ) {
        return;
    }

    if (
        message.type ===
        "setName"
    ) {
        player.name =
            sanitizeName(
                message.name
            );

        send(player.ws, {
            type: "nameSet",

            name:
                player.name
        });

        return;
    }

    if (
        message.type ===
        "selectPlane"
    ) {
        if (
            planeTypes[
                message.planeType
            ]
        ) {
            player.planeType =
                message.planeType;
        }

        if (player.roomId) {
            const room =
                rooms.get(
                    player.roomId
                );

            if (room) {
                if (
                    room.state.pilotId ===
                    player.id
                ) {
                    room.state.plane.planeType =
                        player.planeType;
                }
            }
        }

        return;
    }

    if (
        message.type ===
        "selectGun"
    ) {
        if (
            gunTypes[
                message.gun
            ]
        ) {
            player.gun =
                message.gun;
        }

        if (player.roomId) {
            const room =
                rooms.get(
                    player.roomId
                );

            if (room) {
                if (
                    room.state.gunnerId ===
                    player.id
                ) {
                    room.state.gun =
                        player.gun;
                }
            }
        }

        return;
    }

    if (
        message.type ===
        "queue"
    ) {
        if (
            message.name !==
            undefined
        ) {
            player.name =
                sanitizeName(
                    message.name
                );
        }

        joinQueue(
            player
        );

        return;
    }

    if (
        message.type ===
        "cancelQueue"
    ) {
        removeFromQueue(
            player
        );

        send(player.ws, {
            type: "left"
        });

        return;
    }

    if (
        message.type ===
        "input"
    ) {
        if (!player.roomId) {
            return;
        }

        const room =
            rooms.get(
                player.roomId
            );

        if (!room) {
            return;
        }

        if (
            room.state.pilotId !==
            player.id
        ) {
            return;
        }

        const input =
            message.input ||
            {};

        player.input.up =
            !!input.up;

        player.input.down =
            !!input.down;

        player.input.left =
            !!input.left;

        player.input.right =
            !!input.right;

        player.input.brake =
            !!input.brake;

        return;
    }

    if (
        message.type ===
        "aim"
    ) {
        if (!player.roomId) {
            return;
        }

        const room =
            rooms.get(
                player.roomId
            );

        if (!room) {
            return;
        }

        if (
            room.state.gunnerId !==
            player.id
        ) {
            return;
        }

        const x =
            Number(
                message.x
            );

        const y =
            Number(
                message.y
            );

        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            return;
        }

        room.state.aim.x =
            clamp(
                x,
                0,
                WORLD_WIDTH
            );

        room.state.aim.y =
            clamp(
                y,
                0,
                WORLD_HEIGHT
            );

        player.aim.x =
            room.state.aim.x;

        player.aim.y =
            room.state.aim.y;

        return;
    }

    if (
        message.type ===
        "fire"
    ) {
        if (!player.roomId) {
            return;
        }

        const room =
            rooms.get(
                player.roomId
            );

        if (
            !room ||
            room.state.phase !==
                "playing"
        ) {
            return;
        }

        if (
            room.state.gunnerId !==
            player.id
        ) {
            return;
        }

        player.firing =
            true;

        fireGun(
            room,
            player,
            false
        );

        return;
    }

    if (
        message.type ===
        "stopFire"
    ) {
        player.firing =
            false;

        return;
    }

    if (
        message.type ===
        "rematch"
    ) {
        if (!player.roomId) {
            return;
        }

        const room =
            rooms.get(
                player.roomId
            );

        if (!room) {
            return;
        }

        room.state.round =
            1;

        room.state.roundWins = {
            player1: 0,
            player2: 0
        };

        assignInitialRoles(
            room
        );

        room.state.phase =
            "waiting";

        sendState(
            room
        );

        setTimeout(function() {
            if (
                !rooms.has(
                    room.id
                )
            ) {
                return;
            }

            startRound(
                room
            );
        }, 1000);

        return;
    }

    if (
        message.type ===
        "leave"
    ) {
        removeFromQueue(
            player
        );

        leaveRoom(
            player
        );

        send(player.ws, {
            type: "left"
        });

        return;
    }
}

const server =
    http.createServer(
        function(req, res) {
            let requestPath =
                req.url || "/";

            requestPath =
                requestPath.split(
                    "?"
                )[0];

            if (
                requestPath ===
                "/"
            ) {
                requestPath =
                    "/index.html";
            }

            let decodedPath;

            try {
                decodedPath =
                    decodeURIComponent(
                        requestPath
                    );
            } catch (err) {
                res.writeHead(
                    400
                );

                res.end(
                    "Bad Request"
                );

                return;
            }

            let filePath =
                path.join(
                    __dirname,
                    decodedPath
                );

            filePath =
                path.normalize(
                    filePath
                );

            const root =
                path.resolve(
                    __dirname
                );

            const resolved =
                path.resolve(
                    filePath
                );

            if (
                resolved !== root &&
                !resolved.startsWith(
                    root +
                    path.sep
                )
            ) {
                res.writeHead(
                    403
                );

                res.end(
                    "Forbidden"
                );

                return;
            }

            fs.readFile(
                resolved,
                function(
                    err,
                    data
                ) {
                    if (err) {
                        res.writeHead(
                            404,
                            {
                                "Content-Type":
                                    "text/plain; charset=utf-8"
                            }
                        );

                        res.end(
                            "Not Found"
                        );

                        return;
                    }

                    let contentType =
                        "text/plain; charset=utf-8";

                    if (
                        resolved.endsWith(
                            ".html"
                        )
                    ) {
                        contentType =
                            "text/html; charset=utf-8";
                    } else if (
                        resolved.endsWith(
                            ".js"
                        )
                    ) {
                        contentType =
                            "application/javascript; charset=utf-8";
                    } else if (
                        resolved.endsWith(
                            ".css"
                        )
                    ) {
                        contentType =
                            "text/css; charset=utf-8";
                    } else if (
                        resolved.endsWith(
                            ".mp3"
                        )
                    ) {
                        contentType =
                            "audio/mpeg";
                    } else if (
                        resolved.endsWith(
                            ".png"
                        )
                    ) {
                        contentType =
                            "image/png";
                    } else if (
                        resolved.endsWith(
                            ".jpg"
                        ) ||
                        resolved.endsWith(
                            ".jpeg"
                        )
                    ) {
                        contentType =
                            "image/jpeg";
                    } else if (
                        resolved.endsWith(
                            ".svg"
                        )
                    ) {
                        contentType =
                            "image/svg+xml";
                    } else if (
                        resolved.endsWith(
                            ".json"
                        )
                    ) {
                        contentType =
                            "application/json; charset=utf-8";
                    }

                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                contentType,

                            "Cache-Control":
                                "no-cache"
                        }
                    );

                    res.end(
                        data
                    );
                }
            );
        }
    );

const wss =
    new WebSocket.Server({
        server: server
    });

wss.on(
    "connection",
    function(ws) {
        const player =
            createPlayerState(
                ws
            );

        console.log(
            "Player connected:",
            player.id
        );

        send(ws, {
            type: "connected",

            playerId:
                player.id
        });

        ws.on(
            "message",
            function(raw) {
                try {
                    const message =
                        JSON.parse(
                            raw.toString()
                        );

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
            }
        );

        ws.on(
            "close",
            function() {
                console.log(
                    "Player disconnected:",
                    player.id
                );

                removeFromQueue(
                    player
                );

                leaveRoom(
                    player
                );

                players.delete(
                    player.id
                );
            }
        );

        ws.on(
            "error",
            function(err) {
                console.error(
                    "WebSocket error:",
                    err.message
                );
            }
        );
    }
);

setInterval(
    function() {
        const dt =
            TICK_MS / 1000;

        for (
            const room of rooms.values()
        ) {
            if (
                room.state.phase ===
                "playing"
            ) {
                updateRoom(
                    room,
                    dt
                );
            }
        }

        for (
            const [id, room] of
            rooms.entries()
        ) {
            const p1 =
                room.players[0];

            const p2 =
                room.players[1];

            const p1Dead =
                !p1 ||
                !p1.ws ||
                p1.ws.readyState !==
                    WebSocket.OPEN;

            const p2Dead =
                !p2 ||
                !p2.ws ||
                p2.ws.readyState !==
                    WebSocket.OPEN;

            if (
                p1Dead &&
                p2Dead
            ) {
                rooms.delete(
                    id
                );
            }
        }

        tryCreateMatch();
    },
    TICK_MS
);

server.listen(
    PORT,
    "0.0.0.0",
    function() {
        console.log(
            "Pixel Sky Crash server running on port " +
            PORT
        );

        console.log(
            "WebSocket multiplayer is ready."
        );
    }
);
