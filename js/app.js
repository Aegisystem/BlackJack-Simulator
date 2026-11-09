import { ACTIONS, bestAction, cardValue, handValue, isBlackjack, isPair } from './strategy.js';
import * as sfx from './sound.js';

/* ───────────────────────── Configuración y estado ───────────────────────── */

const SEATS = 7;
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
// Valores de ficha de casino. En la mesa se muestran 5 seguidos, empezando por la apuesta mínima.
const LADDER = [1, 5, 25, 100, 500, 1000, 5000, 25000, 100000, 500000, 1000000];
function chipSet() {
  let i = 0;
  LADDER.forEach((v, k) => {
    if (v <= state.settings.minBet) i = k;
  });
  i = Math.min(i, LADDER.length - 5);
  return LADDER.slice(i, i + 5);
}

/** La ficha marcada; si ya no está entre las de la mesa, se marca la más baja. */
function activeChip() {
  const set = chipSet();
  if (!set.includes(state.chip)) state.chip = set[0];
  return state.chip;
}
const COLORS = ['#e8b04b', '#5fb3e8', '#ef7a62', '#8fd17a', '#c48be8', '#ec8fc2', '#6fdccd', '#e6dc7a'];
const STORE = 'bj-entrenador-v1';
const LOG_MAX = 300;
// Versión de los datos guardados; al subirla, load() migra lo que guardaron versiones anteriores.
const DATA_VERSION = 2;
// Cuánto sube cada puesto para seguir la curva de la mesa (el puesto 4 es el centro).
const SEAT_LIFT = [0.58, 0.24, 0.07, 0, 0.07, 0.24, 0.58];

const DEFAULT_SETTINGS = {
  decks: 6,
  h17: false,
  das: true,
  surrender: true,
  maxHands: 5,
  resplitAces: true,
  hitSplitAces: false,
  bjPays: 1.5,
  minBet: 5,
  maxBet: 5000,
  penetration: 0, // 0 = corte aleatorio entre el 45% y el 55% del zapato
  showHint: false,
  feedback: true,
  showCount: false,
  speed: 1, // 0 rápido · 1 normal · 2 lento
  peek: 'us', // 'us': el crupier revisa si tiene Blackjack con As o figura · 'ace': solo con As
  noPeekLoss: 'all', // si no revisó y tiene Blackjack: 'all' se pierde todo · 'original' solo la apuesta inicial
  decisionTime: 0, // segundos para decidir; 0 = sin límite
  sound: true,
  volume: 0.7,
  feedbackSound: true,
  voice: false,
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  players: [],
  seats: Array.from({ length: SEATS }, () => ({ playerId: null, bet: 0, lastBet: 0, hands: [] })),
  shoe: [],
  shoeSize: 0,
  cutAt: 0,
  runningCount: 0,
  needShuffle: true,
  dealer: { cards: [], hidden: true },
  phase: 'betting', // betting · dealing · playing · dealer
  selectedSeat: null,
  turn: null, // { si, hi }
  pending: null, // decisión humana en espera
  feedback: null,
  hintShown: false,
  log: [],
  notice: '', // error de apuesta, se muestra en la barra inferior
  event: null, // aviso breve sobre la mesa { text, until }
  summary: null, // resultado de la última ronda
  chip: null, // ficha marcada: tocar un círculo propio pone una de este valor
};

let uidN = 0;
const uid = (p = 'id') => `${p}${Date.now().toString(36)}${(uidN++).toString(36)}`;

function defaultPlayers() {
  return [newPlayer('Jugador 1', false, 0), newPlayer('Bot Ana', true, 1), newPlayer('Bot Leo', true, 2)];
}

function newPlayer(name, isBot, colorIdx, bankroll = 1000) {
  return {
    id: uid('p'),
    name,
    isBot,
    color: COLORS[colorIdx % COLORS.length],
    bankroll,
    startBankroll: bankroll,
    rebuys: 0,
    stats: { decisions: 0, correct: 0, hands: 0 },
  };
}

function save() {
  try {
    localStorage.setItem(
      STORE,
      JSON.stringify({
        settings: state.settings,
        players: state.players,
        seats: state.seats.map((s) => ({ playerId: s.playerId, bet: s.bet })),
        log: state.log,
        version: DATA_VERSION,
      }),
    );
  } catch {
    /* almacenamiento no disponible */
  }
}

function load() {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    data = null;
  }
  if (data && Array.isArray(data.players) && data.players.length) {
    state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    // Hasta la versión 2 la apuesta mínima por defecto era 10; ahora es 5.
    if ((data.version || 1) < 2 && state.settings.minBet === 10) state.settings.minBet = 5;
    state.players = data.players.map((p) => ({ rebuys: 0, ...p, stats: { decisions: 0, correct: 0, hands: 0, ...p.stats } }));
    if (Array.isArray(data.log)) state.log = data.log.slice(0, LOG_MAX);
    (data.seats || []).forEach((s, i) => {
      if (i < SEATS && state.players.some((p) => p.id === s.playerId)) {
        state.seats[i].playerId = s.playerId;
        state.seats[i].bet = s.bet || 0;
      }
    });
  } else {
    state.players = defaultPlayers();
    const [me, ana, leo] = state.players;
    state.seats[0].playerId = ana.id;
    state.seats[3].playerId = me.id;
    state.seats[3].bet = 25;
    state.seats[5].playerId = leo.id;
  }
  pickSelectedSeat();
  botBets(false);
}

const getPlayer = (id) => state.players.find((p) => p.id === id);
const isHumanSeat = (seat) => {
  const p = seat && seat.playerId && getPlayer(seat.playerId);
  return !!p && !p.isBot;
};
const S = () => state.settings;

// Perfiles de mesa con reglas conocidas.
const PROFILES = {
  // Pragmatic Play Live Blackjack: 8 mazos, S17, una sola división, sin pedir con Ases divididos,
  // doblar tras dividir (salvo Ases), sin rendición; el crupier solo revisa su carta con un As.
  pragmatic: { decks: 8, h17: false, das: true, surrender: false, maxHands: 2, resplitAces: false, hitSplitAces: false, bjPays: 1.5, peek: 'ace', noPeekLoss: 'all', decisionTime: 15 },
  usa: { decks: 6, h17: false, das: true, surrender: true, maxHands: 4, resplitAces: true, hitSplitAces: false, bjPays: 1.5, peek: 'us', noPeekLoss: 'all', decisionTime: 0 },
};

/** El crupier no revisó si tiene Blackjack con esta carta y, si lo tiene, se lleva también lo doblado y dividido. */
const noPeekFor = (up) => S().peek === 'ace' && S().noPeekLoss === 'all' && cardValue(up) === 10;
// Posición estéreo de cada puesto: el puesto 1 queda a la derecha y el 7 a la izquierda.
const panFor = (si) => ((3 - si) / 3) * 0.55;
const applySound = () => sfx.configure({ enabled: S().sound, volume: S().volume, voice: S().voice });
const delay = (base) => base * [0.35, 1, 1.8][S().speed ?? 1];
const wait = (ms) => new Promise((r) => setTimeout(r, delay(ms)));

function pickSelectedSeat() {
  if (isHumanSeat(state.seats[state.selectedSeat])) return;
  const i = state.seats.findIndex((s) => isHumanSeat(s));
  state.selectedSeat = i >= 0 ? i : null;
}

const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const fmt = (n) => money.format(n).replace('US', '');
const signed = (n) => (n === 0 ? fmt(0) : `${n > 0 ? '+' : '−'}${fmt(Math.abs(n))}`);
const shortMoney = (n) => {
  const s = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace('.', ','));
  if (n >= 1e6) return `${s(n / 1e6)}M`;
  return n >= 1000 ? `${s(n / 1000)}k` : s(n);
};

/* ───────────────────────── Zapato y cuenta Hi-Lo ───────────────────────── */

function randomUnit() {
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return r[0] / 2 ** 32;
}

function buildShoe() {
  const cards = [];
  for (let d = 0; d < S().decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push({ rank, suit, id: uid('c') });
  }
  const rand = new Uint32Array(cards.length);
  crypto.getRandomValues(rand);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  state.shoe = cards;
  state.shoeSize = cards.length;
  // Corte aleatorio: en cada barajada la carta de corte cae entre el 45% y el 55% del zapato.
  const pen = S().penetration || 0.45 + randomUnit() * 0.1;
  state.cutAt = Math.round(cards.length * (1 - pen));
  state.runningCount = 0;
  state.needShuffle = false;
}

function countCard(c) {
  const v = cardValue(c);
  if (v <= 6) state.runningCount++;
  else if (v >= 10) state.runningCount--;
}

function draw(faceUp = true, pan = 0) {
  if (!state.shoe.length) buildShoe();
  const c = state.shoe.pop();
  c.at = performance.now();
  if (faceUp) countCard(c);
  sfx.card(pan);
  return c;
}

const decksLeft = () => Math.max(state.shoe.length / 52, 0.25);
const trueCount = () => state.runningCount / decksLeft();

/* ───────────────────────── Reglas de cada mano ───────────────────────── */

function optionsFor(seat, hand, player) {
  const two = hand.cards.length === 2;
  const afford = player.bankroll >= hand.bet;
  const acesLocked = hand.splitAces && !S().hitSplitAces;
  return {
    canHit: !acesLocked,
    canDouble: two && afford && !acesLocked && (!hand.fromSplit || S().das),
    canSplit: two && isPair(hand.cards) && afford && seat.hands.length < S().maxHands && (!hand.splitAces || S().resplitAces),
    canSurrender: two && S().surrender && !hand.fromSplit && seat.hands.length === 1,
    h17: S().h17,
    das: S().das,
    noPeek: noPeekFor(state.dealer.cards[0]),
  };
}

function isLegal(act, o) {
  return { H: o.canHit, S: true, D: o.canDouble, P: o.canSplit, R: o.canSurrender }[act];
}

function recommend(hand, o) {
  const rec = bestAction(hand.cards, state.dealer.cards[0], o);
  if (!o.canHit && rec.action === 'H') {
    return { action: 'S', ideal: rec.ideal, reason: 'Con Ases divididos solo recibes una carta; te plantas.' };
  }
  return rec;
}

/* ───────────────────────── Flujo de la ronda ───────────────────────── */

function committedBy(playerId) {
  return state.seats.filter((s) => s.playerId === playerId).reduce((a, s) => a + s.bet, 0);
}

/** Los bots eligen su apuesta al empezar las apuestas, para que se vea en la mesa. */
function botBets(fresh) {
  for (const seat of state.seats) {
    const p = seat.playerId && getPlayer(seat.playerId);
    if (!p || !p.isBot) continue;
    const others = committedBy(p.id) - seat.bet;
    const valid = seat.bet >= S().minBet && seat.bet <= S().maxBet && seat.bet <= p.bankroll - others;
    if (!fresh && valid) continue;
    if (p.bankroll - others < S().minBet) {
      p.bankroll += p.startBankroll || 1000;
      p.rebuys = (p.rebuys || 0) + 1;
    }
    const units = [1, 1, 2, 2, 3, 5][Math.floor(randomUnit() * 6)];
    seat.bet = Math.max(0, Math.min(S().minBet * units, S().maxBet, p.bankroll - others));
    if (seat.bet < S().minBet) seat.bet = 0;
  }
}

