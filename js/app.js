import { ACTIONS, bestAction, cardValue, handValue, isBlackjack, isPair } from './strategy.js';

/* ───────────────────────── Configuración y estado ───────────────────────── */

const SEATS = 7;
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CHIPS = [5, 25, 100, 500, 1000];
const COLORS = ['#e8b04b', '#5fb3e8', '#ef7a62', '#8fd17a', '#c48be8', '#ec8fc2', '#6fdccd', '#e6dc7a'];
const STORE = 'bj-entrenador-v1';
const LOG_MAX = 300;

const DEFAULT_SETTINGS = {
  decks: 6,
  h17: false,
  das: true,
  surrender: true,
  maxHands: 5,
  resplitAces: true,
  hitSplitAces: false,
  bjPays: 1.5,
  minBet: 10,
  maxBet: 5000,
  penetration: 0, // 0 = corte aleatorio entre el 45% y el 55% del zapato
  showHint: false,
  feedback: true,
  showCount: false,
  speed: 1, // 0 rápido · 1 normal · 2 lento
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  players: [],
  seats: Array.from({ length: SEATS }, () => ({ playerId: null, bet: 0, hands: [] })),
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
  message: '',
};

let uidN = 0;
const uid = (p = 'id') => `${p}${Date.now().toString(36)}${(uidN++).toString(36)}`;

function defaultPlayers() {
  return [
    newPlayer('Jugador 1', false, 0),
    newPlayer('Bot Ana', true, 1),
    newPlayer('Bot Leo', true, 2),
  ];
}

