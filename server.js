
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
        const filePath = path.join(__dirname, "index.html");

        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(500, {
                    "Content-Type": "text/plain"
                });

                res.end("Could not load index.html.");
                return;
            }

            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8"
            });

            res.end(data);
        });

        return;
    }

    res.writeHead(404, {
        "Content-Type": "text/plain"
    });

    res.end("Not found.");
});

const wss = new WebSocket.Server({
    server
});

const queue = [];
const rooms = new Map();
const players = new Map();

const PLANES = {
    small: {
        maxSpeed: 7.5,
        acceleration: 2.8,
        braking: 4.5,
        turn: 170,
        climb: 145,
        stall: 0.32
    },

    airliner: {
        maxSpeed: 5.5,
        acceleration: 1.8,
        braking: 3.0,
        turn: 105,
        climb: 100,
        stall: 0.26
    },

    large: {
        maxSpeed: 4.7,
        acceleration: 1.35,
        braking: 2.7,
        turn: 82,
        climb: 82,
        stall: 0.23
    },

    cargo: {
        maxSpeed: 4.2,
        acceleration: 1.1,
        braking: 3.8,
        turn: 70,
        climb: 70,
        stall: 0.21
    },

    fighter: {
        maxSpeed: 10,
        acceleration: 3.8,
        braking: 5.5,
        turn: 240,
        climb: 190,
        stall: 0.36
    }
};

const TOWER_MAX_HP = 100;
const PLANE_MAX_HP = 100;

function makeId() {
    return crypto.randomBytes(8).toString("hex");
}

function send(ws, message) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(JSON.stringify(message));
    }
}

function broadcast(room, message) {
    for (const player of room.players) {
        send(player.ws, message);
    }
}

function cleanName(name) {
    if (typeof name !== "string") {
        return "Player";
    }

    return name
        .replace(/[^\w \-]/g, "")
        .trim()
        .slice(0, 16) || "Player";
}

function removeFromQueue(ws) {
    const index = queue.indexOf(ws);

    if (index !== -1) {
        queue.splice(index, 1);
    }
}

function getRoom(player) {
    if (!player || !player.roomId) {
        return null;
    }

    return rooms.get(player.roomId) || null;
}

function createInitialState() {
    return {
        phase: "waiting",

        towers: [
            {
                hp: 100,
                destroyed: false
            },
            {
                hp: 100,
                destroyed: false
            }
        ],

        plane: {
            x: 100,
            y: 280,

            vx: 0,
            vy: 0,

            speed: 4,

            pitch: 0,

            hp: PLANE_MAX_HP,

            planeType: "airliner"
        },

        aim: {
            x: 0,
            y: 0
        },

        gunnerTower: 1,

        winnerName: null,
        reason: null
    };
}

function createRoom(playerA, playerB) {
    const room = {
        id: makeId(),

        players: [
            playerA,
            playerB
        ],

        state: createInitialState(),

        bullets: [],

        lastTime: Date.now(),

        finished: false
    };

    const pilotFirst = Math.random() < 0.5;

    playerA.role = pilotFirst
        ? "Pilot"
        : "Gunner";

    playerB.role = pilotFirst
        ? "Gunner"
        : "Pilot";

    playerA.roomId = room.id;
    playerB.roomId = room.id;

    rooms.set(room.id, room);

    sendMatchFound(playerA, playerB);
    sendMatchFound(playerB, playerA);

    setTimeout(() => {
        if (!rooms.has(room.id)) {
            return;
        }

        room.state.phase = "playing";
        room.lastTime = Date.now();

        broadcast(room, {
            type: "state",
            state: room.state
        });
    }, 3200);

    return room;
}

function sendMatchFound(player, opponent) {
    send(player.ws, {
        type: "matchFound",

        you: {
            name: player.name,
            role: player.role
        },

        opponent: {
            name: opponent.name,
            role: opponent.role
        },

        players: [
            {
                name: player.name,
                role: player.role
            },

            {
                name: opponent.name,
                role: opponent.role
            }
        ]
    });
}