function canDeal() {
  return state.seats.some((s) => s.playerId && s.bet >= S().minBet);
}

async function deal() {
  if (state.phase !== 'betting') return;
  botBets(false);
  if (!canDeal()) return notice(`Pon al menos ${fmt(S().minBet)} en un puesto para repartir.`);
  for (const p of state.players) {
    if (committedBy(p.id) > p.bankroll + 1e-9) return notice(`${p.name} no tiene saldo para cubrir sus apuestas.`);
  }
  if (state.seats.some((s) => s.playerId && s.bet > 0 && s.bet < S().minBet)) {
    return notice(`La apuesta mínima es ${fmt(S().minBet)}.`);
  }

  state.notice = '';
  state.summary = null;
  state.phase = 'dealing';
  await sweepTable();
  const shuffling = state.needShuffle || !state.shoe.length;
  if (shuffling) {
    buildShoe();
    tableEvent('Barajando un zapato nuevo', 4000);
  }

  state.phase = 'dealing';
  state.hintShown = false;
  state.dealer = { cards: [], hidden: true };
  for (const seat of state.seats) {
    seat.hands = [];
    if (seat.playerId && seat.bet >= S().minBet) {
      const p = getPlayer(seat.playerId);
      p.bankroll -= seat.bet;
      p.stats.hands++;
      seat.lastBet = seat.bet;
      seat.hands = [{ cards: [], bet: seat.bet }];
    }
  }
  render();
  if (shuffling) {
    // Se espera a que termine el sonido de la barajada antes de repartir.
    const secs = sfx.shuffle();
    await new Promise((r) => setTimeout(r, secs ? secs * 1000 : delay(700)));
  }

  for (let round = 0; round < 2; round++) {
    for (let si = 0; si < SEATS; si++) {
      const seat = state.seats[si];
      if (!seat.hands.length) continue;
      await wait(240);
      seat.hands[0].cards.push(draw(true, panFor(si)));
      render();
    }
    await wait(240);
    state.dealer.cards.push(draw(round === 0));
    render();
  }

  let naturals = 0;
  state.seats.forEach((seat) => {
    for (const h of seat.hands) {
      if (isBlackjack(h.cards)) {
        h.natural = true;
        h.done = true;
        naturals++;
      }
    }
  });
  if (naturals) sfx.say('Blackjack');

  const up = state.dealer.cards[0];
  let dealerBJ = false;
  if (up.rank === 'A') await offerInsurance();
  // Con un As el crupier siempre revisa; con una figura, solo en las mesas de EE. UU.
  state.peeked = up.rank === 'A' || (S().peek === 'us' && cardValue(up) === 10);
  if (state.peeked) {
    await wait(450);
    dealerBJ = isBlackjack(state.dealer.cards);
    if (dealerBJ) revealHole();
    else tableEvent('El crupier revisó: no tiene Blackjack');
    if (dealerBJ) sfx.say('El crupier tiene Blackjack');
    render();
  }

  if (!dealerBJ) {
    state.phase = 'playing';
    await playSeats();
    state.phase = 'dealer';
    await dealerPlay();
  }
  settle();
  const soundEnd = settleSounds();
  if (state.shoe.length <= state.cutAt) state.needShuffle = true;
  state.summary = roundSummary();
  if (!dealerBJ) sfx.say(state.summary.title);
  state.phase = 'betting';
  state.turn = null;
  state.pending = null;

  for (const seat of state.seats) {
    const p = seat.playerId && getPlayer(seat.playerId);
    if (!p || p.isBot) continue;
    const others = committedBy(p.id) - seat.bet;
    seat.bet = Math.min(seat.lastBet || seat.bet, Math.max(0, p.bankroll - others));
    if (seat.bet < S().minBet) seat.bet = 0;
  }
  botBets(true);
  // Los bots ponen sus fichas para la próxima mano cuando el crupier termina de pagar.
  state.seats.forEach((seat, si) => {
    const p = seat.playerId && getPlayer(seat.playerId);
    if (p && p.isBot && seat.bet) sfx.chips(2, panFor(si), soundEnd + 0.3 + si * 0.08);
  });
  save();
  render();
}

/** El crupier paga y recoge puesto por puesto. Devuelve cuándo termina, en segundos. */
function settleSounds() {
  let t = 0.2;
  state.seats.forEach((seat, si) => {
    const pan = panFor(si);
    for (const h of seat.hands) {
      const r = h.result;
      if (!r) continue;
      if (r.kind === 'win') sfx.payout(pan, t);
      else if (r.kind === 'bj') sfx.payout(pan, t, true);
      else if ((r.kind === 'lose' || r.kind === 'bust') && !h.collected) sfx.collect(pan, t);
      else if (r.kind === 'push' && !r.ins) continue;
      if (r.ins) {
        if (r.insNet > 0) sfx.payout(pan, t + 0.15);
        else sfx.collect(pan, t + 0.15);
      }
      t += 0.26;
    }
  });
  return t;
}

async function playSeats() {
  for (let si = 0; si < SEATS; si++) {
    const seat = state.seats[si];
    if (!seat.hands.length) continue;
    const player = getPlayer(seat.playerId);
    for (let hi = 0; hi < seat.hands.length; hi++) {
      const hand = seat.hands[hi];
      if (hand.done) continue;
      state.turn = { si, hi };
      state.hintShown = false;
      if (hand.cards.length === 1) {
        render();
        await wait(300);
        hand.cards.push(draw(true, panFor(si)));
      }
      render();
      while (!hand.done) {
        const total = handValue(hand.cards).total;
        if (total >= 21) {
          hand.done = true;
          hand.bust = total > 21;
          break;
        }
        const o = optionsFor(seat, hand, player);
        if (hand.splitAces && !S().hitSplitAces && !o.canSplit) {
          hand.done = true;
          break;
        }
        const rec = recommend(hand, o);
        let act;
        if (player.isBot) {
          await wait(620);
          act = rec.action;
        } else {
          act = await askHuman(o, rec);
          judge(player, si, hi, hand, act, rec, o);
        }
        await apply(seat, hi, act, player);
        render();
      }
      await wait(220);
    }
  }
  state.turn = null;
}

function askHuman(o, rec) {
  return new Promise((resolve) => {
    state.pending = { o, rec, resolve };
    startDecisionTimer();
    render();
  });
}

/* Tiempo para decidir, como en las mesas en vivo. Si se acaba, se juega la «decisión honesta»:
   pedir con 11 o menos y plantarse con 12 o más; en el seguro, no tomarlo. */
let decisionTimer = 0;
function startDecisionTimer() {
  clearTimeout(decisionTimer);
  const secs = S().decisionTime;
  if (!secs || !state.pending) return;
  state.pending.started = performance.now();
  state.pending.ms = secs * 1000;
  decisionTimer = setTimeout(onDecisionTimeout, secs * 1000);
}

function onDecisionTimeout() {
  const pend = state.pending;
  if (!pend) return;
  state.timedOut = true;
  if (pend.kind === 'insurance') {
    tableEvent('Se acabó el tiempo: sin seguro');
    humanAct('N');
    return;
  }
  const cur = currentHumanHand();
  const total = cur ? handValue(cur.hand.cards).total : 21;
  let act = total <= 11 ? 'H' : 'S';
  if (!isLegal(act, pend.o)) act = 'S';
  tableEvent(`Se acabó el tiempo: ${act === 'H' ? 'pides carta' : 'te plantas'}`);
  humanAct(act);
}

const INSURANCE_REASON =
  'El seguro es una apuesta aparte: paga 2 a 1 si el crupier tiene Blackjack, pero eso pasa menos de 1 de cada 3 veces. A la larga pierde dinero, así que la estrategia básica nunca lo toma, ni siquiera el "pago igual" con tu Blackjack.';

async function offerInsurance() {
  if (state.seats.some((s) => s.hands.length && isHumanSeat(s))) sfx.say('¿Seguro?');
  for (let si = 0; si < SEATS; si++) {
    const seat = state.seats[si];
    const hand = seat.hands[0];
    if (!hand || !isHumanSeat(seat)) continue;
    const player = getPlayer(seat.playerId);
    const cost = hand.bet / 2;
    if (player.bankroll < cost) continue;
    state.turn = { si, hi: 0 };
    state.hintShown = false;
    const take = await new Promise((resolve) => {
      state.pending = { kind: 'insurance', cost, resolve };
      startDecisionTimer();
      render();
    });
    if (take) {
      player.bankroll -= cost;
      hand.insurance = cost;
      sfx.chips(1, panFor(si));
    }
    player.stats.decisions++;
    if (!take) player.stats.correct++;
    feedbackSound(!take);
    logDecision({
      ok: !take,
      player: player.name,
      color: player.color,
      desc: `Seguro con ${describeHand(hand.cards)} vs As`,
      key: 'Seguro',
      chosen: take ? 'I' : 'N',
      rec: 'N',
      reason: INSURANCE_REASON,
    });
  }
  state.turn = null;
  render();
}

function humanAct(act) {
  const pend = state.pending;
  if (!pend) return;
  clearTimeout(decisionTimer);
  if (pend.kind === 'insurance') {
    if (act !== 'I' && act !== 'N') return;
    state.pending = null;
    pend.resolve(act === 'I');
    return;
  }
  if (!isLegal(act, pend.o)) return;
  state.pending = null;
  pend.resolve(act);
}

function describeHand(cards) {
  if (isBlackjack(cards)) return 'Blackjack';
  const { total, soft } = handValue(cards);
  if (isPair(cards)) {
    const r = cards[0].rank === 'A' ? 'A' : cardValue(cards[0]);
    return `Pareja ${r}-${r}`;
  }
  return `${total} ${soft ? 'suave' : 'duro'}`;
}

function upLabel() {
  const u = state.dealer.cards[0];
  return u.rank === 'A' ? 'As' : String(cardValue(u));
}

function logDecision(entry) {
  state.feedback = entry;
  state.log.unshift(entry);
  state.log = state.log.slice(0, LOG_MAX);
}

function feedbackSound(ok) {
  if (!S().feedback || !S().feedbackSound) return;
  if (ok) sfx.good();
  else sfx.bad();
}

function judge(player, si, hi, hand, act, rec, o) {
  const ok = act === rec.action;
  const late = state.timedOut;
  state.timedOut = false;
  player.stats.decisions++;
  if (ok) player.stats.correct++;
  feedbackSound(ok);
  logDecision({
    ok,
    player: player.name,
    color: player.color,
    desc: `${describeHand(hand.cards)} vs ${upLabel()}`,
    chosen: act,
    rec: rec.action,
    reason: late ? `Se acabó el tiempo. ${rec.reason}` : rec.reason,
    // La situación exacta, para poder repetirla en el repaso de errores.
    cards: hand.cards.map((c) => c.rank),
    up: state.dealer.cards[0].rank,
    opts: { canDouble: o.canDouble, canSplit: o.canSplit, canSurrender: o.canSurrender, noPeek: o.noPeek },
  });
}

