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

const ROUND_START_DELAY = 3000;
const ROUND_END_DISPLAY_MS = 2200;

/*
==================================================
PLANE BALANCE
==================================================
All planes are viable.

Small:
- Fast
- Agile
- Smaller target

Airliner:
- Balanced

Large:
- Slower
- Bigger target
- More stable

Cargo:
- Slowest
- Biggest target
- Strong maneuver forgiveness

Fighter:
- Fastest
- Very agile
- Small target
- Does NOT have the old ridiculous 10 speed
*/

const planeTypes = {
    small: {
        name: "Small Jet",
        maxSpeed: 6.6,
        acceleration: 2.6,
        braking: 4.0,
        turn: 170,
        climb: 2.6,
        stall: 0.28,
        hitRadius: 38
    },

    airliner: {
        name: "Airliner",
        maxSpeed: 5.7,
        acceleration: 1.9,
        braking: 3.2,
        turn: 120,
        climb: 2.3,
        stall: 0.25,
        hitRadius: 42
    },

    large: {
        name: "Large Airliner",
        maxSpeed: 5.0,
        acceleration: 1.5,
        braking: 3.0,
        turn: 95,
        climb: 2.0,
        stall: 0.23,
        hitRadius: 46
    },

    cargo: {
        name: "Cargo Plane",
        maxSpeed: 4.6,
        acceleration: 1.3,
        braking: 3.6,
        turn: 82,
        climb: 1.9,
        stall: 0.22,
        hitRadius: 50
    },

    fighter: {
        name: "Fighter Jet",
        maxSpeed: 7.8,
        acceleration: 3.2,
        braking: 4.8,
        turn: 205,
        climb: 2.8,
        stall: 0.30,
        hitRadius: 34
    }
};

/*
==================================================
GUN BALANCE
==================================================

MG:
4 damage / 120ms
≈ 33 DPS

Heavy:
9 damage / 270ms
≈ 33 DPS

Rapid:
3 damage / 90ms
≈ 33 DPS
*/

const gunTypes = {
    mg: {
        name: "Machine Gun",
        damage: 4,
        cooldown: 120,
        bulletSpeed: 13
    },

    heavy: {
        name: "Heavy MG",
        damage: 9,
        cooldown: 270,
        bulletSpeed: 13
    },

    rapid: {
        name: "Rapid MG",
        damage: 3,
        cooldown: 90,
        bulletSpeed: 15
    }
};

const players = new Map();
const rooms = new Map();
const queue = [];

/*
==================================================
UTILITIES
==================================================
*/

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
        console.error(
            "WebSocket send error:",
            err.message
        );
    }
}

function broadcast(room, data) {
    if (!room) return;

    send(room.players[0].ws, data);
    send(room.players[1].ws, data);
}

function clamp(value, min, max) {
    return Math.max(
        min,
        Math.min(max, value)
    );
}

function distance(
    x1,
    y1,
    x2,
    y2
) {
    const dx = x1 - x2;
    const dy = y1 - y2;

    return Math.sqrt(
        dx * dx +
        dy * dy
    );
}

/*
==================================================
TOWER COLLISION
==================================================

These match the original visible map positions.
*/

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

/*
==================================================
PLANE / TOWER COLLISION
==================================================
*/

function planeHitsTower(room) {
    const s = room.state;
    const p = s.plane;

    const type =
        planeTypes[s.plane.planeType] ||
        planeTypes.airliner;

    const radiusX =
        type.hitRadius || 42;

    const radiusY =
        Math.max(
            22,
            radiusX * 0.52
        );

    for (let i = 1; i <= 2; i++) {
        const tower = towerRect(i);

        const left =
            tower.x -
            tower.w / 2;

        const right =
            tower.x +
            tower.w / 2;

        const top =
            tower.y -
            tower.h / 2;

        const bottom =
            tower.y +
            tower.h / 2;

        const closestX =
            clamp(
                p.x,
                left,
                right
            );

        const closestY =
            clamp(
                p.y,
                top,
                bottom
            );

        const dx =
            p.x -
            closestX;

        const dy =
            p.y -
            closestY;

        const hit =
            (
                dx * dx
            ) /
            (
                radiusX *
                radiusX
            ) +
            (
                dy * dy
            ) /
            (
                radiusY *
                radiusY
            ) <= 1;

        if (hit) {
            return i;
        }
    }

    return 0;
}

/*
==================================================
PLANE SPAWN
==================================================

Farther left gives the gunner a fair reaction window.
The plane enters from off-screen above the city.
*/