function tryMatchPlayers() {
    while (queue.length >= 2) {
        const wsA = queue.shift();
        const wsB = queue.shift();

        if (
            !wsA ||
            !wsB ||
            wsA.readyState !== WebSocket.OPEN ||
            wsB.readyState !== WebSocket.OPEN
        ) {
            continue;
        }

        const playerA = players.get(wsA);
        const playerB = players.get(wsB);

        if (!playerA || !playerB) {
            continue;
        }

        createRoom(playerA, playerB);
    }
}

function queuePlayer(player) {
    removeFromQueue(player.ws);

    queue.push(player.ws);

    send(player.ws, {
        type: "queued",
        position: Math.min(queue.length, 2)
    });

    tryMatchPlayers();
}

function handleInput(player, message) {
    const room = getRoom(player);

    if (!room) {
        return;
    }

    if (player.role !== "Pilot") {
        return;
    }

    if (!message.input) {
        return;
    }

    player.input = {
        up: !!message.input.up,
        down: !!message.input.down,
        left: !!message.input.left,
        right: !!message.input.right,
        brake: !!message.input.brake
    };
}

function handleAim(player, message) {
    const room = getRoom(player);

    if (!room) {
        return;
    }

    if (player.role !== "Gunner") {
        return;
    }

    const x = Number(message.x);
    const y = Number(message.y);

    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y)
    ) {
        return;
    }

    room.state.aim.x = x;
    room.state.aim.y = y;
}

function handleFire(player) {
    const room = getRoom(player);

    if (!room) {
        return;
    }

    if (player.role !== "Gunner") {
        return;
    }

    if (room.finished) {
        return;
    }

    const now = Date.now();

    if (
        player.lastShot &&
        now - player.lastShot < 110
    ) {
        return;
    }

    player.lastShot = now;

    const plane = room.state.plane;

    const dx =
        room.state.aim.x -
        plane.x;

    const dy =
        room.state.aim.y -
        plane.y;

    const length =
        Math.sqrt(
            dx * dx +
            dy * dy
        ) || 1;

    const startX =
        room.state.gunnerTower === 1
            ? 300
            : 650;

    const startY = 250;

    room.bullets.push({
        x: startX,
        y: startY,

        vx: (dx / length) * 13,
        vy: (dy / length) * 13,

        life: 100
    });
}

function handlePlaneSelection(player, message) {
    const room = getRoom(player);

    if (!room) {
        return;
    }

    if (player.role !== "Pilot") {
        return;
    }

    const planeType = message.plane;

    if (!PLANES[planeType]) {
        return;
    }

    room.state.plane.planeType = planeType;
}