async function apply(seat, hi, act, player) {
  const hand = seat.hands[hi];
  const pan = panFor(state.seats.indexOf(seat));
  switch (act) {
    case 'H':
      await wait(160);
      hand.cards.push(draw(true, pan));
      break;
    case 'S':
      hand.done = true;
      break;
    case 'D':
      player.bankroll -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      sfx.chips(2, pan);
      await wait(260);
      hand.cards.push(draw(true, pan));
      hand.done = true;
      break;
    case 'P': {
      player.bankroll -= hand.bet;
      const moved = hand.cards.pop();
      moved.slidAt = performance.now();
      const aces = moved.rank === 'A';
      hand.fromSplit = true;
      hand.splitAces = aces;
      seat.hands.splice(hi + 1, 0, { cards: [moved], bet: hand.bet, fromSplit: true, splitAces: aces });
      sfx.chips(2, pan);
      render();
      await wait(320);
      hand.cards.push(draw(true, pan));
      break;
    }
    case 'R':
      hand.surrendered = true;
      hand.done = true;
      hand.collected = true;
      sfx.collect(pan, 0.1);
      break;
  }
  if (handValue(hand.cards).total > 21) {
    hand.bust = true;
    hand.done = true;
    hand.collected = true;
    sfx.collect(pan, 0.35);
  }
}

function revealHole() {
  if (!state.dealer.hidden) return;
  state.dealer.hidden = false;
  const hole = state.dealer.cards[1];
  if (hole) {
    countCard(hole);
    hole.flipAt = performance.now();
    sfx.flip();
  }
}

async function dealerPlay() {
  await wait(400);
  revealHole();
  render();
  const live = state.seats.some((s) => s.hands.some((h) => !h.bust && !h.surrendered && !h.natural));
  if (!live) return;
  for (;;) {
    const { total, soft } = handValue(state.dealer.cards);
    if (total < 17 || (total === 17 && soft && S().h17)) {
      await wait(620);
      state.dealer.cards.push(draw());
      render();
    } else break;
  }
}

function settle() {
  revealHole();
  const d = handValue(state.dealer.cards).total;
  const dealerBJ = isBlackjack(state.dealer.cards);
  const dealerBust = d > 21;
  // Si el crupier no revisó y tiene Blackjack, con esta regla solo se pierde la apuesta original.
  const originalOnly = dealerBJ && !state.peeked && S().noPeekLoss === 'original';
  for (const seat of state.seats) {
    const p = seat.playerId && getPlayer(seat.playerId);
    if (!p) continue;
    let originalTaken = false;
    for (const h of seat.hands) {
      const t = handValue(h.cards).total;
      let back = 0;
      let kind;
      if (h.surrendered) {
        back = h.bet / 2;
        kind = 'sur';
      } else if (h.natural && seat.hands.length === 1) {
        if (dealerBJ) {
          back = h.bet;
          kind = 'push';
        } else {
          back = h.bet + h.bet * S().bjPays;
          kind = 'bj';
        }
      } else if (dealerBJ) {
        kind = 'lose';
        if (originalOnly) {
          // Se devuelven lo doblado y las manos divididas.
          if (!originalTaken) back = Math.max(0, h.bet - seat.lastBet);
          else {
            back = h.bet;
            kind = 'push';
          }
          originalTaken = true;
        }
      } else if (h.bust || t > 21) kind = 'bust';
      else if (dealerBust || t > d) {
        back = h.bet * 2;
        kind = 'win';
      } else if (t === d) {
        back = h.bet;
        kind = 'push';
      } else kind = 'lose';
      const handNet = back - h.bet;
      let insNet = 0;
      if (h.insurance) {
        if (dealerBJ) back += h.insurance * 3;
        insNet = dealerBJ ? h.insurance * 2 : -h.insurance;
      }
      p.bankroll += back;
      h.result = { kind, net: handNet + insNet, handNet, insNet, ins: !!h.insurance };
    }
  }
}

function roundSummary() {
  // El Blackjack del crupier puede aparecer al final si no revisó con una figura.
  const dealerBJ = isBlackjack(state.dealer.cards);
  const d = handValue(state.dealer.cards).total;
  const title = dealerBJ ? 'El crupier tiene Blackjack' : d > 21 ? `El crupier se pasa con ${d}` : `El crupier tiene ${d}`;
  const nets = new Map();
  for (const seat of state.seats) {
    const p = seat.playerId && getPlayer(seat.playerId);
    if (!p || p.isBot || !seat.hands.length) continue;
    const n = seat.hands.reduce((a, h) => a + (h.result ? h.result.net : 0), 0);
    nets.set(p, (nets.get(p) || 0) + n);
  }
  const parts = [...nets].map(([p, n]) => (n > 0 ? `${p.name} gana ${fmt(n)}` : n < 0 ? `${p.name} pierde ${fmt(-n)}` : `${p.name} queda igual`));
  const total = [...nets.values()].reduce((a, n) => a + n, 0);
  return {
    title,
    sub: parts.join(' · '),
    tone: !nets.size ? '' : total > 0 ? 'win' : total < 0 ? 'lose' : '',
    note: state.needShuffle ? 'Salió la carta de corte: se baraja antes de la próxima mano' : '',
  };
}

function notice(msg) {
  state.notice = msg;
  render();
}

let eventTimer = 0;
function tableEvent(text, ms = 3200) {
  state.event = { text, until: Date.now() + delay(ms) };
  clearTimeout(eventTimer);
  eventTimer = setTimeout(renderBanner, delay(ms) + 30);
}

/* ───────────────────────── Apuestas y asientos ───────────────────────── */

function addChip(v, opts = {}) {
  if (state.phase !== 'betting') return;
  const seat = state.seats[state.selectedSeat];
  if (!isHumanSeat(seat)) return notice('Primero toca el círculo de apuesta de un puesto tuyo.');
  const p = getPlayer(seat.playerId);
  const free = p.bankroll - committedBy(p.id);
  const add = Math.min(v, free, S().maxBet - seat.bet);
  if (add <= 0) return notice(free <= 0 ? `${p.name} no tiene más saldo libre.` : `La apuesta máxima es ${fmt(S().maxBet)}.`);
  const first = seat.bet === 0;
  seat.bet += add;
  seat.betAt = performance.now();
  state.notice = '';
  if (opts.double) sfx.betDouble(panFor(state.selectedSeat));
  else sfx.bet(v, panFor(state.selectedSeat), first);
  render();
}

/** Fija la apuesta del puesto elegido en un monto exacto (escrito o «Máx»). */
function setBet(amount, opts = {}) {
  if (state.phase !== 'betting') return;
  const seat = state.seats[state.selectedSeat];
  if (!isHumanSeat(seat)) return notice('Primero toca el círculo de apuesta de un puesto tuyo.');
  const p = getPlayer(seat.playerId);
  const limit = Math.min(S().maxBet, p.bankroll - committedBy(p.id) + seat.bet);
  let v = Math.floor(Number(amount) || 0);
  if (v < 0) v = 0;
  state.notice = '';
  if (v > limit) {
    v = Math.floor(limit);
    if (!opts.max) state.notice = limit < S().maxBet ? `${p.name} solo tiene ${fmt(limit)} libres para este puesto.` : `La apuesta máxima es ${fmt(S().maxBet)}.`;
  }
  if (v > 0 && v < S().minBet) {
    v = 0;
    state.notice = `La apuesta mínima es ${fmt(S().minBet)}.`;
  }
  const grew = v > seat.bet;
  seat.bet = v;
  if (grew) {
    seat.betAt = performance.now();
    if (opts.cascade) sfx.betDouble(panFor(state.selectedSeat));
    else sfx.chips(2, panFor(state.selectedSeat));
  }
  render();
}

function sit(si, playerId) {
  if (state.phase !== 'betting') return;
  const seat = state.seats[si];
  seat.playerId = playerId || null;
  seat.bet = 0;
  seat.hands = [];
  const p = playerId && getPlayer(playerId);
  if (p && !p.isBot) {
    const free = p.bankroll - committedBy(p.id);
    seat.bet = free >= S().minBet ? S().minBet : 0;
    state.selectedSeat = si;
  }
  if (p && p.isBot) botBets(false);
  pickSelectedSeat();
  state.notice = '';
  save();
  render();
}

/* ───────────────────────── Render ───────────────────────── */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const svg = (paths) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const ICON = {
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  cross: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  bulb: svg('<path d="M9.5 18.5h5M10.5 21h3"/><path d="M12 3.2a5.8 5.8 0 0 0-3.5 10.4c.7.6 1.1 1.4 1.2 2.4h4.6c.1-1 .5-1.8 1.2-2.4A5.8 5.8 0 0 0 12 3.2z"/>'),
  grid: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.7v.1"/>'),
};

const LABELS = { ...ACTIONS, I: 'Tomar seguro', N: 'Sin seguro' };
const RESULT_TEXT = { win: 'Gana', lose: 'Pierde', bust: 'Se pasa', push: 'Empate', bj: 'Blackjack', sur: 'Rendición' };

/**
 * La apuesta como una pila de fichas: abajo las de más valor, arriba la de menos, que
 * lleva el monto. Si la apuesta acaba de crecer, la ficha de arriba cae sobre la pila.
 */
function chipStackHTML(amount, pop) {
  const discs = [];
  let rest = amount;
  for (const v of [...LADDER].reverse()) {
    while (rest >= v - 1e-9 && discs.length < 60) {
      discs.push(v);
      rest -= v;
    }
  }
  if (!discs.length) discs.push(LADDER[0]);
  // Como mucho 7 fichas a la vista: se conservan la base y la de arriba.
  const shown = discs.length > 7 ? [...discs.slice(0, 6), discs[discs.length - 1]] : discs;
  const n = shown.length;
  const top = shown[n - 1];
  const lower = shown
    .slice(0, -1)
    .map((v, i) => `<i class="disc" style="--c:var(--chip-${v});--i:${i}"></i>`)
    .join('');
  const style = pop ? `;animation-delay:${-Math.round(pop)}ms` : '';
  return `<span class="stack${pop !== null ? ' pop' : ''}" style="--n:${n}" aria-hidden="true">${lower}<span class="chip-mini top" style="--c:var(--chip-${top});--i:${n - 1}${style}">${shortMoney(amount)}</span></span>`;
}

/* Animaciones de cartas. Cada carta guarda cuándo se repartió, se volteó o se movió; si la
   mesa se vuelve a dibujar a mitad de una animación, esta sigue desde donde iba (con un
   retraso negativo) en vez de empezar otra vez o cortarse. */
const DEAL_MS = 520;
const FLIP_MS = 760;
const SLIDE_MS = 320;
const aim = new Map(); // id de carta -> distancia desde el zapato

function cardHTML(c, opts = {}) {
  const now = performance.now();
  const since = (t) => (t ? now - t : Infinity);
  const cls = ['card'];
  const style = [];
  const dealt = since(c.at);
  const flipped = since(c.flipAt);
  const slid = since(c.slidAt);
  if (dealt < DEAL_MS) {
    cls.push('fresh');
    style.push(`animation-delay:${-Math.round(dealt)}ms`);
  } else if (slid < SLIDE_MS) {
    cls.push('slid');
    style.push(`animation-delay:${-Math.round(slid)}ms`);
  }
  const v = aim.get(c.id);
  if (v) style.push(`--fx:${v.x}px;--fy:${v.y}px`);
  const attrs = `data-cid="${c.id}"${style.length ? ` style="${style.join(';')}"` : ''}`;
  if (opts.back) return `<div class="${cls.join(' ')} back" ${attrs} role="img" aria-label="Carta boca abajo"></div>`;
  const red = c.suit === '♥' || c.suit === '♦';
  const face = `<span class="ci" aria-hidden="true">${c.rank}<i>${c.suit}</i></span><span class="cs" aria-hidden="true">${c.suit}</span>`;
  if (flipped < FLIP_MS) {
    // Carta de dos caras: empieza mostrando el dorso y gira hasta quedar boca arriba.
    return `<div class="card flipper${red ? ' red' : ''}" data-cid="${c.id}" style="animation-delay:${-Math.round(flipped)}ms" role="img" aria-label="${c.rank}${c.suit}">
      <div class="face front">${face}</div><div class="face back"></div></div>`;
  }
  if (red) cls.push('red');
  if (opts.side) cls.push('side');
  return `<div class="${cls.join(' ')}" ${attrs} role="img" aria-label="${c.rank}${c.suit}">${face}</div>`;
}

