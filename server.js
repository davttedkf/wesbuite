
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

const queue = [];
const players = new Map();
const rooms = new Map();

const PLANES = {
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

const server = http.createServer(
    (req, res) => {

        if(
            req.url === "/" ||
            req.url === "/index.html"
        ){

            const file =
                path.join(
                    __dirname,
                    "index.html"
                );

            fs.readFile(
                file,
                (error, data) => {

                    if(error){

                        res.writeHead(
                            500,
                            {
                                "Content-Type":
                                    "text/plain"
                            }
                        );

                        res.end(
                            "Could not load index.html."
                        );

                        return;
                    }

                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                "text/html; charset=utf-8"
                        }
                    );

                    res.end(data);
                }
            );

            return;
        }

        res.writeHead(
            404,
            {
                "Content-Type":
                    "text/plain"
            }
        );

        res.end(
            "Not found."
        );
    }
);

const wss =
    new WebSocket.Server({
        server
    });

function id(){
    return crypto
        .randomBytes(8)
        .toString("hex");
}

function send(
    ws,
    data
){
    if(
        ws &&
        ws.readyState ===
        WebSocket.OPEN
    ){
        ws.send(
            JSON.stringify(data)
        );
    }
}

function broadcast(
    room,
    data
){
    for(
        const player of room.players
    ){
        send(
            player.ws,
            data
        );
    }
}

function cleanName(name){

    if(
        typeof name !==
        "string"
    ){
        return "Player";
    }

    const cleaned =
        name
            .replace(
                /[^\w \-]/g,
                ""
            )
            .trim()
            .slice(0,16);

    return cleaned ||
        "Player";
}

function removeFromQueue(ws){

    const index =
        queue.indexOf(ws);

    if(index !== -1){
        queue.splice(
            index,
            1
        );
    }
}

function getRoom(player){

    if(
        !player ||
        !player.roomId
    ){
        return null;
    }

    return (
        rooms.get(
            player.roomId
        ) || null
    );
}

function makeState(){

    return {
        phase:"waiting",

        towers:[
            {
                hp:TOWER_MAX_HP,
                destroyed:false
            },

            {
                hp:TOWER_MAX_HP,
                destroyed:false
            }
        ],

        plane:{
            x:90,
            y:270,

            vx:0,
            vy:0,

            speed:4,

            pitch:0,

            hp:PLANE_MAX_HP,

            planeType:"airliner"
        },

        aim:{
            x:650,
            y:250
        },

        gunnerTower:1,

        winnerName:null,

        reason:null
    };
}

function makeRoom(
    playerA,
    playerB
){

    const room = {
        id:id(),

        players:[
            playerA,
            playerB
        ],

        state:
            makeState(),

        bullets:[],

        lastTime:
            Date.now(),

        finished:false
    };

    const pilotFirst =
        Math.random() < 0.5;

    if(pilotFirst){

        playerA.role =
            "Pilot";

        playerB.role =
            "Gunner";

    }
    else{

        playerA.role =
            "Gunner";

        playerB.role =
            "Pilot";
    }

    playerA.roomId =
        room.id;

    playerB.roomId =
        room.id;

    rooms.set(
        room.id,
        room
    );

    sendMatchFound(
        playerA,
        playerB
    );

    sendMatchFound(
        playerB,
        playerA
    );

    setTimeout(
        () => {

            if(
                !rooms.has(
                    room.id
                )
            ){
                return;
            }

            if(
                room.finished
            ){
                return;
            }

            room.state.phase =
                "playing";

            room.lastTime =
                Date.now();

            broadcast(
                room,
                {
                    type:"state",
                    state:room.state
                }
            );

        },
        3200
    );

    return room;
}

function sendMatchFound(
    player,
    opponent
){

    send(
        player.ws,
        {
            type:"matchFound",

            you:{
                name:player.name,
                role:player.role
            },

            opponent:{
                name:opponent.name,
                role:opponent.role
            }
        }
    );
}