function updatePlane(room, dt) {
    const plane = room.state.plane;

    const pilot = room.players.find(
        player => player.role === "Pilot"
    );

    if (!pilot) {
        return;
    }

    const input = pilot.input || {};

    const stats =
        PLANES[plane.planeType] ||
        PLANES.airliner;

    /*
        OLD PLANE PHYSICS

        The plane automatically moves forward.

        W / UP:
        Accelerates and climbs.

        S / DOWN:
        Slows down and descends.

        A / LEFT:
        Turns left.

        D / RIGHT:
        Turns right.

        SPACE:
        Brakes.
    */

    if (input.up) {
        plane.speed +=
            stats.acceleration * dt;

        plane.speed =
            Math.min(
                stats.maxSpeed,
                plane.speed
            );

        plane.vy -=
            stats.climb * 0.18 * dt;
    }
    else if (
        input.down ||
        input.brake
    ) {
        plane.speed -=
            stats.braking * dt;

        plane.speed =
            Math.max(
                0,
                plane.speed
            );

        plane.vy +=
            stats.climb * 0.12 * dt;
    }
    else {
        /*
            Automatic forward acceleration.
        */

        plane.speed +=
            stats.acceleration *
            0.22 *
            dt;

        plane.speed =
            Math.min(
                stats.maxSpeed,
                plane.speed
            );
    }

    if (input.left) {
        plane.vx -=
            stats.turn *
            0.012 *
            dt;
    }

    if (input.right) {
        plane.vx +=
            stats.turn *
            0.012 *
            dt;
    }

    if (input.up) {
        plane.vy -=
            stats.climb *
            0.18 *
            dt;
    }

    if (input.down) {
        plane.vy +=
            stats.climb *
            0.18 *
            dt;
    }

    plane.vx *=
        Math.pow(0.985, dt * 60);

    plane.vy *=
        Math.pow(0.94, dt * 60);

    plane.vx =
        Math.max(
            -stats.maxSpeed,
            Math.min(
                stats.maxSpeed,
                plane.vx
            )
        );

    plane.vy =
        Math.max(
            -stats.maxSpeed,
            Math.min(
                stats.maxSpeed,
                plane.vy
            )
        );

    /*
        Forward movement.
    */

    plane.x +=
        (plane.speed + plane.vx) *
        35 *
        dt;

    plane.y +=
        plane.vy *
        35 *
        dt;

    /*
        World boundaries.
    */

    const WORLD_WIDTH = 1000;
    const WORLD_HEIGHT = 600;

    plane.x =
        Math.max(
            30,
            Math.min(
                WORLD_WIDTH - 30,
                plane.x
            )
        );

    plane.y =
        Math.max(
            90,
            Math.min(
                WORLD_HEIGHT - 170,
                plane.y
            )
        );

    /*
        Visual pitch.
    */

    plane.pitch =
        Math.max(
            -30,
            Math.min(
                30,
                plane.vy * 4
            )
        );

    /*
        Stall effect.
    */

    if (
        plane.speed <
        stats.maxSpeed *
        stats.stall
    ) {
        plane.vy +=
            0.18 * dt;
    }
}

function getTowerRect(number) {
    if (number === 1) {
        return {
            x: 260,
            y: 250,
            w: 175,
            h: 500
        };
    }

    return {
        x: 565,
        y: 250,
        w: 175,
        h: 500
    };
}

function checkPlaneTowerCollision(room) {
    const plane = room.state.plane;

    for (let i = 1; i <= 2; i++) {
        const tower = room.state.towers[i - 1];

        if (tower.destroyed) {
            continue;
        }

        const rect = getTowerRect(i);

        const dx =
            Math.abs(
                plane.x - rect.x
            );

        const dy =
            Math.abs(
                plane.y - rect.y
            );

        if (
            dx <
                rect.w / 2 + 45 &&
            dy <
                rect.h / 2
        ) {
            tower.hp -= 28;

            tower.hp =
                Math.max(
                    0,
                    tower.hp
                );

            if (tower.hp <= 0) {
                tower.destroyed = true;
            }

            plane.speed *= 0.65;
            plane.vx *= 0.4;

            /*
                Move the gunner to the
                remaining tower.
            */

            if (
                tower.destroyed &&
                room.state.gunnerTower === i
            ) {
                room.state.gunnerTower =
                    i === 1 ? 2 : 1;
            }

            /*
                Both towers destroyed.
            */

            if (
                room.state.towers[0].destroyed &&
                room.state.towers[1].destroyed
            ) {
                finishRoom(
                    room,
                    "Pilot",
                    "Both towers were destroyed."
                );
            }

            return;
        }
    }
}