/** Calcula, para cada carta recién repartida, de dónde viene: el zapato. */
function aimNewCards(root = document) {
  const shoe = $('#shoe .shoe-box');
  if (!shoe) return;
  const s = shoe.getBoundingClientRect();
  const sx = s.left + s.width / 2;
  const sy = s.top + s.height / 2;
  root.querySelectorAll('.card.fresh[data-cid]').forEach((el) => {
    if (aim.has(el.dataset.cid)) return;
    const r = el.getBoundingClientRect();
    const v = { x: Math.round(sx - (r.left + r.width / 2)), y: Math.round(sy - (r.top + r.height / 2)) };
    aim.set(el.dataset.cid, v);
    el.style.setProperty('--fx', `${v.x}px`);
    el.style.setProperty('--fy', `${v.y}px`);
  });
}

/** El crupier recoge las cartas de la ronda anterior hacia su izquierda antes de repartir. */
async function sweepTable() {
  const els = [...document.querySelectorAll('#seats .card, #dealer .card:not(.ghost)')];
  aim.clear();
  if (!els.length) return;
  const felt = $('.felt').getBoundingClientRect();
  const tx = felt.left + 48;
  const ty = felt.top + 36;
  els.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--gx', `${Math.round(tx - (r.left + r.width / 2))}px`);
    el.style.setProperty('--gy', `${Math.round(ty - (r.top + r.height / 2))}px`);
    el.style.animationDelay = `${Math.min(i * 14, 220)}ms`;
    el.classList.add('gone');
  });
  sfx.sweep();
  await wait(520);
}

function handTotal(h) {
  const { total, soft } = handValue(h.cards);
  if (h.natural) return { label: 'BJ', cls: 'bj' };
  if (total > 21) return { label: String(total), cls: 'bust' };
  if (total === 21) return { label: '21', cls: 't21' };
  return { label: soft ? `${total - 10}/${total}` : String(total), cls: '' };
}

function renderPrint() {
  const s = S();
  const key = `${s.bjPays}|${s.h17}`;
  if (renderPrint.key === key) return;
  renderPrint.key = key;
  const big = `BLACKJACK PAGA ${s.bjPays === 1.5 ? '3 A 2' : '6 A 5'}`;
  const sub = `EL CRUPIER ${s.h17 ? 'PIDE CON 17 SUAVE' : 'SE PLANTA EN 17'} · EL SEGURO PAGA 2 A 1`;
  $('#felt-print').innerHTML = `<svg viewBox="0 0 800 92" preserveAspectRatio="xMidYMin slice" focusable="false">
    <path id="arc-big" d="M90 32 Q400 82 710 32" fill="none"/>
    <path id="arc-sub" d="M100 58 Q400 108 700 58" fill="none"/>
    <text class="big"><textPath href="#arc-big" startOffset="50%" text-anchor="middle">${big}</textPath></text>
    <text class="sub"><textPath href="#arc-sub" startOffset="50%" text-anchor="middle">${sub}</textPath></text>
  </svg>`;
}

function renderShoe() {
  const s = S();
  const left = state.shoe.length;
  const pct = state.shoeSize ? (left / state.shoeSize) * 100 : 100;
  const tc = trueCount();
  const count = s.showCount
    ? `<div class="count" title="Conteo Hi-Lo"><span>Cuenta</span><b>${state.runningCount > 0 ? '+' : ''}${state.runningCount}</b><span>Real</span><b>${tc > 0 ? '+' : ''}${tc.toFixed(1)}</b></div>`
    : '';
  $('#shoe').innerHTML = `<div class="shoe-box" aria-hidden="true"></div>
    <div class="shoe-meta"><span>${left} cartas</span><span class="meter" role="img" aria-label="Quedan ${Math.round(pct)}% de las cartas"><i style="width:${pct}%"></i></span></div>${count}`;
}

function renderDealer() {
  const d = state.dealer;
  const cards = d.cards.length
    ? d.cards.map((c, i) => cardHTML(c, { back: i === 1 && d.hidden })).join('')
    : '<div class="card ghost"></div><div class="card ghost"></div>';
  let total = '';
  if (d.cards.length) {
    if (d.hidden) total = `<span class="total">${d.cards[0].rank === 'A' ? 'A' : cardValue(d.cards[0])}</span>`;
    else {
      const t = handValue(d.cards).total;
      const bj = isBlackjack(d.cards);
      total = `<span class="total ${t > 21 ? 'bust' : bj ? 'bj' : ''}">${bj ? 'BJ' : t}</span>`;
    }
  }
  $('#dealer').innerHTML = `<div class="cards">${cards}</div><div class="dealer-label">${total}<span>Crupier</span></div>`;
}

function bannerContent() {
  const ev = state.event && state.event.until > Date.now() ? state.event.text : '';
  if (state.phase === 'betting') {
    if (state.summary) return state.summary;
    const anyHuman = state.seats.some((s) => isHumanSeat(s));
    return {
      title: 'Hagan sus apuestas',
      sub: anyHuman ? 'Marca una ficha y toca tu círculo para apostar' : 'Siéntate en un puesto libre para jugar',
      note: state.needShuffle ? 'Se baraja antes de la próxima mano' : '',
    };
  }
  if (state.pending && state.pending.kind === 'insurance') {
    return { title: '¿Seguro?', sub: `El crupier muestra un As · cuesta ${fmt(state.pending.cost)}`, tone: 'turn', note: ev };
  }
  if (state.phase === 'playing' && state.turn) {
    const seat = state.seats[state.turn.si];
    const p = getPlayer(seat.playerId);
    const hand = seat.hands[state.turn.hi];
    const handNo = seat.hands.length > 1 ? ` · mano ${state.turn.hi + 1} de ${seat.hands.length}` : '';
    const sub = `Puesto ${state.turn.si + 1}${handNo} · ${describeHand(hand.cards)} contra ${upLabel()}`;
    if (!p.isBot) return { title: `Tu turno, ${p.name}`, sub, tone: 'turn', note: ev };
    return { title: `Juega ${p.name}`, sub, note: ev };
  }
  if (state.phase === 'dealer') return { title: 'Juega el crupier', sub: S().h17 ? 'Pide con 17 suave' : 'Se planta en todos los 17', note: ev };
  return { title: 'Repartiendo', sub: '', note: ev };
}

function renderBanner() {
  const b = bannerContent();
  const el = $('#banner');
  el.className = `banner ${b.tone || ''}`;
  el.innerHTML = `<strong>${esc(b.title)}</strong>${b.sub ? `<span>${esc(b.sub)}</span>` : ''}${b.note ? `<em>${esc(b.note)}</em>` : ''}`;
}

function handHTML(h, active, compact) {
  const r = h.result;
  const t = handTotal(h);
  const cards = h.cards.map((c, ci) => cardHTML(c, { side: h.doubled && ci === h.cards.length - 1 })).join('');
  let badge = '';
  if (r) {
    // Con varias manos solo cabe el monto; el detalle queda en el texto accesible.
    const net = r.handNet ?? r.net;
    const text = compact ? (net ? signed(net) : RESULT_TEXT[r.kind]) : `${RESULT_TEXT[r.kind]}${net ? ` ${signed(net)}` : ''}`;
    badge = `<span class="badge ${r.kind}" title="${RESULT_TEXT[r.kind]}">${text}</span>`;
  }
  const ins = r && r.ins ? `<span class="badge ins">Seguro ${signed(r.insNet)}</span>` : h.insurance ? '<span class="badge ins">Con seguro</span>' : '';
  return `<div class="hand${active ? ' active' : ''}${h.doubled ? ' doubled' : ''}${r ? ` res-${r.kind}` : ''}">
    <div class="cards">${cards}</div>
    <div class="hand-meta"><span class="total ${t.cls}">${t.label}</span><span class="hbet">${fmt(h.bet)}</span></div>
    ${badge}${ins}
  </div>`;
}

function seatHTML(seat, si) {
  const betting = state.phase === 'betting';
  const p = seat.playerId && getPlayer(seat.playerId);
  const human = !!p && !p.isBot;
  const turn = !!state.turn && state.turn.si === si;
  const selected = betting && human && state.selectedSeat === si;
  const n = seat.hands.length;
  const cls = ['seat', p ? '' : 'empty', turn ? 'turn' : '', selected ? 'selected' : '', n > 1 ? `multi m${Math.min(n, 5)}` : '', betting && n ? 'stale' : '']
    .filter(Boolean)
    .join(' ');
  const hands = seat.hands
    .map((h, hi) => handHTML(h, turn && state.turn.hi === hi && !h.done && state.phase === 'playing', n > 1))
    .join('');

  const shownBet = betting ? seat.bet : n ? seat.lastBet : 0;
  let inner;
  const sinceBet = seat.betAt ? performance.now() - seat.betAt : Infinity;
  if (shownBet > 0) inner = chipStackHTML(shownBet, betting && sinceBet < 280 ? sinceBet : null);
  else if (human && betting) inner = '<span class="spot-hint">Apostar</span>';
  else inner = `<span class="spot-num">${si + 1}</span>`;

  let action = '';
  let label = `Puesto ${si + 1}`;
  if (!p) {
    if (betting) action = 'sit-open';
    label += ', libre. Sentar a alguien';
  } else {
    label += `, ${p.name}${shownBet ? `, apuesta ${fmt(shownBet)}` : ''}`;
    if (human && betting) action = 'select-seat';
  }
  const spot = `<button class="spot" ${action ? `data-action="${action}" data-seat="${si}"` : 'tabindex="-1"'} aria-label="${esc(label)}">${inner}<span class="spot-tag" aria-hidden="true">${si + 1}</span></button>`;

  let plate;
  if (p) {
    const leave = betting
      ? `<button class="leave" data-action="leave" data-seat="${si}" title="Levantarse del puesto" aria-label="Levantar a ${esc(p.name)} del puesto ${si + 1}">${ICON.cross}</button>`
      : '';
    plate = `<div class="plate"><div class="who"><span class="dot" style="--c:${p.color}"></span><span class="pname">${esc(p.name)}</span></div><div class="bank">${p.isBot ? '<span class="tag">bot</span>' : ''}${fmt(p.bankroll)}</div>${leave}</div>`;
  } else if (!betting) {
    plate = '';
  } else {
    const opts = state.players.map((pl) => `<option value="${pl.id}">${esc(pl.name)}${pl.isBot ? ' (bot)' : ''}</option>`).join('');
    plate = `<label class="sit"><span class="sr">Sentar a alguien en el puesto ${si + 1}</span><select data-sit="${si}"><option value="">Sentarse</option>${opts}</select></label>`;
  }

  // Un puesto con varias manos divididas ocupa más ancho para que no se apilen.
  const w = 1 + Math.max(0, n - 1) * 0.55;
  return `<div class="${cls}" data-si="${si}" style="order:${SEATS - si};--w:${w};--k:${SEAT_LIFT[si]};--pc:${p ? p.color : 'transparent'}">
    <div class="seat-hands">${hands}</div>${spot}${plate}
  </div>`;
}