function newPlayer(name, isBot, colorIdx, bankroll = 1000) {
  return {
    id: uid('p'),
    name,
    isBot,
    color: COLORS[colorIdx % COLORS.length],
    bankroll,
    startBankroll: bankroll,
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
    state.players = data.players;
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
  const firstHuman = state.seats.findIndex((s) => isHumanSeat(s));
  state.selectedSeat = firstHuman >= 0 ? firstHuman : null;
}

const getPlayer = (id) => state.players.find((p) => p.id === id);
const isHumanSeat = (seat) => {
  const p = seat.playerId && getPlayer(seat.playerId);
  return !!p && !p.isBot;
};
const S = () => state.settings;
const delay = (base) => base * [0.35, 1, 1.8][S().speed ?? 1];
const wait = (ms) => new Promise((r) => setTimeout(r, delay(ms)));

const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const fmt = (n) => money.format(n).replace('US', '');

/* ───────────────────────── Zapato y cuenta Hi-Lo ───────────────────────── */

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

function draw(faceUp = true) {
  if (!state.shoe.length) buildShoe();
  const c = state.shoe.pop();
  c.fresh = true;
  if (faceUp) countCard(c);
  return c;
}

function randomUnit() {
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  return r[0] / 2 ** 32;
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

function botBets() {
  for (const seat of state.seats) {
    const p = seat.playerId && getPlayer(seat.playerId);
    if (!p || !p.isBot) continue;
    if (p.bankroll < S().minBet) {
      p.bankroll += p.startBankroll || 1000;
      p.rebuys = (p.rebuys || 0) + 1;
    }
    const units = [1, 1, 2, 2, 3, 5][Math.floor(Math.random() * 6)];
    const committed = state.seats.filter((s) => s !== seat && s.playerId === p.id).reduce((a, s) => a + s.bet, 0);
    seat.bet = Math.max(0, Math.min(S().minBet * units, S().maxBet, p.bankroll - committed));
    if (seat.bet < S().minBet) seat.bet = 0;
  }
}

function committedBy(playerId) {
  return state.seats.filter((s) => s.playerId === playerId).reduce((a, s) => a + s.bet, 0);
}

async function deal() {
  if (state.phase !== 'betting') return;
  botBets();
  const active = state.seats.filter((s) => s.playerId && s.bet >= S().minBet);
  if (!active.length) {
    flash(`Pon al menos ${fmt(S().minBet)} en un puesto para repartir.`);
    return;
  }
  for (const p of state.players) {
    if (committedBy(p.id) > p.bankroll + 1e-9) {
      flash(`${p.name} no tiene saldo para cubrir sus apuestas.`);
      return;
    }
  }
  const low = state.seats.find((s) => s.playerId && s.bet > 0 && s.bet < S().minBet);
  if (low) {
    flash(`La apuesta mínima es ${fmt(S().minBet)}.`);
    return;
  }

  if (state.needShuffle || !state.shoe.length) {
    buildShoe();
    flash('Barajando un zapato nuevo…');
  } else state.message = '';

  state.phase = 'dealing';
  state.feedback = null;
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

  for (let round = 0; round < 2; round++) {
    for (const seat of state.seats) {
      if (!seat.hands.length) continue;
      await wait(260);
      seat.hands[0].cards.push(draw());
      render();
    }
    await wait(260);
    state.dealer.cards.push(draw(round === 0));
    render();
  }

  for (const seat of state.seats) {
    for (const h of seat.hands) if (isBlackjack(h.cards)) { h.natural = true; h.done = true; }
  }

  const up = state.dealer.cards[0];
  let dealerBJ = false;
  if (up.rank === 'A') await offerInsurance();
  if (cardValue(up) >= 10) {
    await wait(450);
    dealerBJ = isBlackjack(state.dealer.cards);
    if (dealerBJ) {
      revealHole();
      flash('El crupier tiene Blackjack.');
    } else {
      flash('El crupier revisó: no tiene Blackjack.');
    }
    render();
  }

  if (!dealerBJ) {
    state.phase = 'playing';
    await playSeats();
    state.phase = 'dealer';
    await dealerPlay();
  }
  settle();
  if (state.shoe.length <= state.cutAt) {
    state.needShuffle = true;
    state.message = 'Salió la carta de corte: se baraja en la próxima ronda.';
  }
  state.phase = 'betting';
  state.turn = null;
  for (const seat of state.seats) {
    const p = seat.playerId && getPlayer(seat.playerId);
    if (!p) continue;
    if (!p.isBot) {
      const others = committedBy(p.id) - seat.bet;
      seat.bet = Math.min(seat.lastBet || seat.bet, Math.max(0, p.bankroll - others));
      if (seat.bet < S().minBet) seat.bet = 0;
    }
  }
  save();
  render();
}

async function playSeats() {
  for (let si = 0; si < SEATS; si++) {
    const seat = state.seats[si];
    if (!seat.hands.length) continue;
    const player = getPlayer(seat.playerId);
    for (let hi = 0; hi < seat.hands.length; hi++) {
      const hand = seat.hands[hi];
      state.turn = { si, hi };
      state.hintShown = false;
      if (hand.cards.length === 1) {
        render();
        await wait(300);
        hand.cards.push(draw());
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
          await wait(650);
          act = rec.action;
        } else {
          act = await askHuman(o, rec);
          judge(player, si, hi, hand, act, rec);
        }
        await apply(seat, hi, act, player);
        render();
      }
      await wait(200);
    }
  }
  state.turn = null;
}

function askHuman(o, rec) {
  return new Promise((resolve) => {
    state.pending = { o, rec, resolve };
    render();
  });
}

const INSURANCE_REASON =
  'El seguro es una apuesta aparte: paga 2 a 1 si el crupier tiene Blackjack, pero eso pasa menos de 1 de cada 3 veces. A la larga pierde dinero, así que la estrategia básica nunca lo toma, ni siquiera el "pago igual" con tu Blackjack.';

async function offerInsurance() {
  for (let si = 0; si < SEATS; si++) {
    const seat = state.seats[si];
    const hand = seat.hands[0];
    if (!hand || !isHumanSeat(seat)) continue;
    const player = getPlayer(seat.playerId);
    const cost = hand.bet / 2;
    if (player.bankroll < cost) continue;
    state.turn = { si, hi: 0 };
    const take = await new Promise((resolve) => {
      state.pending = { kind: 'insurance', cost, resolve };
      render();
    });
    if (take) {
      player.bankroll -= cost;
      hand.insurance = cost;
    }
    player.stats.decisions++;
    if (!take) player.stats.correct++;
    const entry = {
      ok: !take,
      player: player.name,
      color: player.color,
      seat: si + 1,
      hand: 1,
      desc: `Seguro con ${describeHand(hand.cards)} vs As`,
      key: 'Seguro',
      chosen: take ? 'I' : 'N',
      rec: 'N',
      reason: INSURANCE_REASON,
    };
    state.feedback = entry;
    state.log.unshift(entry);
    state.log = state.log.slice(0, LOG_MAX);
  }
  state.turn = null;
  render();
}

function humanAct(act) {
  const pend = state.pending;
  if (!pend) return;
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

function judge(player, si, hi, hand, act, rec) {
  const ok = act === rec.action;
  player.stats.decisions++;
  if (ok) player.stats.correct++;
  const entry = {
    ok,
    player: player.name,
    color: player.color,
    seat: si + 1,
    hand: hi + 1,
    desc: `${describeHand(hand.cards)} vs ${upLabel()}`,
    chosen: act,
    rec: rec.action,
    reason: rec.reason,
  };
  state.feedback = entry;
  state.log.unshift(entry);
  state.log = state.log.slice(0, LOG_MAX);
}

async function apply(seat, hi, act, player) {
  const hand = seat.hands[hi];
  switch (act) {
    case 'H':
      hand.cards.push(draw());
      break;
    case 'S':
      hand.done = true;
      break;
    case 'D':
      player.bankroll -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      await wait(200);
      hand.cards.push(draw());
      hand.done = true;
      if (handValue(hand.cards).total > 21) hand.bust = true;
      break;
    case 'P': {
      player.bankroll -= hand.bet;
      const moved = hand.cards.pop();
      const aces = moved.rank === 'A';
      hand.fromSplit = true;
      hand.splitAces = aces;
      seat.hands.splice(hi + 1, 0, { cards: [moved], bet: hand.bet, fromSplit: true, splitAces: aces });
      render();
      await wait(320);
      hand.cards.push(draw());
      break;
    }
    case 'R':
      hand.surrendered = true;
      hand.done = true;
      break;
  }
  const total = handValue(hand.cards).total;
  if (total > 21) {
    hand.bust = true;
    hand.done = true;
  }
}

function revealHole() {
  if (!state.dealer.hidden) return;
  state.dealer.hidden = false;
  const hole = state.dealer.cards[1];
  if (hole) {
    countCard(hole);
    hole.fresh = true;
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
      await wait(600);
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
  for (const seat of state.seats) {
    const p = seat.playerId && getPlayer(seat.playerId);
    if (!p) continue;
    for (const h of seat.hands) {
      const t = handValue(h.cards).total;
      let back = 0;
      let kind;
      if (h.surrendered) { back = h.bet / 2; kind = 'sur'; }
      else if (h.natural && seat.hands.length === 1) {
        if (dealerBJ) { back = h.bet; kind = 'push'; }
        else { back = h.bet + h.bet * S().bjPays; kind = 'bj'; }
      } else if (dealerBJ) kind = 'lose';
      else if (h.bust || t > 21) kind = 'bust';
      else if (dealerBust || t > d) { back = h.bet * 2; kind = 'win'; }
      else if (t === d) { back = h.bet; kind = 'push'; }
      else kind = 'lose';
      let net = back - h.bet;
      if (h.insurance) {
        if (dealerBJ) back += h.insurance * 3;
        net += dealerBJ ? h.insurance * 2 : -h.insurance;
      }
      p.bankroll += back;
      h.result = { kind, net, ins: h.insurance ? (dealerBJ ? 'cobra' : 'pierde') : null };
    }
  }
}

function flash(msg) {
  state.message = msg;
  render();
}

/* ───────────────────────── Apuestas y asientos ───────────────────────── */

function addChip(v) {
  if (state.phase !== 'betting') return;
  const seat = state.seats[state.selectedSeat];
  if (!seat || !isHumanSeat(seat)) {
    flash('Elige un puesto tuyo (toca el círculo de apuesta).');
    return;
  }
  const p = getPlayer(seat.playerId);
  const free = p.bankroll - committedBy(p.id);
  const add = Math.min(v, free, S().maxBet - seat.bet);
  if (add <= 0) {
    flash(free <= 0 ? `${p.name} no tiene más saldo libre.` : `Apuesta máxima: ${fmt(S().maxBet)}.`);
    return;
  }
  seat.bet += add;
  state.message = '';
  render();
}

function sit(si, playerId) {
  if (state.phase !== 'betting') return;
  const seat = state.seats[si];
  seat.playerId = playerId || null;
  seat.bet = 0;
  seat.hands = [];
  if (playerId && !getPlayer(playerId).isBot) {
    seat.bet = Math.min(S().minBet, getPlayer(playerId).bankroll - committedBy(playerId));
    if (seat.bet < S().minBet) seat.bet = 0;
    state.selectedSeat = si;
  }
  save();
  render();
}

/* ───────────────────────── Render ───────────────────────── */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function cardHTML(c, opts = {}) {
  if (opts.back) return `<div class="card back${c.fresh ? ' fresh' : ''}" aria-label="carta boca abajo"></div>`;
  const red = c.suit === '♥' || c.suit === '♦';
  const html = `<div class="card${red ? ' red' : ''}${c.fresh ? ' fresh' : ''}${opts.side ? ' side' : ''}" aria-label="${c.rank}${c.suit}">
    <span class="ci">${c.rank}<i>${c.suit}</i></span><span class="cs">${c.suit}</span></div>`;
  return html;
}

function totalLabel(cards) {
  if (!cards.length) return '';
  const { total, soft } = handValue(cards);
  if (isBlackjack(cards)) return 'BJ';
  if (total > 21) return `${total}`;
  return soft && total < 21 ? `${total - 10}/${total}` : String(total);
}

const RESULT_TEXT = { win: 'Gana', lose: 'Pierde', bust: 'Se pasa', push: 'Empate', bj: 'Blackjack', sur: 'Rendición' };

function renderDealer() {
  const d = state.dealer;
  const cards = d.cards.map((c, i) => cardHTML(c, { back: i === 1 && d.hidden })).join('');
  let total = '';
  if (d.cards.length) {
    total = d.hidden ? String(cardValue(d.cards[0]) === 11 ? 'A' : cardValue(d.cards[0])) : totalLabel(d.cards);
    const t = handValue(d.cards).total;
    if (!d.hidden && t > 21) total += ' · se pasa';
  }
  $('#dealer').innerHTML = `
    <div class="dealer-cards cards">${cards || '<div class="card ghost"></div><div class="card ghost"></div>'}</div>
    <div class="dealer-total ${total ? '' : 'empty'}">${total || 'Crupier'}</div>`;
}

function renderSeats() {
  const busy = state.phase !== 'betting';
  const html = state.seats.map((seat, si) => {
    const p = seat.playerId && getPlayer(seat.playerId);
    const pos = si - 3;
    const arc = pos * pos * 6;
    const isTurnSeat = state.turn && state.turn.si === si;
    const selected = !busy && state.selectedSeat === si && p && !p.isBot;
    const multi = seat.hands.length > 1 ? ` multi m${Math.min(seat.hands.length, 5)}` : '';

    const hands = seat.hands.map((h, hi) => {
      const active = isTurnSeat && state.turn.hi === hi && !h.done;
      const r = h.result;
      const badge = r ? `<span class="badge ${r.kind}">${RESULT_TEXT[r.kind]}${r.ins ? ` · seguro ${r.ins}` : ''}${r.net ? ` ${r.net > 0 ? '+' : '−'}${fmt(Math.abs(r.net))}` : ''}</span>` : '';
      const cards = h.cards.map((c, ci) => cardHTML(c, { side: h.doubled && ci === h.cards.length - 1 })).join('');
      return `<div class="hand${active ? ' active' : ''}${h.done && !r ? ' done' : ''}${r ? ' res-' + r.kind : ''}">
        <div class="cards">${cards}</div>
        <div class="hand-meta"><span class="total">${totalLabel(h.cards)}</span><span class="hbet">${fmt(h.bet)}</span></div>
        ${badge}
      </div>`;
    }).join('');

    let label;
    if (p) {
      label = `<div class="seat-player">
          <span class="dot" style="background:${p.color}"></span>
          <span class="pname">${esc(p.name)}</span>${p.isBot ? '<span class="bot-tag">bot</span>' : ''}
          ${busy ? '' : `<button class="leave" data-action="leave" data-seat="${si}" title="Levantarse del puesto" aria-label="Levantar a ${esc(p.name)}">×</button>`}
        </div>
        <div class="seat-bank">${fmt(p.bankroll)}</div>`;
    } else {
      const opts = state.players.map((pl) => `<option value="${pl.id}">${esc(pl.name)}${pl.isBot ? ' (bot)' : ''}</option>`).join('');
      label = busy
        ? '<div class="seat-empty">Libre</div>'
        : `<select class="sit" data-sit="${si}" aria-label="Sentar a alguien en el puesto ${si + 1}"><option value="">Sentar…</option>${opts}</select>`;
    }

    const showBet = seat.bet > 0 && (!seat.hands.length || state.phase === 'betting');
    const betChip = showBet ? `<span class="bet-amount">${fmt(seat.bet)}</span>` : seat.hands.length ? '' : '<span class="bet-hint">Apuesta</span>';

    return `<div class="seat${p ? '' : ' empty'}${isTurnSeat ? ' turn' : ''}${selected ? ' selected' : ''}${multi}" style="order:${SEATS - si};--arc:${arc}px;--pc:${p ? p.color : 'transparent'}">
      <div class="seat-hands">${hands}</div>
      <button class="bet-spot${showBet ? ' has-bet' : ''}" data-action="select-seat" data-seat="${si}" ${!p || p.isBot || busy ? 'tabindex="-1"' : ''} aria-label="Puesto ${si + 1}">${betChip}</button>
      <div class="seat-num">Puesto ${si + 1}</div>
      ${label}
    </div>`;
  }).join('');
  $('#seats').innerHTML = html;
}

function currentHumanHand() {
  if (!state.pending || !state.turn) return null;
  const seat = state.seats[state.turn.si];
  return { seat, hand: seat.hands[state.turn.hi], player: getPlayer(seat.playerId) };
}

function renderControls() {
  const el = $('#controls');
  if (state.phase === 'betting') {
    const seat = state.seats[state.selectedSeat];
    const p = seat && isHumanSeat(seat) ? getPlayer(seat.playerId) : null;
    const target = p
      ? `Apostando en <b>Puesto ${state.selectedSeat + 1}</b> · ${esc(p.name)} · libre ${fmt(p.bankroll - committedBy(p.id))}`
      : 'Toca el círculo de apuesta de un puesto tuyo';
    el.innerHTML = `
      <div class="ctl-line">${target}</div>
      <div class="chips">${CHIPS.map((v) => `<button class="chip c${v}" data-action="chip" data-v="${v}" aria-label="Ficha de ${v}">${v >= 1000 ? v / 1000 + 'k' : v}</button>`).join('')}</div>
      <div class="btn-row">
        <button class="btn ghost" data-action="clear-bet">Quitar</button>
        <button class="btn ghost" data-action="double-bet">×2</button>
        <button class="btn primary" data-action="deal">Repartir <kbd>Espacio</kbd></button>
      </div>`;
    return;
  }
  const cur = currentHumanHand();
  if (cur && state.pending.kind === 'insurance') {
    const { hand, player } = cur;
    const showRec = S().showHint || state.hintShown;
    el.innerHTML = `
      <div class="ctl-line"><span class="dot" style="background:${player.color}"></span> <b>${esc(player.name)}</b> · Puesto ${state.turn.si + 1} — <b>${describeHand(hand.cards)}</b> vs <b>As</b>. El crupier ofrece seguro por ${fmt(state.pending.cost)}.</div>
      <div class="btn-row actions">
        <button class="btn act" data-action="act" data-act="I">Tomar seguro <kbd>I</kbd></button>
        <button class="btn act${showRec ? ' rec' : ''}" data-action="act" data-act="N">Sin seguro <kbd>N</kbd></button>
      </div>
      <div class="btn-row"><button class="btn ghost small" data-action="hint">Pista <kbd>?</kbd></button></div>`;
    return;
  }
  if (cur) {
    const { o, rec } = state.pending;
    const { seat, hand, player } = cur;
    const handNo = seat.hands.length > 1 ? ` · mano ${state.turn.hi + 1}/${seat.hands.length}` : '';
    const showRec = S().showHint || state.hintShown;
    const btn = (k, key) => `<button class="btn act${showRec && rec.action === k ? ' rec' : ''}" data-action="act" data-act="${k}" ${isLegal(k, o) ? '' : 'disabled'}>${ACTIONS[k]} <kbd>${key}</kbd></button>`;
    el.innerHTML = `
      <div class="ctl-line"><span class="dot" style="background:${player.color}"></span> <b>${esc(player.name)}</b> · Puesto ${state.turn.si + 1}${handNo} — <b>${describeHand(hand.cards)}</b> vs <b>${upLabel()}</b></div>
      <div class="btn-row actions">
        ${btn('H', 'H')}${btn('S', 'S')}${btn('D', 'D')}${btn('P', 'P')}${btn('R', 'R')}
      </div>
      <div class="btn-row">
        <button class="btn ghost small" data-action="hint">Pista <kbd>?</kbd></button>
        <button class="btn ghost small" data-action="chart">Ver en la tabla <kbd>T</kbd></button>
      </div>`;
    return;
  }
  let status = 'Repartiendo…';
  if (state.phase === 'playing' && state.turn) {
    const p = getPlayer(state.seats[state.turn.si].playerId);
    status = `Juega <b>${esc(p.name)}</b> (puesto ${state.turn.si + 1})…`;
  } else if (state.phase === 'dealer') status = 'Turno del crupier…';
  el.innerHTML = `<div class="ctl-line wait">${status}</div>`;
}

function renderCoach() {
  const el = $('#coach');
  const parts = [];
  const cur = currentHumanHand();
  if (cur && state.pending.kind === 'insurance' && (S().showHint || state.hintShown)) {
    parts.push(`<div class="tip hint"><div class="tip-h">Estrategia básica: <b>Sin seguro</b></div><p>${esc(INSURANCE_REASON)}</p></div>`);
  } else if (cur && (S().showHint || state.hintShown)) {
    const { rec } = state.pending;
    parts.push(`<div class="tip hint"><div class="tip-h">Estrategia básica: <b>${ACTIONS[rec.action]}</b>${rec.ideal !== rec.action ? ` <span class="muted">(la tabla dice ${ACTIONS[rec.ideal]})</span>` : ''}</div><p>${esc(rec.reason)}</p></div>`);
  }
  const f = state.feedback;
  if (f && S().feedback) {
    parts.push(`<div class="tip ${f.ok ? 'ok' : 'bad'}">
      <div class="tip-h">${f.ok ? '✓ Correcto' : '✗ Error'} — ${esc(f.desc)}</div>
      <p>${f.ok ? `Elegiste <b>${LABELS[f.chosen]}</b>.` : `Elegiste <b>${LABELS[f.chosen]}</b>; lo correcto era <b>${LABELS[f.rec]}</b>.`} ${esc(f.reason)}</p>
    </div>`);
  }
  if (state.message) parts.push(`<div class="tip note">${esc(state.message)}</div>`);
  if (!parts.length) {
    parts.push(`<div class="tip note">Juega tus manos y aquí verás si tu decisión coincide con la estrategia básica. Activa <b>Pistas</b> en Reglas para verla antes de decidir.</div>`);
  }
  if (state.log.length && S().feedback) {
    const top = commonMistakes();
    if (top.length) {
      parts.push(`<details class="log"><summary>Tus errores más comunes</summary><ol>${top
        .map((m) => `<li class="bad"><span class="mcount">${m.n}×</span>${esc(m.desc)}: lo correcto es <b>${LABELS[m.rec]}</b></li>`)
        .join('')}</ol><button class="btn ghost small" data-action="clear-log">Borrar historial</button></details>`);
    }
    parts.push(`<details class="log"><summary>Últimas decisiones (${Math.min(state.log.length, 40)} de ${state.log.length})</summary><ol>${state.log
      .slice(0, 40)
      .map((l) => `<li class="${l.ok ? 'ok' : 'bad'}"><span class="dot" style="background:${l.color}"></span>${esc(l.desc)}: ${LABELS[l.chosen]}${l.ok ? '' : ` → <b>${LABELS[l.rec]}</b>`}</li>`)
      .join('')}</ol></details>`);
  }
  el.innerHTML = parts.join('');
}

const LABELS = { ...ACTIONS, I: 'Tomar seguro', N: 'Sin seguro' };

/** Situaciones en las que más se equivocan los jugadores humanos. */
function commonMistakes() {
  const map = new Map();
  for (const l of state.log) {
    if (l.ok) continue;
    const desc = l.key || l.desc;
    const k = `${desc}|${l.rec}`;
    const m = map.get(k) || { desc, rec: l.rec, n: 0 };
    m.n++;
    map.set(k, m);
  }
  return [...map.values()].sort((a, b) => b.n - a.n).slice(0, 6);
}

function renderRoster() {
  $('#roster').innerHTML = state.players.map((p) => {
    const acc = p.stats.decisions ? Math.round((p.stats.correct / p.stats.decisions) * 100) : null;
    const net = p.bankroll - p.startBankroll - (p.rebuys || 0) * (p.startBankroll || 1000);
    return `<div class="rp">
      <span class="dot" style="background:${p.color}"></span>
      <span class="rp-name">${esc(p.name)}${p.isBot ? ' <span class="bot-tag">bot</span>' : ''}</span>
      <span class="rp-bank">${fmt(p.bankroll)}</span>
      <span class="rp-net ${net >= 0 ? 'up' : 'down'}">${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))}</span>
      ${p.isBot ? '' : `<span class="rp-acc" title="Decisiones iguales a la estrategia básica">${acc === null ? '—' : acc + '%'} <small>(${p.stats.correct}/${p.stats.decisions})</small></span>`}
    </div>`;
  }).join('');
}

function renderInfo() {
  const s = S();
  $('#felt-rules').innerHTML = `Blackjack paga ${s.bjPays === 1.5 ? '3 a 2' : '6 a 5'}<br><span>El crupier ${s.h17 ? 'pide con 17 suave' : 'se planta en todos los 17'}</span>`;
  const left = state.shoe.length;
  const pct = state.shoeSize ? Math.round((left / state.shoeSize) * 100) : 100;
  const count = s.showCount && state.shoeSize
    ? `<div class="count"><span>Cuenta</span><b>${state.runningCount > 0 ? '+' : ''}${state.runningCount}</b><span>Real</span><b>${trueCount().toFixed(1)}</b></div>`
    : '';
  $('#shoe').innerHTML = `<div class="shoe-bar" title="Cartas restantes en el zapato"><i style="width:${pct}%"></i></div>
    <div class="shoe-txt">${s.decks} mazos · ${state.shoeSize ? left : s.decks * 52} cartas</div>${count}`;
}

function render() {
  renderInfo();
  renderDealer();
  renderSeats();
  renderControls();
  renderCoach();
  renderRoster();
  if ($('#dlg-chart').open) renderChart();
  keepSeatInView();
  // Las cartas recién repartidas solo se animan una vez.
  const clear = (c) => { c.fresh = false; };
  state.dealer.cards.forEach(clear);
  state.seats.forEach((s) => s.hands.forEach((h) => h.cards.forEach(clear)));
}

// En pantallas angostas los puestos se desplazan: centra el puesto que juega o el elegido.
let lastFocus = '';
function keepSeatInView() {
  const sc = $('.seats-scroll');
  const focus = $('.seat.turn') || $('.seat.selected');
  if (!focus || sc.scrollWidth <= sc.clientWidth) return;
  const key = `${state.phase}:${state.turn ? state.turn.si : state.selectedSeat}`;
  if (key === lastFocus) return;
  lastFocus = key;
  const target = focus.offsetLeft - (sc.clientWidth - focus.offsetWidth) / 2;
  sc.scrollTo({ left: target, behavior: 'smooth' });
}

/* ───────────────────────── Práctica rápida ───────────────────────── */

const drill = { cards: [], up: null, rec: null, answer: null, n: 0, ok: 0, streak: 0, best: 0, timer: 0 };

function rnd(n) {
  return Math.floor(randomUnit() * n);
}

function randCard(ranks = RANKS) {
  return { rank: ranks[rnd(ranks.length)], suit: SUITS[rnd(4)], id: uid('d') };
}

function drillNext() {
  clearTimeout(drill.timer);
  const roll = randomUnit();
  const noAce = RANKS.filter((r) => r !== 'A');
  let cards;
  if (roll < 0.3) {
    // Cada pareja (2-2 … 10-10, A-A) sale con la misma frecuencia.
    const kinds = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T'];
    const k = kinds[rnd(kinds.length)];
    const r = k === 'T' ? ['10', 'J', 'Q', 'K'][rnd(4)] : k;
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
  drill.cards = cards.map((c) => ({ ...c, id: uid('d'), fresh: true }));
  drill.up = { ...randCard(), fresh: true };
  drill.rec = bestAction(drill.cards, drill.up, drillOptions());
  drill.answer = null;
  renderDrill();
}

function drillOptions() {
  return { canDouble: true, canSplit: isPair(drill.cards), canSurrender: S().surrender, h17: S().h17, das: S().das };
}

function drillAnswer(act) {
  if (drill.answer || !isLegal(act, { ...drillOptions(), canHit: true })) return;
  const ok = act === drill.rec.action;
  drill.answer = act;
  drill.n++;
  if (ok) {
    drill.ok++;
    drill.streak++;
    drill.best = Math.max(drill.best, drill.streak);
  } else drill.streak = 0;
  const up = drill.up.rank === 'A' ? 'As' : String(cardValue(drill.up));
  const desc = `${describeHand(drill.cards)} vs ${up}`;
  state.log.unshift({ ok, player: 'Práctica', color: '#e3b45a', seat: 0, hand: 0, desc, key: desc, chosen: act, rec: drill.rec.action, reason: drill.rec.reason });
  state.log = state.log.slice(0, LOG_MAX);
  save();
  renderDrill();
  render();
  if (ok) drill.timer = setTimeout(() => { if ($('#dlg-drill').open) drillNext(); }, delay(900));
}

function renderDrill() {
  const o = { ...drillOptions(), canHit: true };
  const a = drill.answer;
  const ok = a && a === drill.rec.action;
  const btn = (k) => {
    let cls = '';
    if (a && k === drill.rec.action) cls = ' rec';
    else if (a && k === a) cls = ' wrong';
    return `<button class="btn act${cls}" data-action="drill-act" data-act="${k}" ${isLegal(k, o) && !a ? '' : 'disabled'}>${ACTIONS[k]} <kbd>${k}</kbd></button>`;
  };
  const pct = drill.n ? Math.round((drill.ok / drill.n) * 100) : 0;
  $('#drill-body').innerHTML = `
    <div class="drill-stats"><span>Aciertos <b>${drill.ok}/${drill.n}</b> (${pct}%)</span><span>Racha <b>${drill.streak}</b></span><span>Mejor racha <b>${drill.best}</b></span></div>
    <div class="drill-felt">
      <div class="drill-side"><span>Crupier</span><div class="cards">${cardHTML(drill.up)}</div></div>
      <div class="drill-side"><span>Tú · ${describeHand(drill.cards)}</span><div class="cards">${drill.cards.map((c) => cardHTML(c)).join('')}</div></div>
    </div>
    <div class="btn-row actions">${['H', 'S', 'D', 'P', 'R'].map(btn).join('')}</div>
    ${a ? `<div class="tip ${ok ? 'ok' : 'bad'}"><div class="tip-h">${ok ? '✓ Correcto' : `✗ Lo correcto es ${ACTIONS[drill.rec.action]}`}</div><p>${esc(drill.rec.reason)}</p></div>
      <div class="btn-row"><span class="spacer"></span><button class="btn primary" data-action="drill-next">Siguiente <kbd>Espacio</kbd></button></div>` : '<p class="muted small">Elige la jugada. Es la primera decisión de la mano, así que puedes doblar; rendirse solo si está activado en Reglas.</p>'}`;
  drill.cards.forEach((c) => { c.fresh = false; });
  drill.up.fresh = false;
}

/* ───────────────────────── Tabla de estrategia ───────────────────────── */

const C = (rank) => ({ rank: String(rank), suit: '♠' });
const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 'A'];
let chartTab = 'hard';

function cellCode(cards, up, canSplit = true) {
  const base = { canDouble: true, canSplit, canSurrender: S().surrender, h17: S().h17, das: S().das };
  const upCard = C(up === 10 ? 'K' : up);
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
      label: t === 17 ? '17' : String(t),
      cards: t >= 12 ? [C(10), C(t - 10)] : [C(2), C(t - 2)],
      noSplit: true,
    }));
  }
  if (tab === 'soft') {
    return [2, 3, 4, 5, 6, 7, 8, 9].map((k) => ({ key: `s${k + 11}`, label: `A-${k} <small>(${k + 11})</small>`, cards: [C('A'), C(k)] }));
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
  const { hand } = cur;
  const up = cardValue(state.dealer.cards[0]);
  const col = up === 11 ? 'A' : up;
  const { total, soft } = handValue(hand.cards);
  if (isPair(hand.cards) && state.pending.o.canSplit) return { tab: 'pairs', key: `p${cardValue(hand.cards[0])}`, col };
  if (soft && total >= 13 && total <= 20) return { tab: 'soft', key: `s${total}`, col };
  if (soft) return { tab: 'hard', key: `h${Math.max(5, Math.min(total, 20))}`, col };
  return { tab: 'hard', key: `h${Math.max(5, Math.min(total, 20))}`, col };
}

