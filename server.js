const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// ─── Tile Factory ───────────────────────────────────────────────────────────
function createTiles() {
  const tiles = [];
  let id = 0;
  const suits = [
    { suit: 'man', values: [1,2,3,4,5,6,7,8,9] },
    { suit: 'pin', values: [1,2,3,4,5,6,7,8,9] },
    { suit: 'sou', values: [1,2,3,4,5,6,7,8,9] },
  ];
  suits.forEach(({ suit, values }) => {
    values.forEach(value => {
      for (let c = 0; c < 4; c++) tiles.push({ id: id++, suit, value });
    });
  });
  ['East','South','West','North'].forEach(wind => {
    for (let c = 0; c < 4; c++) tiles.push({ id: id++, suit: 'wind', value: wind });
  });
  ['Red','Green','White'].forEach(dragon => {
    for (let c = 0; c < 4; c++) tiles.push({ id: id++, suit: 'dragon', value: dragon });
  });
  for (let n = 1; n <= 8; n++) tiles.push({ id: id++, suit: 'flower', value: n });
  return tiles;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function tileKey(t) { return `${t.suit}|${t.value}`; }

// ─── Win Detection ──────────────────────────────────────────────────────────
function canFormMelds(tiles) {
  if (tiles.length === 0) return true;
  const sorted = [...tiles].sort((a, b) => {
    if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
    return String(a.value).localeCompare(String(b.value), undefined, { numeric: true });
  });
  const first = sorted[0];
  const key = tileKey(first);

  // Try pong (3 of same)
  const sameCount = sorted.filter(t => tileKey(t) === key).length;
  if (sameCount >= 3) {
    let removed = 0;
    const rest = sorted.filter(t => {
      if (removed < 3 && tileKey(t) === key) { removed++; return false; }
      return true;
    });
    if (canFormMelds(rest)) return true;
  }

  // Try chow (sequence, numeric suits only)
  if (['man','pin','sou'].includes(first.suit) && first.value <= 7) {
    const v = first.value;
    const s = first.suit;
    const t2 = sorted.find(t => t.suit === s && t.value === v + 1);
    const t3 = sorted.find(t => t.suit === s && t.value === v + 2);
    if (t2 && t3) {
      const usedIds = new Set([first.id, t2.id, t3.id]);
      const rest = sorted.filter(t => !usedIds.has(t.id));
      if (canFormMelds(rest)) return true;
    }
  }

  return false;
}

function isWinningHand(tiles) {
  const playable = tiles.filter(t => t.suit !== 'flower');
  if (playable.length !== 14) return false;

  // Seven pairs
  const counts = {};
  playable.forEach(t => { const k = tileKey(t); counts[k] = (counts[k] || 0) + 1; });
  const pairs = Object.values(counts).filter(c => c >= 2).length;
  if (pairs === 7 && Object.keys(counts).length === 7) return true;

  // Standard 4 melds + 1 pair
  const tried = new Set();
  for (let i = 0; i < playable.length; i++) {
    const k = tileKey(playable[i]);
    if (tried.has(k)) continue;
    tried.add(k);
    const pairIdxs = playable.reduce((a, t, idx) => { if (tileKey(t) === k) a.push(idx); return a; }, []);
    if (pairIdxs.length >= 2) {
      const rest = playable.filter((_, idx) => idx !== pairIdxs[0] && idx !== pairIdxs[1]);
      if (canFormMelds(rest)) return true;
    }
  }
  return false;
}

// ─── Room & Game State ──────────────────────────────────────────────────────
function genCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function newGame(roomCode) {
  return {
    roomCode,
    players: [],
    wall: [],
    phase: 'lobby',
    currentPlayerIndex: 0,
    dealerIndex: 0,
    round: 1,
    lastDiscard: null,
    lastDiscardPlayerIdx: null,
    discardHistory: [],
    claimTimer: null,
    pot: 0,
    log: [],
    chat: [],
  };
}

function logMsg(game, msg) {
  game.log.unshift({ msg, t: new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
  if (game.log.length > 60) game.log.pop();
}

function broadcast(game) {
  game.players.forEach(p => {
    const sock = io.sockets.sockets.get(p.socketId);
    if (!sock) return;
    sock.emit('state', sanitize(game, p.socketId));
  });
}

function sanitize(game, forId) {
  return {
    roomCode: game.roomCode,
    phase: game.phase,
    round: game.round,
    pot: game.pot,
    wallCount: game.wall.length,
    currentPlayerIndex: game.currentPlayerIndex,
    dealerIndex: game.dealerIndex,
    lastDiscard: game.lastDiscard,
    lastDiscardPlayerIdx: game.lastDiscardPlayerIdx,
    discardHistory: game.discardHistory.slice(-30),
    log: game.log,
    chat: game.chat,
    players: game.players.map(p => ({
      socketId: p.socketId,
      username: p.username,
      balance: p.balance,
      seatWind: p.seatWind,
      isDealer: p.isDealer,
      handCount: p.hand.length,
      melds: p.melds,
      flowers: p.flowers,
      hand: p.socketId === forId ? p.hand : null,
    })),
  };
}

function startRound(game) {
  const ANTE = 1.00;
  game.pot = 0;
  game.players.forEach(p => {
    const contrib = Math.min(ANTE, p.balance);
    p.balance = +(p.balance - contrib).toFixed(2);
    game.pot = +(game.pot + contrib).toFixed(2);
    p.hand = [];
    p.melds = [];
    p.flowers = [];
  });

  game.wall = shuffle(createTiles());
  game.discardHistory = [];
  game.lastDiscard = null;
  game.lastDiscardPlayerIdx = null;
  game.phase = 'playing';

  // Deal 13 each
  for (let i = 0; i < 13; i++) {
    game.players.forEach(p => deal(game, p));
  }
  // Dealer gets 14th
  deal(game, game.players[game.dealerIndex]);
  game.currentPlayerIndex = game.dealerIndex;

  // Handle flowers immediately after dealing
  game.players.forEach(p => extractFlowers(game, p));

  logMsg(game, `🀄 Round ${game.round} started — ${game.players[game.dealerIndex].username} deals (East Wind) · Pot: $${game.pot.toFixed(2)}`);
  broadcast(game);
}

function deal(game, player) {
  const tile = game.wall.shift();
  if (tile) player.hand.push(tile);
  return tile;
}

function extractFlowers(game, player) {
  const flowers = player.hand.filter(t => t.suit === 'flower');
  player.flowers.push(...flowers);
  player.hand = player.hand.filter(t => t.suit !== 'flower');
  flowers.forEach(() => {
    const replacement = game.wall.pop(); // draw from back of wall
    if (replacement && replacement.suit !== 'flower') player.hand.push(replacement);
    else if (replacement) { player.flowers.push(replacement); }
  });
}

function nextTurn(game) {
  if (game.claimTimer) { clearTimeout(game.claimTimer); game.claimTimer = null; }
  game.phase = 'playing';
  game.lastDiscard = null;
  game.lastDiscardPlayerIdx = null;
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;

  if (game.wall.length === 0) {
    endRound(game, null);
    return;
  }

  const curr = game.players[game.currentPlayerIndex];
  const tile = deal(game, curr);
  extractFlowers(game, curr);

  logMsg(game, `${curr.username}'s turn.`);
  broadcast(game);

  const sock = io.sockets.sockets.get(curr.socketId);
  if (sock && tile) sock.emit('drew', { tile });
}

function endRound(game, result) {
  if (game.claimTimer) { clearTimeout(game.claimTimer); game.claimTimer = null; }
  game.phase = 'round_end';

  if (!result) {
    // Draw — split pot
    const share = +(game.pot / game.players.length).toFixed(2);
    game.players.forEach(p => { p.balance = +(p.balance + share).toFixed(2); });
    logMsg(game, `🤝 Draw! Wall exhausted. Pot returned ($${share.toFixed(2)} each).`);
  } else {
    const winner = game.players[result.winnerIdx];
    winner.balance = +(winner.balance + game.pot).toFixed(2);
    const howMsg = result.winType === 'self-draw'
      ? '🀄 Self-draw (自摸)!'
      : `🀄 Win on ${game.players[result.discarderIdx].username}'s discard!`;
    logMsg(game, `${winner.username} wins! ${howMsg} +$${game.pot.toFixed(2)}`);
  }

  game.round++;
  game.dealerIndex = (game.dealerIndex + 1) % game.players.length;
  const winds = ['East','South','West','North'];
  game.players.forEach((p, i) => {
    p.isDealer = i === game.dealerIndex;
    p.seatWind = winds[(i - game.dealerIndex + game.players.length) % game.players.length] || 'East';
  });

  broadcast(game);

  setTimeout(() => {
    if (game.players.length >= 2 && game.phase === 'round_end') startRound(game);
  }, 7000);
}

// ─── Socket Handlers ─────────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('create', ({ username }) => {
    const code = genCode();
    const game = newGame(code);
    rooms[code] = game;
    const winds = ['East','South','West','North'];
    game.players.push({ socketId: socket.id, username, hand: [], melds: [], flowers: [], balance: 10.00, isDealer: true, seatWind: winds[0] });
    socket.join(code);
    socket.data.room = code;
    logMsg(game, `${username} created the room.`);
    socket.emit('created', { code });
    broadcast(game);
  });

  socket.on('join', ({ username, code }) => {
    const game = rooms[code];
    if (!game) return socket.emit('err', 'Room not found.');
    if (game.phase !== 'lobby') return socket.emit('err', 'Game in progress.');
    if (game.players.length >= 4) return socket.emit('err', 'Room full (max 4).');
    const winds = ['East','South','West','North'];
    game.players.push({ socketId: socket.id, username, hand: [], melds: [], flowers: [], balance: 10.00, isDealer: false, seatWind: winds[game.players.length] });
    socket.join(code);
    socket.data.room = code;
    logMsg(game, `${username} joined.`);
    socket.emit('joined', { code });
    broadcast(game);
  });

  socket.on('start', () => {
    const game = rooms[socket.data.room];
    if (!game) return;
    const p = game.players.find(p => p.socketId === socket.id);
    if (!p || !p.isDealer) return socket.emit('err', 'Only the host can start.');
    if (game.players.length < 2) return socket.emit('err', 'Need at least 2 players.');
    startRound(game);
  });

  socket.on('discard', ({ tileId }) => {
    const game = rooms[socket.data.room];
    if (!game || game.phase !== 'playing') return;
    const pIdx = game.players.findIndex(p => p.socketId === socket.id);
    if (pIdx !== game.currentPlayerIndex) return socket.emit('err', 'Not your turn.');
    const p = game.players[pIdx];
    const tIdx = p.hand.findIndex(t => t.id === tileId);
    if (tIdx === -1) return;

    const [tile] = p.hand.splice(tIdx, 1);
    game.lastDiscard = tile;
    game.lastDiscardPlayerIdx = pIdx;
    game.discardHistory.push({ tile, pIdx, username: p.username });
    game.phase = 'claiming';

    logMsg(game, `${p.username} discarded.`);
    broadcast(game);

    game.claimTimer = setTimeout(() => {
      if (game.phase === 'claiming') nextTurn(game);
    }, 9000);
  });

  socket.on('mahjong', () => {
    const game = rooms[socket.data.room];
    if (!game) return;
    const pIdx = game.players.findIndex(p => p.socketId === socket.id);
    const p = game.players[pIdx];

    if (game.phase === 'playing' && pIdx === game.currentPlayerIndex) {
      // Self-draw
      if (isWinningHand(p.hand)) {
        endRound(game, { winnerIdx: pIdx, winType: 'self-draw' });
      } else {
        socket.emit('err', 'Not a winning hand yet.');
      }
    } else if (game.phase === 'claiming' && pIdx !== game.lastDiscardPlayerIdx) {
      // Win on discard
      const testHand = [...p.hand, game.lastDiscard];
      if (isWinningHand(testHand)) {
        if (game.claimTimer) clearTimeout(game.claimTimer);
        p.hand.push(game.lastDiscard);
        endRound(game, { winnerIdx: pIdx, winType: 'discard', discarderIdx: game.lastDiscardPlayerIdx });
      } else {
        socket.emit('err', 'Not a winning hand.');
      }
    }
  });

  socket.on('pong', () => {
    const game = rooms[socket.data.room];
    if (!game || game.phase !== 'claiming' || !game.lastDiscard) return;
    const pIdx = game.players.findIndex(p => p.socketId === socket.id);
    if (pIdx === game.lastDiscardPlayerIdx) return;
    const p = game.players[pIdx];
    const matching = p.hand.filter(t => tileKey(t) === tileKey(game.lastDiscard));
    if (matching.length < 2) return socket.emit('err', 'Need 2 matching tiles to Pong.');
    if (game.claimTimer) clearTimeout(game.claimTimer);
    let rem = 2;
    p.hand = p.hand.filter(t => {
      if (rem > 0 && tileKey(t) === tileKey(game.lastDiscard)) { rem--; return false; }
      return true;
    });
    p.melds.push({ type: 'pong', tiles: [matching[0], matching[1], game.lastDiscard], open: true });
    logMsg(game, `${p.username} Ponged! 碰`);
    game.lastDiscard = null;
    game.currentPlayerIndex = pIdx;
    game.phase = 'playing';
    broadcast(game);
  });

  socket.on('chow', ({ tileIds }) => {
    const game = rooms[socket.data.room];
    if (!game || game.phase !== 'claiming' || !game.lastDiscard) return;
    const pIdx = game.players.findIndex(p => p.socketId === socket.id);
    const leftOfDiscarder = (game.lastDiscardPlayerIdx + 1) % game.players.length;
    if (pIdx !== leftOfDiscarder) return socket.emit('err', 'Chow only from player to your right.');
    const p = game.players[pIdx];
    const handTiles = tileIds.map(id => p.hand.find(t => t.id === id)).filter(Boolean);
    if (handTiles.length !== 2) return socket.emit('err', 'Select 2 tiles from hand.');
    const all3 = [...handTiles, game.lastDiscard].sort((a, b) => a.value - b.value);
    const sameSuit = all3.every(t => t.suit === all3[0].suit) && ['man','pin','sou'].includes(all3[0].suit);
    const isSeq = sameSuit && all3[1].value === all3[0].value + 1 && all3[2].value === all3[1].value + 1;
    if (!isSeq) return socket.emit('err', 'Tiles must form a consecutive sequence (same suit).');
    if (game.claimTimer) clearTimeout(game.claimTimer);
    const usedIds = new Set(handTiles.map(t => t.id));
    p.hand = p.hand.filter(t => !usedIds.has(t.id));
    p.melds.push({ type: 'chow', tiles: all3, open: true });
    logMsg(game, `${p.username} Chowed! 吃`);
    game.lastDiscard = null;
    game.currentPlayerIndex = pIdx;
    game.phase = 'playing';
    broadcast(game);
  });

  socket.on('kong', ({ tileId }) => {
    const game = rooms[socket.data.room];
    if (!game) return;
    const pIdx = game.players.findIndex(p => p.socketId === socket.id);
    const p = game.players[pIdx];

    // Declared kong from hand (4 of same in own hand)
    const tile = p.hand.find(t => t.id === tileId);
    if (!tile) return;
    const matching = p.hand.filter(t => tileKey(t) === tileKey(tile));
    if (matching.length < 4) return socket.emit('err', 'Need 4 of the same tile for Kong.');
    if (game.claimTimer) clearTimeout(game.claimTimer);
    const usedIds = new Set(matching.slice(0,4).map(t => t.id));
    p.hand = p.hand.filter(t => !usedIds.has(t.id));
    p.melds.push({ type: 'kong', tiles: matching.slice(0,4), open: false });
    // Draw replacement
    if (game.wall.length > 0) {
      const replacement = game.wall.pop();
      if (replacement) p.hand.push(replacement);
    }
    logMsg(game, `${p.username} declared Kong! 槓`);
    game.phase = 'playing';
    game.currentPlayerIndex = pIdx;
    broadcast(game);
  });

  socket.on('pass', () => {
    // Player passes on claim — no action needed, timer handles it
  });

  socket.on('chat', ({ msg }) => {
    const game = rooms[socket.data.room];
    if (!game) return;
    const p = game.players.find(p => p.socketId === socket.id);
    if (!p) return;
    const entry = { username: p.username, msg: String(msg).substring(0, 200), t: new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) };
    game.chat.push(entry);
    if (game.chat.length > 100) game.chat.shift();
    io.to(game.roomCode).emit('chatMsg', entry);
  });

  socket.on('disconnect', () => {
    const game = rooms[socket.data.room];
    if (!game) return;
    const p = game.players.find(p => p.socketId === socket.id);
    if (p) { logMsg(game, `${p.username} disconnected.`); broadcast(game); }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🀄 Mahjong server on port ${PORT}`));