const PLANE_SPAWN = {
    x: -150,
    y: 115,
    speed: 1.8
};

/*
==================================================
PLAYER
==================================================
*/

function createPlayerState(ws) {
    const player = {
        id: randomId(),

        ws,

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

    players.set(
        player.id,
        player
    );

    return player;
}

/*
==================================================
ROOM
==================================================
*/

function createRoom(
    player1,
    player2
) {
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
                x: PLANE_SPAWN.x,

                y: PLANE_SPAWN.y,

                vx: PLANE_SPAWN.speed,

                vy: 0,

                speed: PLANE_SPAWN.speed,

                pitch: 0,

                hp: PLANE_MAX_HP,

                planeType: "airliner",

                lateralVelocity: 0,

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

            towerHitCooldown: 0,

            disabledTower: 0,

            planeDisabled: false,

            winnerName: "",

            reason: ""
        }
    };

    player1.roomId =
        room.id;

    player2.roomId =
        room.id;

    rooms.set(
        room.id,
        room
    );

    return room;
}

/*
==================================================
ROLE HELPERS
==================================================
*/

function getPlayerIndex(
    room,
    player
) {
    if (!room || !player) {
        return -1;
    }

    if (
        room.players[0].id ===
        player.id
    ) {
        return 0;
    }

    if (
        room.players[1].id ===
        player.id
    ) {
        return 1;
    }

    return -1;
}

function getPilot(room) {
    if (!room) {
        return null;
    }

    if (
        room.players[0].id ===
        room.state.pilotId
    ) {
        return room.players[0];
    }

    if (
        room.players[1].id ===
        room.state.pilotId
    ) {
        return room.players[1];
    }

    return null;
}

function getGunner(room) {
    if (!room) {
        return null;
    }

    if (
        room.players[0].id ===
        room.state.gunnerId
    ) {
        return room.players[0];
    }

    if (
        room.players[1].id ===
        room.state.gunnerId
    ) {
        return room.players[1];
    }

    return null;
}

/*
==================================================
PUBLIC STATE
==================================================
*/

function publicState(room) {
    const s =
        room.state;

    return {
        phase:
            s.phase,

        round:
            s.round,

        roundWins: {
            player1:
                s.roundWins.player1,

            player2:
                s.roundWins.player2
        },

        pilotId:
            s.pilotId || null,

        gunnerId:
            s.gunnerId || null,

        pilotName:
            s.pilotName || "",

        gunnerName:
            s.gunnerName || "",

        tower1: {
            hp:
                s.tower1.hp
        },

        tower2: {
            hp:
                s.tower2.hp
        },

        plane: {
            x:
                s.plane.x,

            y:
                s.plane.y,

            vx:
                s.plane.vx,

            vy:
                s.plane.vy,

            speed:
                s.plane.speed,

            pitch:
                s.plane.pitch,

            hp:
                s.plane.hp,

            planeType:
                s.plane.planeType,

            stalled:
                !!s.plane.stalled,

            disabled:
                !!s.planeDisabled
        },

        gunTower:
            s.gunTower,

        aim: {
            x:
                s.aim.x,

            y:
                s.aim.y
        },

        gun:
            s.gun,

        gunnerReady:
            !!s.gunnerReady,

        disabledTower:
            s.disabledTower || 0,

        bullets:
            s.bullets.map(
                function(bullet) {
                    return {
                        id:
                            bullet.id,

                        x:
                            bullet.x,

                        y:
                            bullet.y,

                        vx:
                            bullet.vx,

                        vy:
                            bullet.vy
                    };
                }
            ),

        winnerName:
            s.winnerName || "",

        reason:
            s.reason || ""
    };
}

function sendState(room) {
    broadcast(
        room,
        {
            type: "state",

            state:
                publicState(room)
        }
    );
}

/*
==================================================
INITIAL ROLES
==================================================
*/

function assignInitialRoles(room) {
    if (!room) return;

    const firstPilot =
        Math.random() < 0.5;

    let pilot;
    let gunner;

    if (firstPilot) {
        pilot =
            room.players[0];

        gunner =
            room.players[1];
    } else {
        pilot =
            room.players[1];

        gunner =
            room.players[0];
    }

    room.state.pilotId =
        pilot.id;

    room.state.gunnerId =
        gunner.id;

    room.state.pilotName =
        pilot.name;

    room.state.gunnerName =
        gunner.name;

    room.state.plane.planeType =
        pilot.planeType;

    room.state.gun =
        gunner.gun;

    room.state.gunTower = 1;

    room.state.aim.x = 650;
    room.state.aim.y = 245;

    sendMatchFound(room);
}