function renderChart() {
  const cur = currentCell();
  const rows = rowsFor(chartTab);
  const head = `<tr><th>Tú \\ Crupier</th>${UPS.map((u) => `<th class="${cur && cur.col === u ? 'hl-col' : ''}">${u}</th>`).join('')}</tr>`;
  const body = rows.map((row) => {
    const tds = UPS.map((u) => {
      const code = cellCode(row.cards, u, !row.noSplit);
      const hl = cur && cur.tab === chartTab && cur.key === row.key && cur.col === u;
      return `<td class="k-${code}${hl ? ' hl' : ''}">${code}</td>`;
    }).join('');
    const rowHl = cur && cur.tab === chartTab && cur.key === row.key;
    return `<tr class="${rowHl ? 'hl-row' : ''}"><th>${row.label}${row.key === 'h20' ? '+' : ''}${row.key === 'h5' ? '−' : ''}</th>${tds}</tr>`;
  }).join('');
  $('#chart-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === chartTab));
  $('#chart-table').innerHTML = `<table class="chart"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  const s = S();
  $('#chart-rules').textContent = `${s.decks} mazos · ${s.h17 ? 'H17 (pide con 17 suave)' : 'S17 (se planta en 17 suave)'} · ${s.das ? 'doblar tras dividir' : 'sin doblar tras dividir'} · ${s.surrender ? 'rendición tardía' : 'sin rendición'}`;
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
  $('#players-list').innerHTML = state.players.map((p) => `
    <div class="pl-row" data-pid="${p.id}">
      <span class="dot big" style="background:${p.color}"></span>
      <input class="pl-name" value="${esc(p.name)}" aria-label="Nombre" maxlength="18">
      <label class="pl-bank"><span>Saldo</span><input type="number" min="0" step="5" class="pl-bankroll" value="${Math.round(p.bankroll * 100) / 100}" ${busy ? 'disabled' : ''}></label>
      <label class="pl-bot"><input type="checkbox" class="pl-isbot" ${p.isBot ? 'checked' : ''} ${busy ? 'disabled' : ''}> Bot</label>
      <button class="btn ghost small" data-action="reset-stats" data-pid="${p.id}" title="Reiniciar estadísticas">Reiniciar</button>
      <button class="btn ghost small danger" data-action="del-player" data-pid="${p.id}" ${busy ? 'disabled' : ''} aria-label="Eliminar ${esc(p.name)}">Eliminar</button>
    </div>`).join('');
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
      const bot = row.querySelector('.pl-isbot').checked;
      if (bot !== p.isBot) p.isBot = bot;
    }
  });
  for (const seat of state.seats) {
    const p = seat.playerId && getPlayer(seat.playerId);
    if (p && committedBy(p.id) > p.bankroll) seat.bet = 0;
  }
}

const RULE_FIELDS = ['decks', 'h17', 'das', 'surrender', 'maxHands', 'resplitAces', 'hitSplitAces', 'bjPays', 'minBet', 'maxBet', 'penetration', 'showHint', 'feedback', 'showCount', 'speed'];

function fillRules() {
  const f = $('#rules-form');
  for (const k of RULE_FIELDS) {
    const input = f.elements[k];
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = !!S()[k];
    else input.value = String(S()[k]);
  }
  f.querySelectorAll('[data-round-lock]').forEach((el) => { el.disabled = state.phase !== 'betting'; });
}

function readRules() {
  const f = $('#rules-form');
  const prevDecks = S().decks;
  const prevPen = S().penetration;
  for (const k of RULE_FIELDS) {
    const input = f.elements[k];
    if (!input || input.disabled) continue;
    if (input.type === 'checkbox') state.settings[k] = input.checked;
    else state.settings[k] = Number(input.value);
  }
  const s = state.settings;
  s.minBet = Math.max(1, s.minBet || 1);
  s.maxBet = Math.max(s.minBet, s.maxBet || s.minBet);
  if (s.decks !== prevDecks || s.penetration !== prevPen) state.needShuffle = true;
}

/* ───────────────────────── Eventos ───────────────────────── */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  switch (a) {
    case 'chip': addChip(Number(el.dataset.v)); break;
    case 'deal': deal(); break;
    case 'clear-bet': {
      const seat = state.seats[state.selectedSeat];
      if (seat && isHumanSeat(seat) && state.phase === 'betting') { seat.bet = 0; render(); }
      break;
    }
    case 'double-bet': {
      const seat = state.seats[state.selectedSeat];
      if (seat && isHumanSeat(seat)) addChip(seat.bet || S().minBet);
      break;
    }
    case 'select-seat': {
      const si = Number(el.dataset.seat);
      if (state.phase === 'betting' && isHumanSeat(state.seats[si])) {
        if (state.selectedSeat === si && state.seats[si].bet === 0) addChip(S().minBet);
        state.selectedSeat = si;
        render();
      }
      break;
    }
    case 'leave': sit(Number(el.dataset.seat), null); break;
    case 'act': humanAct(el.dataset.act); break;
    case 'hint': state.hintShown = true; render(); break;
    case 'drill':
      if (!drill.cards.length || drill.answer) drillNext();
      else renderDrill();
      $('#dlg-drill').showModal();
      break;
    case 'drill-act': drillAnswer(el.dataset.act); break;
    case 'drill-next': drillNext(); break;
    case 'clear-log': state.log = []; state.feedback = null; save(); render(); break;
    case 'chart': openChart(); break;
    case 'chart-tab': chartTab = el.dataset.tab; renderChart(); break;
    case 'open-players': renderPlayersForm(); $('#dlg-players').showModal(); break;
    case 'open-rules': fillRules(); $('#dlg-rules').showModal(); break;
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
      state.seats.forEach((s) => { if (s.playerId === id) { s.playerId = null; s.bet = 0; s.hands = []; } });
      renderPlayersForm();
      save();
      render();
      break;
    }
    case 'reset-stats': {
      const p = getPlayer(el.dataset.pid);
      if (p) {
        p.stats = { decisions: 0, correct: 0, hands: 0 };
        p.startBankroll = p.bankroll;
        p.rebuys = 0;
        state.log = state.log.filter((l) => l.player !== p.name);
        save();
        render();
      }
      break;
    }
    case 'save-players': readPlayersForm(); save(); $('#dlg-players').close(); render(); break;
    case 'save-rules': readRules(); save(); $('#dlg-rules').close(); render(); break;
    case 'reset-rules': state.settings = { ...DEFAULT_SETTINGS }; fillRules(); break;
    case 'close': el.closest('dialog').close(); break;
    case 'reset-all':
      if (state.phase === 'betting' && confirm('¿Borrar jugadores, saldos, estadísticas y reglas guardadas?')) {
        try { localStorage.removeItem(STORE); } catch { /* nada */ }
        location.reload();
      }
      break;
  }
});

document.addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-sit]');
  if (sel) sit(Number(sel.dataset.sit), sel.value);
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if ($('#dlg-drill').open) {
    if (['h', 's', 'd', 'p', 'r'].includes(k)) { drillAnswer(k.toUpperCase()); e.preventDefault(); }
    else if ((k === ' ' || k === 'enter') && drill.answer) { drillNext(); e.preventDefault(); }
    return;
  }
  if (document.querySelector('dialog[open]') && k !== 't') return;
  if (state.pending && ['h', 's', 'd', 'p', 'r', 'i', 'n'].includes(k)) { humanAct(k.toUpperCase()); e.preventDefault(); return; }
  if (k === '?' || (k === '/' && e.shiftKey)) { state.hintShown = true; render(); return; }
  if (k === 't') {
    const d = $('#dlg-chart');
    if (d.open) d.close(); else openChart();
    e.preventDefault();
    return;
  }
  if ((k === ' ' || k === 'enter') && state.phase === 'betting') { e.preventDefault(); deal(); }
});

load();
buildShoe();
render();

// Solo para pruebas: ?debug expone el estado en la consola.
if (new URLSearchParams(location.search).has('debug')) window.mesa21 = { state, render, buildShoe };