function renderSeats() {
  $('#seats').innerHTML = state.seats.map(seatHTML).join('');
  fitSeats();
}

/**
 * Los puestos de las orillas pueden subir hacia el centro del paño, pero los puestos
 * centrales nunca deben tapar el letrero: se sube solo lo que deja libre el puesto más alto.
 */
function fitSeats() {
  const sc = $('#seats-scroll');
  if (getComputedStyle(sc).overflowX !== 'visible') {
    sc.style.marginTop = '';
    return;
  }
  const outer = $('#seats .seat[data-si="0"]');
  const wanted = parseFloat(getComputedStyle(outer).marginBottom) * 0.78;
  const top = $('#seats').getBoundingClientRect().top;
  let slack = Infinity;
  for (const el of document.querySelectorAll('#seats .seat')) {
    const si = Number(el.dataset.si);
    if (si >= 2 && si <= 4) slack = Math.min(slack, el.getBoundingClientRect().top - top);
  }
  sc.style.marginTop = `${-Math.max(0, Math.min(wanted, slack - 4))}px`;
}

function currentHumanHand() {
  if (!state.pending || !state.turn) return null;
  const seat = state.seats[state.turn.si];
  return { seat, hand: seat.hands[state.turn.hi], player: getPlayer(seat.playerId), si: state.turn.si, hi: state.turn.hi };
}

function whoHTML(p, extra) {
  return `<div class="who"><span class="dot" style="--c:${p.color}"></span><span class="pname">${esc(p.name)}</span>${extra ? `<span class="seatno">${extra}</span>` : ''}</div>`;
}

function renderDockInfo() {
  const el = $('#dock-info');
  const note = state.notice ? `<p class="notice" role="alert">${esc(state.notice)}</p>` : '';
  if (state.phase === 'betting') {
    const seat = state.seats[state.selectedSeat];
    if (isHumanSeat(seat)) {
      const p = getPlayer(seat.playerId);
      const free = p.bankroll - committedBy(p.id);
      // No se redibuja mientras se escribe el monto, para no perder lo escrito.
      if (document.activeElement && document.activeElement.matches('[data-bet-input]') && !state.notice) return;
      el.innerHTML = `${whoHTML(p, `Puesto ${state.selectedSeat + 1}`)}
        <div class="info-line bet-line">
          <label class="bet-field"><span>Apuesta</span><input data-bet-input type="number" inputmode="numeric" min="0" step="${S().minBet}" value="${seat.bet}" aria-label="Monto de la apuesta del puesto ${state.selectedSeat + 1}"></label>
          <span>libre <b class="num">${fmt(free)}</b></span>
        </div>
        ${
          free + seat.bet < S().minBet
            ? `<p class="notice">No te alcanza para la apuesta mínima. <button class="link" data-action="rebuy">Recargar ${fmt(p.startBankroll || 1000)}</button></p>`
            : note || `<p class="info-hint">Toca tu círculo para poner fichas de <b>${fmt(activeChip())}</b></p>`
        }`;
    } else {
      el.innerHTML = `<div class="info-line">Toca el círculo de un puesto tuyo para apostar, o siéntate en un puesto libre.</div>${note}`;
    }
    return;
  }
  const cur = currentHumanHand();
  if (cur) {
    const handNo = cur.seat.hands.length > 1 ? ` · mano ${cur.hi + 1}/${cur.seat.hands.length}` : '';
    const line = state.pending.kind === 'insurance'
      ? `<b>${describeHand(cur.hand.cards)}</b> contra <b>As</b> · seguro <b class="num">${fmt(state.pending.cost)}</b>`
      : `<b>${describeHand(cur.hand.cards)}</b> contra <b>${upLabel()}</b>`;
    el.innerHTML = `${whoHTML(cur.player, `Puesto ${cur.si + 1}${handNo}`)}
      <div class="info-line">${line}</div>
      <div class="tools">
        <button class="btn ghost small" data-action="hint">${ICON.bulb}Pista <kbd>?</kbd></button>
        <button class="btn ghost small" data-action="chart">${ICON.grid}Tabla <kbd>T</kbd></button>
      </div>`;
    return;
  }
  let text = 'Repartiendo…';
  if (state.phase === 'playing' && state.turn) text = `${esc(getPlayer(state.seats[state.turn.si].playerId).name)} está jugando…`;
  else if (state.phase === 'dealer') text = 'Juega el crupier…';
  el.innerHTML = `<div class="info-line muted">${text}</div>`;
}

function renderControls() {
  const el = $('#controls');
  if (state.phase === 'betting') {
    const seat = state.seats[state.selectedSeat];
    const mine = isHumanSeat(seat);
    el.innerHTML = `<div class="row bet-row">
      <div class="chips" role="group" aria-label="Ficha para apostar">${chipSet().map((v, i) => {
        const on = v === activeChip();
        return `<button class="chip${v === 1 ? ' light' : ''}${on ? ' on' : ''}" style="--c:var(--chip-${v})" data-action="pick-chip" data-v="${v}" aria-pressed="${on}" title="Ficha de ${fmt(v)} (tecla ${i + 1})" aria-label="Marcar la ficha de ${fmt(v)}">${shortMoney(v)}</button>`;
      }).join('')}</div>
      <div class="row">
        <button class="btn ghost" data-action="clear-bet" ${mine && seat.bet ? '' : 'disabled'}>Quitar</button>
        <button class="btn ghost" data-action="double-bet" ${mine && seat.bet ? '' : 'disabled'} aria-label="Duplicar la apuesta">×2</button>
        <button class="btn ghost" data-action="max-bet" ${mine ? '' : 'disabled'} aria-label="Apostar el máximo posible">Máx</button>
        <button class="btn primary deal" data-action="deal" ${canDeal() ? '' : 'disabled'}>Repartir <kbd>Espacio</kbd></button>
      </div>
    </div>`;
    return;
  }
  const cur = currentHumanHand();
  const showRec = !!cur && (S().showHint || state.hintShown);
  const timer = cur && state.pending.ms
    ? `<div class="timer" role="timer" aria-label="Tiempo para decidir" style="--t:${state.pending.ms}ms"><i style="animation-delay:${-Math.round(performance.now() - state.pending.started)}ms"></i></div>`
    : '';
  if (cur && state.pending.kind === 'insurance') {
    el.innerHTML = `${timer}<div class="row actions" role="group" aria-label="Seguro">
      <button class="btn act" data-action="act" data-act="I">Tomar seguro <kbd>I</kbd></button>
      <button class="btn act${showRec ? ' rec' : ''}" data-action="act" data-act="N">Sin seguro <kbd>N</kbd></button>
    </div>`;
    return;
  }
  const keys = S().surrender ? ['H', 'S', 'D', 'P', 'R'] : ['H', 'S', 'D', 'P'];
  const btn = (k) => {
    const ok = cur && isLegal(k, state.pending.o);
    const rec = showRec && state.pending.rec.action === k;
    return `<button class="btn act${rec ? ' rec' : ''}" data-action="act" data-act="${k}" ${ok ? '' : 'disabled'}>${ACTIONS[k]} <kbd>${k}</kbd></button>`;
  };
  el.innerHTML = `${timer}<div class="row actions${cur ? '' : ' waiting'}" role="group" aria-label="Jugadas">${keys.map(btn).join('')}</div>`;
}

let coachOpen = false;
function coachCard(kind, icon, title, text, toggle = true) {
  return `<div class="coach-card ${kind}"${toggle ? ' data-action="coach-toggle"' : ''}><div class="coach-title">${icon}<span>${esc(title)}</span></div><p class="coach-text">${esc(text)}</p></div>`;
}

function accuracyText(p) {
  const { decisions: n, correct: c } = p.stats;
  return n ? `${Math.round((c / n) * 100)}% de acierto (${c} de ${n})` : 'todavía sin decisiones';
}

function renderCoach() {
  const el = $('#coach');
  const cur = currentHumanHand();
  const humans = state.players.filter((p) => !p.isBot);
  let html;
  if (cur && (S().showHint || state.hintShown)) {
    if (state.pending.kind === 'insurance') html = coachCard('hint', ICON.bulb, 'Pista: sin seguro', INSURANCE_REASON);
    else {
      const r = state.pending.rec;
      const ideal = r.ideal !== r.action ? ` La tabla dice ${ACTIONS[r.ideal]}.` : '';
      html = coachCard('hint', ICON.bulb, `Pista: ${ACTIONS[r.action]}`, r.reason + ideal);
    }
  } else if (state.feedback && S().feedback) {
    const f = state.feedback;
    const who = humans.length > 1 ? `${f.player}: ` : '';
    html = f.ok
      ? coachCard('ok', ICON.check, `${who}Correcto, ${LABELS[f.chosen].toLowerCase()}`, f.reason)
      : coachCard('bad', ICON.cross, `${who}Era ${LABELS[f.rec].toLowerCase()}, no ${LABELS[f.chosen].toLowerCase()}`, f.reason);
  } else {
    html = coachCard(
      'idle',
      ICON.info,
      'Entrenador',
      S().feedback
        ? 'Juega tus manos: aquí verás si cada decisión coincide con la estrategia básica y por qué.'
        : 'La corrección está apagada. Puedes activarla en Reglas.',
    );
  }
  const focus = (cur && cur.player) || (state.feedback && humans.find((h) => h.name === state.feedback.player)) || humans[0];
  const pending = pendingReview().length;
  const links = `${pending ? `<button class="link" data-action="open-review">Repasar errores (${pending})</button>` : ''}<button class="link" data-action="open-progress">Ver progreso</button>`;
  const foot = focus ? `<div class="coach-foot"><span>${esc(focus.name)}: ${accuracyText(focus)}</span><span class="links">${links}</span></div>` : '';
  el.classList.toggle('open', coachOpen);
  el.innerHTML = html + foot;
}

function render() {
  renderPrint();
  renderShoe();
  renderDealer();
  renderBanner();
  renderSeats();
  renderDockInfo();
  renderControls();
  renderCoach();
  if ($('#dlg-chart').open) renderChart();
  keepSeatInView();
  aimNewCards();
}

// En pantallas angostas los puestos se desplazan: centra el puesto que juega o el elegido.
let lastFocus = '';
function keepSeatInView() {
  const sc = $('#seats-scroll');
  const focus = $('.seat.turn') || $('.seat.selected');
  if (!focus || sc.scrollWidth <= sc.clientWidth + 2) return;
  const key = `${state.phase}:${state.turn ? state.turn.si : state.selectedSeat}`;
  if (key === lastFocus) return;
  lastFocus = key;
  sc.scrollTo({ left: focus.offsetLeft - (sc.clientWidth - focus.offsetWidth) / 2, behavior: 'smooth' });
}

/* ───────────────────────── Progreso ───────────────────────── */