function tryMatch(){

    while(
        queue.length >= 2
    ){

        const wsA =
            queue.shift();

        const wsB =
            queue.shift();

        if(
            !wsA ||
            !wsB
        ){
            continue;
        }

        if(
            wsA.readyState !==
            WebSocket.OPEN ||
            wsB.readyState !==
            WebSocket.OPEN
        ){
            continue;
        }

        const playerA =
            players.get(wsA);

        const playerB =
            players.get(wsB);

        if(
            !playerA ||
            !playerB
        ){
            continue;
        }

        makeRoom(
            playerA,
            playerB
        );
    }
}

function queuePlayer(
    player
){

    removeFromQueue(
        player.ws
    );

    queue.push(
        player.ws
    );

    send(
        player.ws,
        {
            type:"queued",
            position:queue.length
        }
    );

    tryMatch();
}

function handleInput(
    player,
    message
){

    const room =
        getRoom(player);

    if(!room){
        return;
    }

    if(
        player.role !==
        "Pilot"
    ){
        return;
    }

    const i =
        message.input;

    if(!i){
        return;
    }

    player.input = {
        up:!!i.up,
        down:!!i.down,
        left:!!i.left,
        right:!!i.right,
        brake:!!i.brake
    };
}

function handleAim(
    player,
    message
){

    const room =
        getRoom(player);

    if(!room){
        return;
    }

    if(
        player.role !==
        "Gunner"
    ){
        return;
    }

    let x =
        Number(message.x);

    let y =
        Number(message.y);

    if(
        !Number.isFinite(x) ||
        !Number.isFinite(y)
    ){
        return;
    }

    x =
        Math.max(
            0,
            Math.min(
                WORLD_WIDTH,
                x
            )
        );

    y =
        Math.max(
            0,
            Math.min(
                WORLD_HEIGHT,
                y
            )
        );

    room.state.aim.x =
        x;

    room.state.aim.y =
        y;
}

function handleFire(
    player
){

    const room =
        getRoom(player);

    if(!room){
        return;
    }

    if(
        player.role !==
        "Gunner"
    ){
        return;
    }

    if(
        room.finished
    ){
        return;
    }

    const now =
        Date.now();

    if(
        now -
        (player.lastShot || 0)
        < 110
    ){
        return;
    }

    player.lastShot =
        now;

    const tower =
        room.state.gunnerTower;

    const startX =
        tower === 1
            ? 347
            : 652;

    const startY =
        245;

    const aimX =
        room.state.aim.x;

    const aimY =
        room.state.aim.y;

    const dx =
        aimX -
        startX;

    const dy =
        aimY -
        startY;

    const distance =
        Math.sqrt(
            dx * dx +
            dy * dy
        ) || 1;

    const speed =
        13;

    room.bullets.push({
        x:startX,
        y:startY,

        vx:
            dx /
            distance *
            speed,

        vy:
            dy /
            distance *
            speed,

        life:90
    });
}

function selectPlane(
    player,
    message
){

    const room =
        getRoom(player);

    if(!room){
        return;
    }

    if(
        player.role !==
        "Pilot"
    ){
        return;
    }

    const type =
        message.plane;

    if(
        !PLANES[type]
    ){
        return;
    }

    room.state.plane.planeType =
        type;
}