function updateBullets(room) {
    const plane = room.state.plane;

    for (
        let i = room.bullets.length - 1;
        i >= 0;
        i--
    ) {
        const bullet =
            room.bullets[i];

        bullet.x += bullet.vx;
        bullet.y += bullet.vy;

        bullet.life--;

        const dx =
            bullet.x -
            plane.x;

        const dy =
            bullet.y -
            plane.y;

        const distance =
            Math.sqrt(
                dx * dx +
                dy * dy
            );

        if (distance < 35) {
            plane.hp -= 5;

            plane.hp =
                Math.max(
                    0,
                    plane.hp
                );

            room.bullets.splice(i, 1);

            if (plane.hp <= 0) {
                finishRoom(
                    room,
                    "Gunner",
                    "The plane was shot down."
                );

                return;
            }

            continue;
        }

        if (
            bullet.life <= 0 ||
            bullet.x < 0 ||
            bullet.x > 1200 ||
            bullet.y < 0 ||
            bullet.y > 800
        ) {
            room.bullets.splice(i, 1);
        }
    }
}

function finishRoom(
    room,
    winningRole,
    reason
) {
    if (room.finished) {
        return;
    }

    room.finished = true;

    const winner =
        room.players.find(
            player =>
                player.role === winningRole
        );

    room.state.phase = "ended";

    room.state.winnerName =
        winner
            ? winner.name
            : "Player";

    room.state.reason = reason;

    broadcast(room, {
        type: "state",
        state: room.state
    });
}

function leaveRoom(player) {
    removeFromQueue(player.ws);

    if (!player.roomId) {
        return;
    }

    const room =
        rooms.get(player.roomId);

    if (!room) {
        player.roomId = null;
        return;
    }

    const opponent =
        room.players.find(
            other =>
                other !== player
        );

    if (opponent) {
        opponent.roomId = null;

        send(opponent.ws, {
            type: "opponentLeft"
        });
    }

    rooms.delete(room.id);

    player.roomId = null;
}

function gameTick() {
    const now = Date.now();

    for (const room of rooms.values()) {
        if (room.finished) {
            continue;
        }

        if (room.state.phase !== "playing") {
            continue;
        }

        let dt =
            (now - room.lastTime) /
            1000;

        room.lastTime = now;

        dt =
            Math.max(
                0,
                Math.min(
                    0.05,
                    dt
                )
            );

        updatePlane(
            room,
            dt
        );

        checkPlaneTowerCollision(
            room
        );

        if (room.finished) {
            continue;
        }

        updateBullets(room);

        if (room.finished) {
            continue;
        }

        broadcast(room, {
            type: "state",
            state: room.state
        });
    }
}

setInterval(
    gameTick,
    1000 / 30
);

wss.on("connection", ws => {
    const player = {
        ws,

        id: makeId(),

        name: "Player",

        role: null,

        roomId: null,

        input: {
            up: false,
            down: false,
            left: false,
            right: false,
            brake: false
        },

        lastShot: 0
    };

    players.set(
        ws,
        player
    );

    send(ws, {
        type: "connected"
    });

    ws.on("message", raw => {
        let message;

        try {
            message =
                JSON.parse(
                    raw.toString()
                );
        }
        catch {
            return;
        }

        if (
            !message ||
            typeof message.type !== "string"
        ) {
            return;
        }

        if (message.type === "queue") {
            if (player.roomId) {
                return;
            }

            player.name =
                cleanName(
                    message.name
                );

            queuePlayer(player);

            return;
        }

        if (
            message.type ===
            "cancelQueue"
        ) {
            removeFromQueue(
                player.ws
            );

            return;
        }

        if (message.type === "input") {
            handleInput(
                player,
                message
            );

            return;
        }

        if (message.type === "aim") {
            handleAim(
                player,
                message
            );

            return;
        }

        if (message.type === "fire") {
            handleFire(player);

            return;
        }

        if (
            message.type ===
            "selectPlane"
        ) {
            handlePlaneSelection(
                player,
                message
            );

            return;
        }

        if (
            message.type ===
            "leaveRoom"
        ) {
            leaveRoom(player);

            return;
        }
    });

    ws.on("close", () => {
        removeFromQueue(ws);

        leaveRoom(player);

        players.delete(ws);
    });
});

server.listen(
    PORT,
    () => {
        console.log(
            `Pixel Sky Crash server running on port ${PORT}`
        );

        console.log(
            `Open http://localhost:${PORT}`
        );
    }
);