/** Ganancia neta: incluye lo que está apostado en la ronda en curso y descuenta las recargas. */
function netOf(p) {
  let onTable = 0;
  if (state.phase !== 'betting') {
    for (const s of state.seats) {
      if (s.playerId !== p.id) continue;
      for (const h of s.hands) onTable += h.bet + (h.insurance || 0);
    }
  }
  return p.bankroll + onTable - p.startBankroll - (p.rebuys || 0) * (p.startBankroll || 1000);
}

/* ───────────────────────── Repaso de errores ───────────────────────── */

const MASTER = 3; // aciertos seguidos para dar una situación por dominada

const flagsOf = (o) => `${o.canDouble ? 'D' : ''}${o.canSplit ? 'P' : ''}${o.canSurrender ? 'R' : ''}`;
const tenRank = () => ['10', 'J', 'Q', 'K'][rnd(4)];

/** Dos cartas distintas, sin As, que suman `t`. */
function hardCards(t) {
  const options = [];
  for (let a = 2; a <= 10; a++) {
    const b = t - a;
    if (b > a && b <= 10) options.push([a, b]);
  }
  if (!options.length) return t === 20 ? [tenRank(), tenRank()] : null;
  const [a, b] = options[rnd(options.length)];
  const r = (v) => (v === 10 ? tenRank() : String(v));
  return [r(a), r(b)];
}

/**
 * Cartas, carta del crupier y jugadas permitidas de una decisión del historial. Las
 * decisiones guardadas antes de esta función no tenían las cartas: se reconstruyen.
 */
function situationOf(l) {
  if (l.key === 'Seguro') return null;
  if (l.cards && l.up && l.opts) return { cards: l.cards, up: l.up, opts: l.opts };
  const m = /^(?:Pareja (A|\d+)-(?:A|\d+)|(\d+) (suave|duro)) vs (As|\d+)$/.exec(l.desc || '');
  if (!m) return null;
  const up = m[4] === 'As' ? 'A' : m[4] === '10' ? tenRank() : m[4];
  let cards;
  if (m[1]) {
    const r = m[1] === 'A' ? 'A' : m[1] === '10' ? tenRank() : m[1];
    cards = [r, r];
  } else if (m[3] === 'suave') {
    const k = Number(m[2]) - 11;
    if (k < 2 || k > 9) return null;
    cards = ['A', String(k)];
  } else cards = hardCards(Number(m[2]));
  if (!cards) return null;
  const pair = cardValue({ rank: cards[0] }) === cardValue({ rank: cards[1] });
  return { cards, up, opts: { canDouble: true, canSplit: pair, canSurrender: S().surrender } };
}

/**
 * Agrupa el historial por situación (mano, carta del crupier y jugadas permitidas): cuántas
 * veces se falló y cuántos aciertos seguidos lleva desde el último fallo.
 */
function reviewStats() {
  const map = new Map();
  for (const l of state.log) {
    // El historial va del más reciente al más antiguo.
    const sit = situationOf(l);
    if (!sit) continue;
    const key = `${l.desc}|${flagsOf(sit.opts)}`;
    let e = map.get(key);
    if (!e) {
      e = { key, desc: l.desc, many: sit.cards.length > 2, rec: l.rec, misses: 0, streak: 0, counting: true, sample: null };
      map.set(key, e);
    }
    if (l.ok) {
      if (e.counting) e.streak++;
    } else {
      if (!e.misses) e.rec = l.rec;
      e.misses++;
      e.counting = false;
    }
    if (!e.sample && l.cards) e.sample = l;
  }
  return [...map.values()].filter((e) => e.misses > 0).map((e) => ({ ...e, mastered: e.streak >= MASTER }));
}

const pendingReview = () => reviewStats().filter((e) => !e.mastered);

function openReview() {
  if ($('#dlg-progress').open) $('#dlg-progress').close();
  drill.mode = 'review';
  drill.key = null;
  drillNext();
  openDialog('#dlg-drill');
}

function renderProgress() {
  const players = [...state.players].sort((a, b) => a.isBot - b.isBot);
  const rows = players
    .map((p) => {
      const net = netOf(p);
      const { decisions: n, correct: c } = p.stats;
      const acc = p.isBot ? '<span class="muted">—</span>' : n ? `${Math.round((c / n) * 100)}% <span class="muted">(${c}/${n})</span>` : '<span class="muted">—</span>';
      return `<tr>
        <td><span class="who-cell"><span class="dot" style="--c:${p.color}"></span>${esc(p.name)}${p.isBot ? ' <span class="tag">bot</span>' : ''}</span></td>
        <td>${fmt(p.bankroll)}</td>
        <td class="${net > 0 ? 'up' : net < 0 ? 'down' : ''}">${signed(net)}</td>
        <td>${p.stats.hands}</td>
        <td>${acc}</td>
      </tr>`;
    })
    .join('');
  const all = reviewStats().sort((a, b) => b.misses - a.misses || a.streak - b.streak);
  const top = all.slice(0, 8);
  const pending = all.filter((e) => !e.mastered).length;
  const recent = state.log.slice(0, 40);
  $('#progress-body').innerHTML = `
    <div class="table-scroll"><table>
      <thead><tr><th>Jugador</th><th>Saldo</th><th>Resultado</th><th>Manos</th><th>Acierto</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <h3>Errores más comunes</h3>
    ${top.length
      ? `<ul class="list">${top
          .map(
            (m) => `<li><span class="n">${m.misses}×</span><span class="grow">${esc(m.desc)}${m.many ? ' <span class="muted">· más de 2 cartas</span>' : ''}</span><span>lo correcto: <b>${LABELS[m.rec]}</b></span>${
              m.mastered ? '<span class="pill ok">Dominada</span>' : `<span class="pill" title="Aciertos seguidos desde el último fallo">${m.streak}/${MASTER}</span>`
            }</li>`,
          )
          .join('')}</ul>
         <div class="btn-row">${
           pending
             ? `<button class="btn primary small" data-action="open-review">Repasar mis errores (${pending})</button><span class="muted small">Cada mano sale hasta que la aciertes ${MASTER} veces seguidas.</span>`
             : '<span class="muted small">Dominaste todos tus errores. Los nuevos fallos aparecerán aquí.</span>'
         }</div>`
      : '<p class="empty-note">Todavía no hay errores registrados.</p>'}
    <h3>Últimas decisiones</h3>
    ${recent.length
      ? `<ul class="list scroll-list">${recent
          .map((l) => `<li class="${l.ok ? 'ok' : 'bad'}">${l.ok ? ICON.check : ICON.cross}<span class="dot" style="--c:${l.color}"></span><span class="grow">${esc(l.desc)}</span><span>${LABELS[l.chosen]}${l.ok ? '' : ` → <b>${LABELS[l.rec]}</b>`}</span></li>`)
          .join('')}</ul>`
      : '<p class="empty-note">Juega una mano o usa la práctica rápida para empezar el historial.</p>'}
    <div class="btn-row"><button class="btn ghost small danger" data-action="clear-log" ${state.log.length ? '' : 'disabled'}>Borrar historial</button></div>`;
}

/* ───────────────────────── Práctica rápida ───────────────────────── */

const drill = { mode: 'random', key: null, opts: null, cards: [], up: null, rec: null, answer: null, mastered: false, n: 0, ok: 0, streak: 0, best: 0, timer: 0 };

const rnd = (n) => Math.floor(randomUnit() * n);
const randCard = (ranks = RANKS) => ({ rank: ranks[rnd(ranks.length)], suit: SUITS[rnd(4)], id: uid('d') });

function drillNext() {
  clearTimeout(drill.timer);
  drill.answer = null;
  drill.mastered = false;
  if (drill.mode === 'review') return drillReview();
  drill.key = null;
  const roll = randomUnit();
  const noAce = RANKS.filter((r) => r !== 'A');
  let cards;
  if (roll < 0.3) {
    // Cada pareja (2-2 … 10-10, A-A) sale con la misma frecuencia.
    const kinds = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T'];
    const k = kinds[rnd(kinds.length)];
    const r = k === 'T' ? tenRank() : k;
    cards = [{ rank: r, suit: SUITS[rnd(4)] }, { rank: r, suit: SUITS[rnd(4)] }];
  } else if (roll < 0.55) {
    cards = [{ rank: 'A', suit: SUITS[rnd(4)] }, randCard(['2', '3', '4', '5', '6', '7', '8', '9'])];
  } else {
    // Duras: se descartan las parejas y casi todas las manos triviales (18 o más).
    for (;;) {
      cards = [randCard(noAce), randCard(noAce)];
      const t = handValue(cards).total;
      if (isPair(cards) || (t >= 18 && randomUnit() > 0.15)) continue;
      break;
    }
  }
  dealDrill(cards, randCard(), { canDouble: true, canSplit: isPair(cards), canSurrender: S().surrender });
}

/** Elige una situación fallada: las más falladas y menos dominadas salen más seguido. */
function drillReview() {
  const deck = pendingReview();
  if (!deck.length) {
    drill.key = null;
    drill.cards = [];
    renderDrill();
    return;
  }
  const pool = deck.length > 1 ? deck.filter((e) => e.key !== drill.key) : deck;
  const weights = pool.map((e) => e.misses * (MASTER - e.streak));
  let r = randomUnit() * weights.reduce((a, b) => a + b, 0);
  let pick = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      pick = pool[i];
      break;
    }
  }
  const sit = situationOf(pick.sample || { desc: pick.desc });
  drill.key = pick.key;
  dealDrill(
    sit.cards.map((rank) => ({ rank, suit: SUITS[rnd(4)] })),
    { rank: sit.up, suit: SUITS[rnd(4)] },
    sit.opts,
  );
}

function dealDrill(cards, up, opts) {
  const t = performance.now();
  drill.cards = cards.map((c, i) => ({ ...c, id: uid('d'), at: t + 120 * (i + 1) }));
  drill.up = { ...up, id: uid('d'), at: t };
  drill.opts = { canDouble: !!opts.canDouble, canSplit: !!opts.canSplit, canSurrender: !!opts.canSurrender && S().surrender };
  drill.rec = bestAction(drill.cards, drill.up, { ...drill.opts, h17: S().h17, das: S().das, noPeek: noPeekFor(drill.up) });
  sfx.card(-0.3);
  drill.cards.forEach((_, i) => sfx.card(0.3, 0.12 * (i + 1)));
  renderDrill();
}

function drillAnswer(act) {
  if (!drill.cards.length || drill.answer || !isLegal(act, { ...drill.opts, canHit: true })) return;
  const ok = act === drill.rec.action;
  drill.answer = act;
  drill.n++;
  feedbackSound(ok);
  if (ok) {
    drill.ok++;
    drill.streak++;
    drill.best = Math.max(drill.best, drill.streak);
  } else drill.streak = 0;
  const up = drill.up.rank === 'A' ? 'As' : String(cardValue(drill.up));
  state.log.unshift({
    ok,
    player: 'Práctica',
    color: '#e6b65c',
    desc: `${describeHand(drill.cards)} vs ${up}`,
    chosen: act,
    rec: drill.rec.action,
    reason: drill.rec.reason,
    cards: drill.cards.map((c) => c.rank),
    up: drill.up.rank,
    opts: drill.opts,
  });
  state.log = state.log.slice(0, LOG_MAX);
  if (drill.mode === 'review' && ok) {
    const e = reviewStats().find((x) => x.key === drill.key);
    drill.mastered = !!e && e.mastered;
  }
  save();
  renderDrill();
  renderCoach();
  if (ok) drill.timer = setTimeout(() => $('#dlg-drill').open && drillNext(), delay(drill.mastered ? 1600 : 900));
}

