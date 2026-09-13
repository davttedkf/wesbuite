const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    let filePath;

    if (req.url === "/" || req.url === "/index.html") {
        filePath = path.join(__dirname, "index.html");
    } else {
        filePath = path.join(__dirname, req.url);
    }

    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not Found");
        return;
    }

    const ext = path.extname(filePath).toLowerCase();

    const contentTypes = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".ogg": "audio/ogg"
    };

    const contentType = contentTypes[ext] || "application/octet-stream";

    res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache"
    });

    fs.createReadStream(filePath).pipe(res);
});

const wss = new WebSocket.Server({
    server
});

const players = new Map();
const queue = [];

const matches = new Map();

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(match, data) {
    if (!match) return;

    send(match.pilot.ws, data);
    send(match.gunner.ws, data);
}

function removeFromQueue(player) {
    const index = queue.indexOf(player);

    if (index !== -1) {
        queue.splice(index, 1);
    }
}

function createPlayer(ws) {
    const player = {
        id: crypto.randomUUID(),
        ws,
        name: "Player",
        role: null,
        match: null,
        x: 0,
        y: 0,
        health: 100,
        alive: true,
        bullets: []
    };

    players.set(player.id, player);

    return player;
}

function endMatch(match, winner, reason) {
    if (!match || match.ended) return;

    match.ended = true;

    broadcast(match, {
        type: "gameOver",
        winner,
        reason: reason || ""
    });

    if (match.interval) {
        clearInterval(match.interval);
        match.interval = null;
    }

    if (match.timeout) {
        clearTimeout(match.timeout);
        match.timeout = null;
    }

    matches.delete(match.id);

    if (match.pilot) {
        match.pilot.match = null;
        match.pilot.role = null;
    }

    if (match.gunner) {
        match.gunner.match = null;
        match.gunner.role = null;
    }
}

function startMatch(player1, player2) {
    const match = {
        id: crypto.randomUUID(),

        pilot: player1,
        gunner: player2,

        started: false,
        ended: false,

        countdown: 3,

        timeLeft: 60,

        pilotX: 100,
        pilotY: 260,

        gunnerX: 700,
        gunnerY: 260,

        tower1: {
            x: 260,
            y: 160,
            width: 100,
            height: 300,
            health: 100
        },

        tower2: {
            x: 540,
            y: 160,
            width: 100,
            height: 300,
            health: 100
        },

        bullets: [],

        interval: null,
        timeout: null
    };

    player1.match = match;
    player2.match = match;

    player1.role = "pilot";
    player2.role = "gunner";

    player1.alive = true;
    player2.alive = true;

    matches.set(match.id, match);

    send(player1.ws, {
        type: "matchFound",
        role: "pilot",
        opponent: player2.name,
        pilotName: player1.name,
        gunnerName: player2.name
    });

    send(player2.ws, {
        type: "matchFound",
        role: "gunner",
        opponent: player1.name,
        pilotName: player1.name,
        gunnerName: player2.name
    });

    setTimeout(() => {
        if (match.ended) return;

        broadcast(match, {
            type: "countdown",
            value: 3
        });

        setTimeout(() => {
            if (match.ended) return;

            broadcast(match, {
                type: "countdown",
                value: 2
            });

            setTimeout(() => {
                if (match.ended) return;

                broadcast(match, {
                    type: "countdown",
                    value: 1
                });

                setTimeout(() => {
                    if (match.ended) return;

                    match.started = true;

                    broadcast(match, {
                        type: "startGame"
                    });

                    startGameLoop(match);
                }, 1000);
            }, 1000);
        }, 1000);
    }, 100);
}

function startGameLoop(match) {
    if (match.interval) {
        clearInterval(match.interval);
    }

    match.interval = setInterval(() => {
        if (match.ended) {
            clearInterval(match.interval);
            return;
        }

        if (!match.started) return;

        match.timeLeft--;

        updateBullets(match);

        broadcastState(match);

        if (match.timeLeft <= 0) {
            endMatch(match, "draw", "Time ran out.");
        }
    }, 1000);
}

function updateBullets(match) {
    for (let i = match.bullets.length - 1; i >= 0; i--) {
        const bullet = match.bullets[i];

        bullet.x += bullet.vx;
        bullet.y += bullet.vy;

        let remove = false;

        if (
            bullet.x < -100 ||
            bullet.x > 1000 ||
            bullet.y < -100 ||
            bullet.y > 700
        ) {
            remove = true;
        }

        if (!remove && bullet.owner === "gunner") {
            const px = match.pilotX;
            const py = match.pilotY;

            const distance = Math.sqrt(
                Math.pow(bullet.x - px, 2) +
                Math.pow(bullet.y - py, 2)
            );

            if (distance < 35) {
                remove = true;

                match.pilot.health -= 20;

                if (match.pilot.health <= 0) {
                    match.pilot.health = 0;
                    match.pilot.alive = false;

                    endMatch(
                        match,
                        "gunner",
                        `${match.gunner.name} shot down ${match.pilot.name}!`
                    );

                    return;
                }
            }
        }

        if (!remove) {
            for (const tower of [match.tower1, match.tower2]) {
                if (
                    bullet.x >= tower.x &&
                    bullet.x <= tower.x + tower.width &&
                    bullet.y >= tower.y &&
                    bullet.y <= tower.y + tower.height
                ) {
                    tower.health -= 10;
                    remove = true;

                    if (tower.health <= 0) {
                        tower.health = 0;

                        const winner =
                            tower === match.tower1
                                ? "pilot"
                                : "pilot";

                        endMatch(
                            match,
                            winner,
                            "A tower was destroyed!"
                        );

                        return;
                    }

                    break;
                }
            }
        }

        if (remove) {
            match.bullets.splice(i, 1);
        }
    }
}