/*
==================================================
MATCH FOUND
==================================================
*/

function sendMatchFound(room) {
    if (!room) return;

    const s =
        room.state;

    for (
        const player of
        room.players
    ) {
        send(
            player.ws,
            {
                type:
                    "matchFound",

                roomId:
                    room.id,

                role:
                    player.id ===
                    s.pilotId
                        ? "pilot"
                        : "gunner",

                pilotName:
                    s.pilotName,

                gunnerName:
                    s.gunnerName,

                round:
                    s.round,

                planeType:
                    s.plane.planeType,

                gun:
                    s.gun,

                startsIn:
                    ROUND_START_DELAY
            }
        );
    }
}

/*
==================================================
RESET
==================================================
*/

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

    const s =
        room.state;

    const pilot =
        getPilot(room);

    const gunner =
        getGunner(room);

    s.tower1.hp =
        TOWER_MAX_HP;

    s.tower2.hp =
        TOWER_MAX_HP;

    s.plane = {
        x:
            PLANE_SPAWN.x,

        y:
            PLANE_SPAWN.y,

        vx:
            PLANE_SPAWN.speed,

        vy:
            0,

        speed:
            PLANE_SPAWN.speed,

        pitch:
            0,

        hp:
            PLANE_MAX_HP,

        planeType:
            pilot &&
            planeTypes[
                pilot.planeType
            ]
                ? pilot.planeType
                : "airliner",

        lateralVelocity:
            0,

        stalled:
            false
    };

    s.gunTower = 1;

    s.aim = {
        x: 650,
        y: 245
    };

    s.gun =
        gunner &&
        gunTypes[
            gunner.gun
        ]
            ? gunner.gun
            : "mg";

    s.gunnerReady =
        true;

    s.bullets = [];

    s.towerHitCooldown =
        0;

    s.disabledTower =
        0;

    s.planeDisabled =
        false;

    s.winnerName =
        "";

    s.reason =
        "";

    for (
        const player of
        room.players
    ) {
        resetInput(
            player
        );

        player.lastFire =
            0;
    }
}

function startRound(room) {
    if (!room) return;

    if (!rooms.has(room.id)) {
        return;
    }

    resetRound(room);

    room.state.phase =
        "playing";

    sendState(room);
}

/*
==================================================
ROLE SWITCH
==================================================
*/

function switchRoles(room) {
    if (!room) return;

    const s =
        room.state;

    const oldPilotId =
        s.pilotId;

    if (
        room.players[0].id ===
        oldPilotId
    ) {
        s.pilotId =
            room.players[1].id;

        s.gunnerId =
            room.players[0].id;
    } else {
        s.pilotId =
            room.players[0].id;

        s.gunnerId =
            room.players[1].id;
    }

    const pilot =
        getPilot(room);

    const gunner =
        getGunner(room);

    s.pilotName =
        pilot
            ? pilot.name
            : "";

    s.gunnerName =
        gunner
            ? gunner.name
            : "";

    if (
        pilot &&
        planeTypes[
            pilot.planeType
        ]
    ) {
        s.plane.planeType =
            pilot.planeType;
    }

    if (
        gunner &&
        gunTypes[
            gunner.gun
        ]
    ) {
        s.gun =
            gunner.gun;
    }

    s.gunTower =
        s.gunTower === 1
            ? 2
            : 1;
}

/*
==================================================
ROUND WIN
==================================================
*/

function awardRoundWin(
    room,
    winner
) {
    if (
        !room ||
        !winner
    ) {
        return;
    }

    if (
        room.players[0].id ===
        winner.id
    ) {
        room.state.roundWins.player1++;
    }

    if (
        room.players[1].id ===
        winner.id
    ) {
        room.state.roundWins.player2++;
    }
}

function getWinnerOfMatch(room) {
    if (!room) {
        return null;
    }

    if (
        room.state.roundWins.player1 >=
        3
    ) {
        return room.players[0];
    }

    if (
        room.state.roundWins.player2 >=
        3
    ) {
        return room.players[1];
    }

    return null;
}

/*
==================================================
ROUND FINISH
==================================================
*/