function renderDrill() {
  const pending = pendingReview();
  const review = drill.mode === 'review';
  const tabs = `<div class="tabs drill-tabs" role="tablist">
    <button role="tab" data-action="drill-mode" data-mode="random" class="${review ? '' : 'on'}" aria-selected="${!review}">Al azar</button>
    <button role="tab" data-action="drill-mode" data-mode="review" class="${review ? 'on' : ''}" aria-selected="${review}">Mis errores <span class="count">${pending.length}</span></button>
  </div>`;
  if (review && !drill.cards.length) {
    $('#drill-body').innerHTML = `${tabs}
      <div class="drill-empty">
        <p><b>No tienes errores pendientes.</b></p>
        <p class="muted">Cada mano que falles en la mesa o aquí aparece en este repaso hasta que la aciertes ${MASTER} veces seguidas.</p>
        <button class="btn primary" data-action="drill-mode" data-mode="random">Practicar al azar</button>
      </div>`;
    return;
  }
  const o = { ...drill.opts, canHit: true };
  const a = drill.answer;
  const ok = a && a === drill.rec.action;
  const keys = S().surrender ? ['H', 'S', 'D', 'P', 'R'] : ['H', 'S', 'D', 'P'];
  const btn = (k) => {
    let cls = '';
    if (a && k === drill.rec.action) cls = ' rec';
    else if (a && k === a) cls = ' wrong';
    return `<button class="btn act${cls}" data-action="drill-act" data-act="${k}" ${isLegal(k, o) && !a ? '' : 'disabled'}>${ACTIONS[k]} <kbd>${k}</kbd></button>`;
  };
  let stats;
  if (review) {
    const e = reviewStats().find((x) => x.key === drill.key);
    const streak = e ? e.streak : 0;
    const dots = Array.from({ length: MASTER }, (_, i) => `<i class="${i < streak ? 'on' : ''}"></i>`).join('');
    stats = `<div class="drill-stats"><span>Pendientes <b>${pending.length}</b></span>${
      e ? `<span>Fallada <b>${e.misses}</b> ${e.misses === 1 ? 'vez' : 'veces'}</span><span class="dots" title="${streak} de ${MASTER} aciertos seguidos">${dots}</span>` : ''
    }</div>`;
  } else {
    const pct = drill.n ? Math.round((drill.ok / drill.n) * 100) : 0;
    stats = `<div class="drill-stats"><span>Aciertos <b>${drill.ok} de ${drill.n}</b> (${pct}%)</span><span>Racha <b>${drill.streak}</b></span><span>Mejor racha <b>${drill.best}</b></span></div>`;
  }
  let note;
  if (drill.cards.length > 2) note = 'Ya tienes más de dos cartas: no puedes doblar ni rendirte.';
  else if (!drill.opts.canDouble) note = 'En esta mano no se podía doblar.';
  else note = `Es la primera decisión de la mano, así que puedes doblar${drill.opts.canSurrender ? ' o rendirte' : ''}.`;
  let result = `<p class="muted small">${note}</p>`;
  if (a) {
    const card = ok
      ? drill.mastered
        ? coachCard('ok', ICON.check, `¡Dominada! ${MASTER} aciertos seguidos`, drill.rec.reason, false)
        : coachCard('ok', ICON.check, `Correcto, ${ACTIONS[a].toLowerCase()}`, drill.rec.reason, false)
      : coachCard('bad', ICON.cross, `Era ${ACTIONS[drill.rec.action].toLowerCase()}, no ${ACTIONS[a].toLowerCase()}`, drill.rec.reason, false);
    result = `${card}<div class="row" style="justify-content:flex-end"><button class="btn primary" data-action="drill-next">Siguiente <kbd>Espacio</kbd></button></div>`;
  }
  $('#drill-body').innerHTML = `${tabs}${stats}
    <div class="drill-felt">
      <div class="drill-side"><span>Crupier</span><div class="cards">${cardHTML(drill.up)}</div></div>
      <div class="drill-side"><span>Tú · ${describeHand(drill.cards)}</span><div class="cards">${drill.cards.map((c) => cardHTML(c)).join('')}</div></div>
    </div>
    <div class="row actions" role="group" aria-label="Jugadas">${keys.map(btn).join('')}</div>
    ${result}`;
}

/* ───────────────────────── Tabla de estrategia ───────────────────────── */

const C = (rank) => ({ rank: String(rank), suit: '♠' });
const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'A'];
let chartTab = 'hard';

function cellCode(cards, up, canSplit = true) {
  const upCard = C(up === 10 ? 'K' : up);
  const base = { canDouble: true, canSplit, canSurrender: S().surrender, h17: S().h17, das: S().das, noPeek: noPeekFor(upCard) };
  const r = bestAction(cards, upCard, base);
  if (r.action === 'D') {
    const f = bestAction(cards, upCard, { ...base, canDouble: false }).action;
    return f === 'S' ? 'Ds' : 'D';
  }
  if (r.action === 'R') {
    const f = bestAction(cards, upCard, { ...base, canSurrender: false }).action;
    return f === 'P' ? 'Rp' : f === 'S' ? 'Rs' : 'Rh';
  }
  return r.action;
}