function broadcastState(match) {
    if (!match || match.ended) return;

    const state = {
        type: "gameState",

        timeLeft: match.timeLeft,

        pilot: {
            x: match.pilotX,
            y: match.pilotY,
            health: match.pilot.health,
            alive: match.pilot.alive
        },

        gunner: {
            x: match.gunnerX,
            y: match.gunnerY,
            health: match.gunner.health,
            alive: match.gunner.alive
        },

        tower1: {
            x: match.tower1.x,
            y: match.tower1.y,
            width: match.tower1.width,
            height: match.tower1.height,
            health: match.tower1.health
        },

        tower2: {
            x: match.tower2.x,
            y: match.tower2.y,
            width: match.tower2.width,
            height: match.tower2.height,
            health: match.tower2.health
        },

        bullets: match.bullets.map(bullet => ({
            id: bullet.id,
            x: bullet.x,
            y: bullet.y,
            vx: bullet.vx,
            vy: bullet.vy,
            owner: bullet.owner
        }))
    };

    broadcast(match, state);
}

function tryMatchPlayers() {
    while (queue.length >= 2) {
        const player1 = queue.shift();
        const player2 = queue.shift();

        if (
            !player1 ||
            !player2 ||
            player1.ws.readyState !== WebSocket.OPEN ||
            player2.ws.readyState !== WebSocket.OPEN
        ) {
            continue;
        }

        startMatch(player1, player2);
    }
}

wss.on("connection", ws => {
    const player = createPlayer(ws);

    send(ws, {
        type: "connected",
        id: player.id
    });

    ws.on("message", raw => {
        let data;

        try {
            data = JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (!data || typeof data.type !== "string") {
            return;
        }

        if (data.type === "setName") {
            let name = String(data.name || "").trim();

            if (!name) {
                name = "Player";
            }

            name = name.substring(0, 20);

            player.name = name;

            send(ws, {
                type: "nameSet",
                name: player.name
            });

            return;
        }

        if (data.type === "findMatch") {
            if (player.match) {
                return;
            }

            removeFromQueue(player);

            queue.push(player);

            send(ws, {
                type: "queue",
                position: queue.indexOf(player) + 1,
                playersWaiting: queue.length
            });

            tryMatchPlayers();

            return;
        }

        if (data.type === "cancelQueue") {
            removeFromQueue(player);

            send(ws, {
                type: "queueCancelled"
            });

            return;
        }

        if (data.type === "leaveMatch") {
            if (player.match) {
                const match = player.match;

                const opponent =
                    match.pilot === player
                        ? match.gunner
                        : match.pilot;

                if (opponent) {
                    send(opponent.ws, {
                        type: "opponentLeft"
                    });
                }

                endMatch(
                    match,
                    opponent ? "opponent" : "draw",
                    `${player.name} left the match.`
                );
            }

            return;
        }

        if (data.type === "move") {
            const match = player.match;

            if (!match || !match.started || match.ended) {
                return;
            }

            if (player.role !== "pilot") {
                return;
            }

            const x = Number(data.x);
            const y = Number(data.y);

            if (Number.isFinite(x)) {
                match.pilotX = Math.max(30, Math.min(930, x));
            }

            if (Number.isFinite(y)) {
                match.pilotY = Math.max(50, Math.min(550, y));
            }

            broadcastState(match);

            return;
        }

        if (data.type === "shoot") {
            const match = player.match;

            if (!match || !match.started || match.ended) {
                return;
            }

            if (player.role !== "gunner") {
                return;
            }

            const x = Number(data.x);
            const y = Number(data.y);

            if (
                !Number.isFinite(x) ||
                !Number.isFinite(y)
            ) {
                return;
            }

            const startX = match.gunnerX;
            const startY = match.gunnerY;

            let dx = x - startX;
            let dy = y - startY;

            const length = Math.sqrt(dx * dx + dy * dy);

            if (length < 0.01) {
                dx = -1;
                dy = 0;
            } else {
                dx /= length;
                dy /= length;
            }

            match.bullets.push({
                id: crypto.randomUUID(),

                owner: "gunner",

                x: startX,
                y: startY,

                vx: dx * 12,
                vy: dy * 12
            });

            broadcastState(match);

            return;
        }

        if (data.type === "ping") {
            send(ws, {
                type: "pong"
            });

            return;
        }
    });

    ws.on("close", () => {
        removeFromQueue(player);

        players.delete(player.id);

        if (player.match) {
            const match = player.match;

            const opponent =
                match.pilot === player
                    ? match.gunner
                    : match.pilot;

            if (opponent) {
                send(opponent.ws, {
                    type: "opponentLeft"
                });
            }

            endMatch(
                match,
                opponent ? "opponent" : "draw",
                `${player.name} disconnected.`
            );
        }
    });

    ws.on("error", () => {
        removeFromQueue(player);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Pixel Sky Crash server running on port ${PORT}`);
});