function finishRound(
    room,
    winner,
    reason
) {
    if (!room) return;

    if (
        room.state.phase !==
        "playing"
    ) {
        return;
    }

    const s =
        room.state;

    s.phase =
        "roundEnd";

    s.winnerName =
        winner
            ? winner.name
            : "";

    s.reason =
        reason || "";

    s.planeDisabled =
        true;

    s.plane.vx =
        0;

    s.plane.vy =
        0;

    s.plane.speed =
        0;

    for (
        const player of
        room.players
    ) {
        player.firing =
            false;

        resetInput(
            player
        );
    }

    awardRoundWin(
        room,
        winner
    );

    sendState(room);

    const matchWinner =
        getWinnerOfMatch(room);

    if (matchWinner) {
        setTimeout(
            function() {
                if (
                    !rooms.has(
                        room.id
                    )
                ) {
                    return;
                }

                room.state.phase =
                    "ended";

                room.state.winnerName =
                    matchWinner.name;

                room.state.reason =
                    "Match complete";

                sendState(room);
            },
            ROUND_END_DISPLAY_MS
        );

        return;
    }

    setTimeout(
        function() {
            if (
                !rooms.has(
                    room.id
                )
            ) {
                return;
            }

            room.state.round++;

            switchRoles(
                room
            );

            room.state.phase =
                "waiting";

            resetRound(
                room
            );

            sendMatchFound(
                room
            );

            sendState(
                room
            );

            setTimeout(
                function() {
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
                },
                ROUND_START_DELAY
            );
        },
        ROUND_END_DISPLAY_MS
    );
}

/*
==================================================
PLANE MOVEMENT
==================================================

IMPORTANT FIX:

Old system:
vx = speed + lateralVelocity

That meant pressing A/D changed forward speed.

New system:
forward movement and steering are separate.

A/D = horizontal steering
W/S = vertical movement
Space = braking
*/

function updatePlane(
    room,
    dt
) {
    const s =
        room.state;

    const pilot =
        getPilot(room);

    if (
        !pilot ||
        s.planeDisabled
    ) {
        return;
    }

    const type =
        planeTypes[
            s.plane.planeType
        ] ||
        planeTypes.airliner;

    const input =
        pilot.input;

    const verticalInput =
        (input.down ? 1 : 0) -
        (input.up ? 1 : 0);

    const horizontalInput =
        (input.right ? 1 : 0) -
        (input.left ? 1 : 0);

    /*
    ------------------------------------------
    ENGINE SPEED
    ------------------------------------------
    */

    if (input.brake) {
        s.plane.speed -=
            type.braking *
            1.15 *
            dt;
    } else {
        s.plane.speed +=
            type.acceleration *
            dt;
    }

    s.plane.speed =
        clamp(
            s.plane.speed,
            1.65,
            type.maxSpeed
        );

    /*
    ------------------------------------------
    VERTICAL MOVEMENT
    ------------------------------------------
    */

    const targetVy =
        verticalInput *
        type.climb;

    s.plane.vy +=
        (
            targetVy -
            s.plane.vy
        ) *
        Math.min(
            1,
            dt * 10
        );

    s.plane.vy =
        clamp(
            s.plane.vy,
            -3.2,
            3.2
        );

    /*
    ------------------------------------------
    HORIZONTAL STEERING
    ------------------------------------------
    */

    const maxSide =
        clamp(
            type.turn / 80,
            0.9,
            2.7
        );

    const targetLateral =
        horizontalInput *
        maxSide;

    s.plane.lateralVelocity +=
        (
            targetLateral -
            s.plane.lateralVelocity
        ) *
        Math.min(
            1,
            dt * 14
        );

    s.plane.lateralVelocity =
        clamp(
            s.plane.lateralVelocity,
            -3.0,
            3.0
        );

    /*
    ------------------------------------------
    ACTUAL MOVEMENT
    ------------------------------------------
    */

    const forwardSpeed =
        s.plane.speed *
        60;

    const sideSpeed =
        s.plane.lateralVelocity *
        60;

    const verticalSpeed =
        s.plane.vy *
        60;

    s.plane.vx =
        s.plane.speed +
        s.plane.lateralVelocity;

    s.plane.x +=
        (
            forwardSpeed +
            sideSpeed
        ) *
        dt;

    s.plane.y +=
        verticalSpeed *
        dt;

    /*
    ------------------------------------------
    WORLD BOUNDS
    ------------------------------------------
    */

    if (
        s.plane.y < 60
    ) {
        s.plane.y =
            60;

        s.plane.vy =
            Math.max(
                0,
                s.plane.vy
            );
    }

    if (
        s.plane.y > 430
    ) {
        s.plane.y =
            430;

        s.plane.vy =
            Math.min(
                0,
                s.plane.vy
            );
    }

    /*
    ------------------------------------------
    PITCH
    ------------------------------------------
    */

    const targetPitch =
        s.plane.vy * 8 +
        s.plane.lateralVelocity * 3;

    s.plane.pitch +=
        (
            targetPitch -
            s.plane.pitch
        ) *
        Math.min(
            1,
            dt * 9
        );

    s.plane.pitch =
        clamp(
            s.plane.pitch,
            -35,
            35
        );

    /*
    ------------------------------------------
    STALL
    ------------------------------------------
    */

    s.plane.stalled =
        s.plane.speed <=
        type.maxSpeed *
        type.stall;

    /*
    ------------------------------------------
    WRAP
    ------------------------------------------
    */

    if (
        s.plane.x >
        WORLD_WIDTH + 100
    ) {
        s.plane.x =
            -100;
    }

    if (
        s.plane.x <
        -150
    ) {
        s.plane.x =
            -100;
    }
}