function rowsFor(tab) {
  if (tab === 'hard') {
    return [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((t) => ({
      key: `h${t}`,
      label: t === 5 ? '5 o menos' : t === 20 ? '20 o más' : String(t),
      cards: t >= 12 ? [C(10), C(t - 10)] : [C(2), C(t - 2)],
      noSplit: true,
    }));
  }
  if (tab === 'soft') {
    return [2, 3, 4, 5, 6, 7, 8, 9].map((k) => ({ key: `s${k + 11}`, label: `A-${k} <span class="muted">(${k + 11})</span>`, cards: [C('A'), C(k)] }));
  }
  return [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => ({
    key: `p${k}`,
    label: k === 11 ? 'A-A' : k === 10 ? '10-10' : `${k}-${k}`,
    cards: k === 11 ? [C('A'), C('A')] : [C(k === 10 ? 'K' : k), C(k === 10 ? 'K' : k)],
  }));
}

function currentCell() {
  const cur = currentHumanHand();
  if (!cur || state.pending.kind === 'insurance') return null;
  const up = cardValue(state.dealer.cards[0]);
  const col = up === 11 ? 'A' : up;
  const { total, soft } = handValue(cur.hand.cards);
  if (isPair(cur.hand.cards) && state.pending.o.canSplit) return { tab: 'pairs', key: `p${cardValue(cur.hand.cards[0])}`, col };
  if (soft && total >= 13 && total <= 20) return { tab: 'soft', key: `s${total}`, col };
  return { tab: 'hard', key: `h${Math.max(5, Math.min(total, 20))}`, col };
}

function renderChart() {
  const cur = currentCell();
  const rows = rowsFor(chartTab);
  const head = `<tr><th>Tú \\ Crupier</th>${UPS.map((u) => `<th class="${cur && cur.col === u ? 'hl-col' : ''}">${u}</th>`).join('')}</tr>`;
  const body = rows
    .map((row) => {
      const tds = UPS.map((u) => {
        const code = cellCode(row.cards, u, !row.noSplit);
        const hl = cur && cur.tab === chartTab && cur.key === row.key && cur.col === u;
        return `<td class="k-${code}${hl ? ' hl' : ''}">${code}</td>`;
      }).join('');
      const rowHl = cur && cur.tab === chartTab && cur.key === row.key;
      return `<tr class="${rowHl ? 'hl-row' : ''}"><th>${row.label}</th>${tds}</tr>`;
    })
    .join('');
  $('#chart-tabs').querySelectorAll('button').forEach((b) => {
    const on = b.dataset.tab === chartTab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  $('#chart-table').innerHTML = `<table class="chart"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  const s = S();
  const peek = s.peek === 'ace' ? ` · el crupier solo revisa con As${s.noPeekLoss === 'all' ? ' (con figura se pierde todo)' : ''}` : '';
  $('#chart-rules').textContent = `${s.decks} ${s.decks === 1 ? 'mazo' : 'mazos'} · ${s.h17 ? 'el crupier pide con 17 suave' : 'el crupier se planta en 17 suave'} · ${s.das ? 'doblar tras dividir' : 'sin doblar tras dividir'} · ${s.surrender ? 'rendición tardía' : 'sin rendición'}${peek}`;
}

function openChart() {
  const cur = currentCell();
  if (cur) chartTab = cur.tab;
  renderChart();
  $('#dlg-chart').showModal();
}

/* ───────────────────────── Jugadores y reglas ───────────────────────── */

function renderPlayersForm() {
  const busy = state.phase !== 'betting';
  $('#players-list').innerHTML = state.players
    .map(
      (p) => `
    <div class="pl-row" data-pid="${p.id}">
      <span class="dot" style="--c:${p.color}"></span>
      <input class="pl-name" value="${esc(p.name)}" aria-label="Nombre" maxlength="18" autocomplete="off">
      <label class="pl-bank"><span>Saldo</span><input type="number" min="0" step="5" inputmode="decimal" class="pl-bankroll" value="${Math.round(p.bankroll * 100) / 100}" ${busy ? 'disabled' : ''}></label>
      <label class="pl-bot"><input type="checkbox" class="pl-isbot" ${p.isBot ? 'checked' : ''} ${busy ? 'disabled' : ''}> Bot</label>
      <div class="pl-actions">
        <button class="btn ghost small" data-action="reset-stats" data-pid="${p.id}">Reiniciar estadísticas</button>
        <button class="btn ghost small danger" data-action="del-player" data-pid="${p.id}" ${busy || state.players.length <= 1 ? 'disabled' : ''}>Eliminar</button>
      </div>
    </div>`,
    )
    .join('');
  $('#players-busy').hidden = !busy;
}

function readPlayersForm() {
  document.querySelectorAll('.pl-row').forEach((row) => {
    const p = getPlayer(row.dataset.pid);
    if (!p) return;
    p.name = row.querySelector('.pl-name').value.trim() || p.name;
    if (state.phase === 'betting') {
      const b = Number(row.querySelector('.pl-bankroll').value);
      if (Number.isFinite(b) && b >= 0 && Math.abs(b - p.bankroll) > 0.001) {
        p.bankroll = b;
        p.startBankroll = b;
        p.rebuys = 0;
      }
      p.isBot = row.querySelector('.pl-isbot').checked;
    }
  });
  for (const seat of state.seats) {
    const p = seat.playerId && getPlayer(seat.playerId);
    if (p && committedBy(p.id) > p.bankroll) seat.bet = 0;
  }
  botBets(false);
  pickSelectedSeat();
}

const RULE_FIELDS = ['decks', 'h17', 'das', 'surrender', 'maxHands', 'resplitAces', 'hitSplitAces', 'bjPays', 'peek', 'noPeekLoss', 'minBet', 'maxBet', 'penetration', 'showHint', 'feedback', 'showCount', 'speed', 'decisionTime', 'sound', 'volume', 'feedbackSound', 'voice'];
const TEXT_FIELDS = ['peek', 'noPeekLoss'];

function fillRules() {
  const f = $('#rules-form');
  for (const k of RULE_FIELDS) {
    const input = f.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = !!S()[k];
    else input.value = String(S()[k]);
  }
  const busy = state.phase !== 'betting';
  f.querySelectorAll('[data-round-lock]').forEach((el) => {
    el.disabled = busy;
  });
  $('#rules-busy').hidden = !busy;
  f.elements.voice.disabled = !sfx.hasVoice();
  syncPeekField();
}

function readRules() {
  const f = $('#rules-form');
  const prevDecks = S().decks;
  const prevPen = S().penetration;
  for (const k of RULE_FIELDS) {
    const input = f.elements[k];
    if (!input || input.disabled) continue;
    if (input.type === 'checkbox') state.settings[k] = input.checked;
    else state.settings[k] = TEXT_FIELDS.includes(k) ? input.value : Number(input.value);
  }
  const s = state.settings;
  s.minBet = Math.max(1, s.minBet || 1);
  s.maxBet = Math.max(s.minBet, s.maxBet || s.minBet);
  if (s.decks !== prevDecks || s.penetration !== prevPen) state.needShuffle = true;
  if (state.phase === 'betting') {
    for (const seat of state.seats) {
      if (!isHumanSeat(seat)) continue;
      if (seat.bet > s.maxBet) seat.bet = s.maxBet;
      if (seat.bet > 0 && seat.bet < s.minBet) {
        const p = getPlayer(seat.playerId);
        seat.bet = p.bankroll - committedBy(p.id) + seat.bet >= s.minBet ? s.minBet : 0;
      }
    }
    botBets(false);
  }
}

/** «Qué se pierde» solo aplica si el crupier no revisa con figura. */
function syncPeekField() {
  const f = $('#rules-form');
  f.elements.noPeekLoss.disabled = f.elements.peek.disabled || f.elements.peek.value !== 'ace';
}

function applyProfile(name) {
  const f = $('#rules-form');
  const prof = PROFILES[name];
  if (!prof || state.phase !== 'betting') return;
  for (const [k, v] of Object.entries(prof)) {
    const input = f.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = String(v);
  }
  syncPeekField();
}

/* ───────────────────────── Eventos ───────────────────────── */

function clearBet() {
  const seat = state.seats[state.selectedSeat];
  if (state.phase === 'betting' && isHumanSeat(seat)) {
    if (seat.bet) sfx.collect(panFor(state.selectedSeat));
    seat.bet = 0;
    state.notice = '';
    render();
  }
}

function openDialog(id) {
  $(id).showModal();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  switch (a) {
    case 'pick-chip':
      state.chip = Number(el.dataset.v);
      sfx.pick();
      renderControls();
      renderDockInfo();
      break;
    case 'deal':
      deal();
      break;
    case 'clear-bet':
      clearBet();
      break;
    case 'rebuy': {
      // Recargar cuenta como recompra: el resultado neto la descuenta.
      const seat = state.seats[state.selectedSeat];
      const p = isHumanSeat(seat) && getPlayer(seat.playerId);
      if (!p || state.phase !== 'betting') break;
      p.bankroll += p.startBankroll || 1000;
      p.rebuys = (p.rebuys || 0) + 1;
      state.notice = '';
      sfx.payout(panFor(state.selectedSeat));
      save();
      render();
      break;
    }
    case 'max-bet': {
      const seat = state.seats[state.selectedSeat];
      if (isHumanSeat(seat)) setBet(Infinity, { cascade: true, max: true });
      break;
    }
    case 'double-bet': {
      const seat = state.seats[state.selectedSeat];
      if (isHumanSeat(seat)) addChip(seat.bet || S().minBet, { double: true });
      break;
    }
    case 'select-seat': {
      // Tocar un círculo propio pone ahí la ficha marcada, como en las mesas en vivo.
      const si = Number(el.dataset.seat);
      if (state.phase !== 'betting' || !isHumanSeat(state.seats[si])) break;
      state.selectedSeat = si;
      state.notice = '';
      addChip(activeChip());
      break;
    }
    case 'sit-open': {
      const sel = document.querySelector(`select[data-sit="${el.dataset.seat}"]`);
      if (!sel) break;
      try {
        sel.showPicker();
      } catch {
        sel.focus();
      }
      break;
    }
    case 'leave':
      sit(Number(el.dataset.seat), null);
      break;
    case 'act':
      humanAct(el.dataset.act);
      break;
    case 'hint':
      state.hintShown = true;
      render();
      break;
    case 'toggle-sound':
      toggleSound();
      break;
    case 'coach-toggle':
      coachOpen = !coachOpen;
      $('#coach').classList.toggle('open', coachOpen);
      break;
    case 'drill':
      if (!drill.cards.length || drill.answer) drillNext();
      else renderDrill();
      openDialog('#dlg-drill');
      break;
    case 'drill-act':
      drillAnswer(el.dataset.act);
      break;
    case 'drill-next':
      drillNext();
      break;
    case 'drill-mode':
      drill.mode = el.dataset.mode;
      drill.key = null;
      drillNext();
      break;
    case 'open-review':
      openReview();
      break;
    case 'open-progress':
      renderProgress();
      openDialog('#dlg-progress');
      break;
    case 'clear-log':
      state.log = [];
      state.feedback = null;
      save();
      render();
      if ($('#dlg-progress').open) renderProgress();
      break;
    case 'chart':
      openChart();
      break;
    case 'chart-tab':
      chartTab = el.dataset.tab;
      renderChart();
      break;
    case 'open-players':
      renderPlayersForm();
      openDialog('#dlg-players');
      break;
    case 'open-rules':
      fillRules();
      openDialog('#dlg-rules');
      break;
    case 'add-player':
    case 'add-bot': {
      readPlayersForm();
      const bot = a === 'add-bot';
      const n = state.players.filter((p) => p.isBot === bot).length + 1;
      const names = ['Ana', 'Leo', 'Sol', 'Max', 'Eva', 'Teo', 'Lía', 'Gus'];
      state.players.push(newPlayer(bot ? `Bot ${names[(n - 1) % names.length]}` : `Jugador ${n}`, bot, state.players.length));
      renderPlayersForm();
      save();
      render();
      break;
    }
    case 'del-player': {
      if (state.players.length <= 1) break;
      readPlayersForm();
      const id = el.dataset.pid;
      state.players = state.players.filter((p) => p.id !== id);
      state.seats.forEach((s) => {
        if (s.playerId === id) {
          s.playerId = null;
          s.bet = 0;
          s.hands = [];
        }
      });
      pickSelectedSeat();
      renderPlayersForm();
      save();
      render();
      break;
    }
    case 'reset-stats': {
      const p = getPlayer(el.dataset.pid);
      if (!p) break;
      p.stats = { decisions: 0, correct: 0, hands: 0 };
      p.startBankroll = p.bankroll;
      p.rebuys = 0;
      state.log = state.log.filter((l) => l.player !== p.name);
      if (state.feedback && state.feedback.player === p.name) state.feedback = null;
      save();
      render();
      break;
    }
    case 'save-players':
      readPlayersForm();
      save();
      $('#dlg-players').close();
      render();
      break;
    case 'save-rules':
      readRules();
      applySound();
      renderSoundButton();
      renderPrint.key = '';
      save();
      $('#dlg-rules').close();
      render();
      break;
    case 'profile':
      applyProfile(el.dataset.profile);
      break;
    case 'reset-rules':
      state.settings = { ...DEFAULT_SETTINGS };
      fillRules();
      break;
    case 'close':
      el.closest('dialog').close();
      break;
    case 'reset-all':
      if (state.phase === 'betting' && confirm('¿Borrar jugadores, saldos, estadísticas y reglas guardadas?')) {
        try {
          localStorage.removeItem(STORE);
        } catch {
          /* nada */
        }
        location.reload();
      }
      break;
  }
});

document.addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-sit]');
  if (sel) sit(Number(sel.dataset.sit), sel.value);
  const bet = e.target.closest('[data-bet-input]');
  if (bet) {
    bet.blur();
    setBet(bet.value);
  }
});
// Enter en el monto confirma la apuesta.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-bet-input]')) {
    e.preventDefault();
    e.target.blur();
  }
});

// Cerrar un diálogo al tocar fuera de él.
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  });
});
$('#dlg-drill').addEventListener('close', () => clearTimeout(drill.timer));

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if ($('#dlg-drill').open) {
    if (['h', 's', 'd', 'p', 'r'].includes(k)) {
      drillAnswer(k.toUpperCase());
      e.preventDefault();
    } else if ((k === ' ' || k === 'enter') && drill.answer) {
      drillNext();
      e.preventDefault();
    }
    return;
  }
  if (k === 'm' && !document.querySelector('dialog[open]')) {
    toggleSound();
    return;
  }
  if (k === 't') {
    const d = $('#dlg-chart');
    if (d.open) d.close();
    else if (!document.querySelector('dialog[open]')) openChart();
    e.preventDefault();
    return;
  }
  if (document.querySelector('dialog[open]')) return;
  if (state.pending && ['h', 's', 'd', 'p', 'r', 'i', 'n'].includes(k)) {
    humanAct(k.toUpperCase());
    e.preventDefault();
    return;
  }
  if (e.key === '?' && state.pending) {
    state.hintShown = true;
    render();
    return;
  }
  if (state.phase !== 'betting') return;
  if (k === ' ' || k === 'enter') {
    if (e.target.closest('button') && k === 'enter') return;
    e.preventDefault();
    deal();
  } else if (/^[1-5]$/.test(k)) {
    state.chip = chipSet()[Number(k) - 1];
    addChip(state.chip);
  } else if (k === 'backspace' || k === 'delete') {
    e.preventDefault();
    clearBet();
  }
});

function toggleSound() {
  state.settings.sound = !S().sound;
  applySound();
  renderSoundButton();
  save();
  if (S().sound) sfx.chips(2);
}

function renderSoundButton() {
  const b = $('#sound-btn');
  const on = S().sound;
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Silenciar (M)' : 'Activar el sonido (M)';
  b.querySelector('.on').style.display = on ? '' : 'none';
  b.querySelector('.off').style.display = on ? 'none' : '';
}

// El navegador solo permite audio después del primer toque o tecla.
function unlockAudio() {
  sfx.unlock();
  removeEventListener('pointerdown', unlockAudio, true);
  removeEventListener('keydown', unlockAudio, true);
}
addEventListener('pointerdown', unlockAudio, true);
addEventListener('keydown', unlockAudio, true);

// Al mover el volumen se escucha una ficha para comparar.
$('#rules-form').elements.volume.addEventListener('input', (e) => {
  sfx.configure({ enabled: true, volume: Number(e.target.value), voice: false });
  sfx.chips(1);
});
$('#dlg-rules').addEventListener('close', applySound);
$('#rules-form').elements.peek.addEventListener('change', syncPeekField);

load();
applySound();
renderSoundButton();
buildShoe();
render();
let resizeTimer = 0;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    fitSeats();
    lastFocus = '';
    keepSeatInView();
  }, 80);
});

// Solo para pruebas: ?debug expone el estado en la consola.
if (new URLSearchParams(location.search).has('debug')) window.mesa21 = { state, render, buildShoe, drill };