function updatePlane(
    room,
    dt
){

    const plane =
        room.state.plane;

    const pilot =
        room.players.find(
            player =>
                player.role ===
                "Pilot"
        );

    if(!pilot){
        return;
    }

    const input =
        pilot.input || {};

    const stats =
        PLANES[
            plane.planeType
        ] ||
        PLANES.airliner;

    /*
        OLD STYLE PHYSICS

        The plane automatically
        flies forward even when
        the pilot does nothing.
    */

    if(input.up){

        plane.speed +=
            stats.acceleration *
            dt;

        plane.speed =
            Math.min(
                stats.maxSpeed,
                plane.speed
            );

        plane.vy -=
            stats.climb *
            0.18 *
            dt;
    }

    else if(
        input.down
    ){

        plane.speed -=
            stats.braking *
            dt;

        plane.speed =
            Math.max(
                0,
                plane.speed
            );

        plane.vy +=
            stats.climb *
            0.12 *
            dt;
    }

    else if(
        input.brake
    ){

        plane.speed -=
            stats.braking *
            0.8 *
            dt;

        plane.speed =
            Math.max(
                0,
                plane.speed
            );
    }

    else{

        /*
            Automatic forward
            acceleration.
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

    if(input.left){

        plane.vx -=
            stats.turn *
            0.012 *
            dt;
    }

    if(input.right){

        plane.vx +=
            stats.turn *
            0.012 *
            dt;
    }

    if(input.up){

        plane.vy -=
            stats.climb *
            0.18 *
            dt;
    }

    if(input.down){

        plane.vy +=
            stats.climb *
            0.18 *
            dt;
    }

    plane.vx *=
        Math.pow(
            0.985,
            dt * 60
        );

    plane.vy *=
        Math.pow(
            0.94,
            dt * 60
        );

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
        Move forward.
    */

    plane.x +=
        (
            plane.speed +
            plane.vx
        ) *
        35 *
        dt;

    plane.y +=
        plane.vy *
        35 *
        dt;

    /*
        Keep the plane inside
        the playable world.
    */

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
            85,
            Math.min(
                440,
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
        Stall.
    */

    if(
        plane.speed <
        stats.maxSpeed *
        stats.stall
    ){

        plane.vy +=
            0.18 *
            dt;
    }
}

function towerRect(
    number
){

    if(number === 1){

        return {
            x:347,
            y:465,
            w:175,
            h:330
        };
    }

    return {
        x:652,
        y:465,
        w:175,
        h:330
    };
}

function checkPlaneCollision(
    room
){

    const plane =
        room.state.plane;

    for(
        let i = 1;
        i <= 2;
        i++
    ){

        const tower =
            room.state.towers[
                i - 1
            ];

        if(
            tower.destroyed
        ){
            continue;
        }

        const rect =
            towerRect(i);

        /*
            Plane hitbox.
        */

        const hitX =
            Math.abs(
                plane.x -
                rect.x
            ) <
            rect.w / 2 + 35;

        const hitY =
            Math.abs(
                plane.y -
                rect.y
            ) <
            rect.h / 2;

        if(
            hitX &&
            hitY
        ){

            tower.hp -=
                28;

            tower.hp =
                Math.max(
                    0,
                    tower.hp
                );

            plane.speed *=
                0.65;

            plane.vx *=
                0.35;

            if(
                tower.hp <= 0
            ){

                tower.destroyed =
                    true;

                /*
                    Move gunner to
                    the remaining tower.
                */

                if(
                    room.state.gunnerTower ===
                    i
                ){

                    room.state.gunnerTower =
                        i === 1
                            ? 2
                            : 1;
                }
            }

            /*
                Both towers destroyed.
            */

            if(
                room.state.towers[0]
                    .destroyed &&
                room.state.towers[1]
                    .destroyed
            ){

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

function updateBullets(
    room
){

    const plane =
        room.state.plane;

    for(
        let i =
            room.bullets.length - 1;
        i >= 0;
        i--
    ){

        const bullet =
            room.bullets[i];

        bullet.x +=
            bullet.vx;

        bullet.y +=
            bullet.vy;

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

        if(
            distance < 30
        ){

            plane.hp -=
                5;

            plane.hp =
                Math.max(
                    0,
                    plane.hp
                );

            room.bullets.splice(
                i,
                1
            );

            if(
                plane.hp <= 0
            ){

                finishRoom(
                    room,
                    "Gunner",
                    "The plane was shot down."
                );

                return;
            }

            continue;
        }

        if(
            bullet.life <= 0 ||
            bullet.x < -100 ||
            bullet.x >
                WORLD_WIDTH + 100 ||
            bullet.y < -100 ||
            bullet.y >
                WORLD_HEIGHT + 100
        ){

            room.bullets.splice(
                i,
                1
            );
        }
    }
}

function finishRoom(
    room,
    winningRole,
    reason
){

    if(
        room.finished
    ){
        return;
    }

    room.finished =
        true;

    const winner =
        room.players.find(
            player =>
                player.role ===
                winningRole
        );

    room.state.phase =
        "ended";

    room.state.winnerName =
        winner
            ? winner.name
            : "Player";

    room.state.reason =
        reason;

    broadcast(
        room,
        {
            type:"state",
            state:room.state
        }
    );
}

function leaveRoom(
    player
){

    removeFromQueue(
        player.ws
    );

    if(
        !player.roomId
    ){
        return;
    }

    const room =
        rooms.get(
            player.roomId
        );

    if(!room){

        player.roomId =
            null;

        return;
    }

    const opponent =
        room.players.find(
            other =>
                other !== player
        );

    if(opponent){

        opponent.roomId =
            null;

        send(
            opponent.ws,
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
}

function gameTick(){

    const now =
        Date.now();

    for(
        const room of rooms.values()
    ){

        if(
            room.finished
        ){
            continue;
        }

        if(
            room.state.phase !==
            "playing"
        ){
            continue;
        }

        let dt =
            (
                now -
                room.lastTime
            ) / 1000;

        room.lastTime =
            now;

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

        checkPlaneCollision(
            room
        );

        if(
            room.finished
        ){
            continue;
        }

        updateBullets(
            room
        );

        if(
            room.finished
        ){
            continue;
        }

        broadcast(
            room,
            {
                type:"state",
                state:room.state
            }
        );
    }
}

wss.on(
    "connection",
    ws => {

        const player = {

            ws,

            id:id(),

            name:"Player",

            role:null,

            roomId:null,

            input:{
                up:false,
                down:false,
                left:false,
                right:false,
                brake:false
            },

            lastShot:0
        };

        players.set(
            ws,
            player
        );

        send(
            ws,
            {
                type:"connected"
            }
        );

        ws.on(
            "message",
            raw => {

                let message;

                try{

                    message =
                        JSON.parse(
                            raw.toString()
                        );
                }
                catch{

                    return;
                }

                if(
                    !message ||
                    typeof message.type !==
                    "string"
                ){
                    return;
                }

                switch(
                    message.type
                ){

                    case "queue":

                        if(
                            player.roomId
                        ){
                            return;
                        }

                        player.name =
                            cleanName(
                                message.name
                            );

                        queuePlayer(
                            player
                        );

                        break;

                    case "cancelQueue":

                        removeFromQueue(
                            ws
                        );

                        break;

                    case "input":

                        handleInput(
                            player,
                            message
                        );

                        break;

                    case "aim":

                        handleAim(
                            player,
                            message
                        );

                        break;

                    case "fire":

                        handleFire(
                            player
                        );

                        break;

                    case "selectPlane":

                        selectPlane(
                            player,
                            message
                        );

                        break;

                    case "leaveRoom":

                        leaveRoom(
                            player
                        );

                        break;
                }
            }
        );

        ws.on(
            "close",
            () => {

                removeFromQueue(
                    ws
                );

                leaveRoom(
                    player
                );

                players.delete(
                    ws
                );
            }
        );
    }
);

setInterval(
    gameTick,
    1000 / TICK_RATE
);

server.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            "=============================="
        );
        console.log(
            "   PIXEL SKY CRASH SERVER"
        );
        console.log(
            "=============================="
        );
        console.log(
            `Running on port ${PORT}`
        );
        console.log(
            `http://localhost:${PORT}`
        );
        console.log("");
    }
);