/*
==================================================
BULLET COLLISION
==================================================
*/

function segmentDistanceToPoint(
    x1,
    y1,
    x2,
    y2,
    px,
    py
) {
    const dx =
        x2 - x1;

    const dy =
        y2 - y1;

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

    const t =
        clamp(
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
        x1 +
        dx * t;

    const cy =
        y1 +
        dy * t;

    return distance(
        cx,
        cy,
        px,
        py
    );
}

/*
==================================================
SHOT RESULT
==================================================
*/

function sendShotResult(
    player,
    shotId,
    result,
    damage,
    hp
) {
    if (!player) {
        return;
    }

    send(
        player.ws,
        {
            type:
                "shotResult",

            shotId,

            result,

            damage:
                damage || 0,

            hp:
                hp === undefined
                    ? null
                    : hp
        }
    );
}

/*
==================================================
BULLET UPDATE
==================================================
*/

function updateBullets(
    room,
    dt
) {
    const s =
        room.state;

    for (
        let i =
            s.bullets.length - 1;
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

        bullet.life -=
            dt;

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

        const type =
            planeTypes[
                s.plane.planeType
            ] ||
            planeTypes.airliner;

        const hitRadius =
            Math.max(
                32,
                type.hitRadius ||
                    42
            );

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
            hitDistance <=
                hitRadius &&
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

            broadcast(
                room,
                {
                    type:
                        "impact",

                    x:
                        s.plane.x,

                    y:
                        s.plane.y,

                    damage:
                        bullet.damage,

                    hp:
                        s.plane.hp
                }
            );

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

/*
==================================================
ROOM UPDATE
==================================================
*/

function updateRoom(
    room,
    dt
) {
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

    /*
    ------------------------------------------
    TOWER COLLISION
    ------------------------------------------
    */

    if (
        room.state.towerHitCooldown <=
            0 &&
        !room.state.planeDisabled
    ) {
        const hitTower =
            planeHitsTower(
                room
            );

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

    /*
    ------------------------------------------
    GUNNER
    ------------------------------------------
    */

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

    /*
    ------------------------------------------
    BULLETS
    ------------------------------------------
    */

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

/*
==================================================
FIRE GUN
==================================================
*/

function fireGun(
    room,
    player,
    automatic
) {
    if (
        !room ||
        !player
    ) {
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
        gunTypes[
            player.gun
        ] ||
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

    const towerX =
        room.state.gunTower === 1
            ? 347
            : 652;

    const towerY =
        245;

    let targetX =
        Number(
            room.state.aim.x
        );

    let targetY =
        Number(
            room.state.aim.y
        );

    if (
        !Number.isFinite(
            targetX
        )
    ) {
        targetX =
            towerX + 100;
    }

    if (
        !Number.isFinite(
            targetY
        )
    ) {
        targetY =
            towerY;
    }

    let dx =
        targetX -
        towerX;

    let dy =
        targetY -
        towerY;

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
        id:
            bulletId,

        ownerId:
            player.id,

        x:
            startX,

        y:
            startY,

        vx:
            dx *
            gun.bulletSpeed,

        vy:
            dy *
            gun.bulletSpeed,

        damage:
            gun.damage,

        life:
            2.5
    });

    room.state.gunnerReady =
        false;

    send(
        player.ws,
        {
            type:
                "shotFired",

            shotId:
                bulletId,

            x:
                startX,

            y:
                startY,

            vx:
                dx *
                gun.bulletSpeed,

            vy:
                dy *
                gun.bulletSpeed
        }
    );

    return true;
}

/*
==================================================
QUEUE
==================================================
*/

function removeFromQueue(
    player
) {
    if (!player) {
        return;
    }

    const index =
        queue.indexOf(
            player
        );

    if (
        index !== -1
    ) {
        queue.splice(
            index,
            1
        );
    }
}

function joinQueue(
    player
) {
    if (!player) {
        return;
    }

    removeFromQueue(
        player
    );

    if (
        player.roomId
    ) {
        return;
    }

    if (
        !player.ws ||
        player.ws.readyState !==
            WebSocket.OPEN
    ) {
        return;
    }

    queue.push(
        player
    );

    send(
        player.ws,
        {
            type:
                "queue",

            position:
                queue.length
        }
    );

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
            if (
                !player1.roomId
            ) {
                queue.unshift(
                    player1
                );
            }

            if (
                !player2.roomId
            ) {
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

        setTimeout(
            function() {
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

                startRound(
                    room
                );
            },
            ROUND_START_DELAY
        );
    }
}

/*
==================================================
LEAVE ROOM
==================================================
*/

function leaveRoom(
    player
) {
    if (!player) {
        return;
    }

    if (!player.roomId) {
        return;
    }

    const room =
        rooms.get(
            player.roomId
        );

    if (!room) {
        player.roomId =
            null;

        return;
    }

    const other =
        room.players[0].id ===
        player.id
            ? room.players[1]
            : room.players[0];

    if (other) {
        other.roomId =
            null;

        other.firing =
            false;

        resetInput(
            other
        );

        send(
            other.ws,
            {
                type:
                    "opponentLeft"
            }
        );
    }

    rooms.delete(
        room.id
    );

    player.roomId =
        null;

    player.firing =
        false;

    resetInput(
        player
    );
}

/*
==================================================
NAME
==================================================
*/

function sanitizeName(
    value
) {
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
        name =
            "Player";
    }

    return name;
}

/*
==================================================
MESSAGE HANDLER
==================================================
*/

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

    /*
    ------------------------------------------
    NAME
    ------------------------------------------
    */

    if (
        message.type ===
        "setName"
    ) {
        player.name =
            sanitizeName(
                message.name
            );

        send(
            player.ws,
            {
                type:
                    "nameSet",

                name:
                    player.name
            }
        );

        return;
    }

    /*
    ------------------------------------------
    PLANE SELECTION
    ------------------------------------------
    */

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

    /*
    ------------------------------------------
    GUN SELECTION
    ------------------------------------------
    */

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

    /*
    ------------------------------------------
    QUEUE
    ------------------------------------------
    */

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

    /*
    ------------------------------------------
    CANCEL QUEUE
    ------------------------------------------
    */

    if (
        message.type ===
        "cancelQueue"
    ) {
        removeFromQueue(
            player
        );

        send(
            player.ws,
            {
                type:
                    "left"
            }
        );

        return;
    }

    /*
    ------------------------------------------
    PILOT INPUT
    ------------------------------------------
    */

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

    /*
    ------------------------------------------
    GUNNER AIM
    ------------------------------------------
    */

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

    /*
    ------------------------------------------
    FIRE
    ------------------------------------------
    */

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

    /*
    ------------------------------------------
    STOP FIRE
    ------------------------------------------
    */

    if (
        message.type ===
        "stopFire"
    ) {
        player.firing =
            false;

        return;
    }

    /*
    ------------------------------------------
    REMATCH
    ------------------------------------------
    */

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

        room.state.phase =
            "waiting";

        resetRound(
            room
        );

        assignInitialRoles(
            room
        );

        sendState(
            room
        );

        setTimeout(
            function() {
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
            },
            ROUND_START_DELAY
        );

        return;
    }

    /*
    ------------------------------------------
    LEAVE
    ------------------------------------------
    */

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

        send(
            player.ws,
            {
                type:
                    "left"
            }
        );

        return;
    }
}

/*
==================================================
HTTP SERVER
==================================================
*/

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

/*
==================================================
WEBSOCKET
==================================================
*/

const wss =
    new WebSocket.Server({
        server
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

        send(
            ws,
            {
                type:
                    "connected",

                playerId:
                    player.id
            }
        );

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

/*
==================================================
GAME LOOP
==================================================
*/

setInterval(
    function() {
        const dt =
            TICK_MS / 1000;

        for (
            const room of
            rooms.values()
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

/*
==================================================
START
==================================================
*/

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

        console.log(
            "Balanced plane and gun settings loaded."
        );
    }
);
