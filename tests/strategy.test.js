// Pruebas del motor de estrategia contra tablas publicadas de Wizard of Odds:
//  - 4-8 mazos, el crupier se planta en 17 suave (S17):
//    https://wizardofodds.com/games/blackjack/strategy/4-decks/  (bj_4d_s17.gif)
//  - 4-8 mazos, el crupier pide con 17 suave (H17): misma página (bj_4d_h17.gif)
//  - Blackjack europeo sin carta oculta (se pierde todo ante un Blackjack del crupier):
//    https://wizardofodds.com/games/blackjack/strategy/european/  (bj_euro.gif)
// Ejecutar con:  node --test   (o npm test)
//
// Códigos (como en esas tablas): H pedir, S plantarse, Dh doblar o pedir, Ds doblar o
// plantarse, P dividir, Ph dividir si se puede doblar tras dividir (si no, pedir),
// Rh / Rs / Rp rendirse o, si no se puede, pedir / plantarse / dividir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestAction } from '../js/strategy.js';

const C = (rank) => ({ rank: String(rank), suit: '♠' });
const UPS = ['2', '3', '4', '5', '6', '7', '8', '9', 'K', 'A'];
const COLS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

/** El código de tabla que da el motor para una mano, con las reglas dadas. */
function code(cards, up, rules) {
  const base = { canDouble: true, canSplit: true, canSurrender: rules.surrender ?? true, h17: !!rules.h17, das: rules.das ?? true, noPeek: !!rules.noPeek };
  const act = (o) => bestAction(cards, C(up), o).action;
  const r = act(base);
  if (r === 'D') return act({ ...base, canDouble: false }) === 'S' ? 'Ds' : 'Dh';
  if (r === 'R') return `R${act({ ...base, canSurrender: false }).toLowerCase()}`;
  if (r === 'P' && base.das && act({ ...base, das: false }) !== 'P') return 'Ph';
  return r;
}

const hard = (t) => (t <= 11 ? [C(2), C(t - 2)] : t <= 19 ? [C(10), C(t - 10)] : [C(10), C(6), C(4)]);
const soft = (t) => [C('A'), C(t - 11)];
const pair = (r) => [C(r), C(r)];

/** Compara una fila de la tabla (10 códigos, de 2 a As) con el motor. */
function checkRow(label, cards, expected, rules) {
  const want = expected.trim().split(/\s+/);
  assert.equal(want.length, 10, `${label}: la fila esperada debe tener 10 casillas`);
  UPS.forEach((up, i) => {
    assert.equal(code(cards, up, rules), want[i], `${label} contra ${COLS[i]}`);
  });
}

const S17_HARD = {
  5: 'H  H  H  H  H  H  H  H  H  H',
  6: 'H  H  H  H  H  H  H  H  H  H',
  7: 'H  H  H  H  H  H  H  H  H  H',
  8: 'H  H  H  H  H  H  H  H  H  H',
  9: 'H  Dh Dh Dh Dh H  H  H  H  H',
  10: 'Dh Dh Dh Dh Dh Dh Dh Dh H  H',
  11: 'Dh Dh Dh Dh Dh Dh Dh Dh Dh H',
  12: 'H  H  S  S  S  H  H  H  H  H',
  13: 'S  S  S  S  S  H  H  H  H  H',
  14: 'S  S  S  S  S  H  H  H  H  H',
  15: 'S  S  S  S  S  H  H  H  Rh H',
  16: 'S  S  S  S  S  H  H  Rh Rh Rh',
  17: 'S  S  S  S  S  S  S  S  S  S',
  18: 'S  S  S  S  S  S  S  S  S  S',
  19: 'S  S  S  S  S  S  S  S  S  S',
  20: 'S  S  S  S  S  S  S  S  S  S',
};

const S17_SOFT = {
  13: 'H  H  H  Dh Dh H  H  H  H  H',
  14: 'H  H  H  Dh Dh H  H  H  H  H',
  15: 'H  H  Dh Dh Dh H  H  H  H  H',
  16: 'H  H  Dh Dh Dh H  H  H  H  H',
  17: 'H  Dh Dh Dh Dh H  H  H  H  H',
  18: 'S  Ds Ds Ds Ds S  S  H  H  H',
  19: 'S  S  S  S  S  S  S  S  S  S',
  20: 'S  S  S  S  S  S  S  S  S  S',
};

const S17_PAIRS = {
  2: 'Ph Ph P  P  P  P  H  H  H  H',
  3: 'Ph Ph P  P  P  P  H  H  H  H',
  4: 'H  H  H  Ph Ph H  H  H  H  H',
  6: 'Ph P  P  P  P  H  H  H  H  H',
  7: 'P  P  P  P  P  P  H  H  H  H',
  8: 'P  P  P  P  P  P  P  P  P  P',
  9: 'P  P  P  P  P  S  P  P  S  S',
  A: 'P  P  P  P  P  P  P  P  P  P',
};

test('S17, doblar tras dividir y rendición: manos duras', () => {
  for (const [t, row] of Object.entries(S17_HARD)) checkRow(`${t} duro`, hard(Number(t)), row, {});
});

test('S17, doblar tras dividir y rendición: manos suaves', () => {
  for (const [t, row] of Object.entries(S17_SOFT)) checkRow(`${t} suave`, soft(Number(t)), row, {});
});

test('S17, doblar tras dividir y rendición: parejas', () => {
  for (const [r, row] of Object.entries(S17_PAIRS)) checkRow(`pareja ${r}-${r}`, pair(r), row, {});
  // 5-5 se juega como 10 duro y 10-10 siempre se planta.
  checkRow('pareja 5-5', pair(5), S17_HARD[10], {});
  checkRow('pareja 10-10', pair(10), 'S S S S S S S S S S', {});
});

test('H17: las casillas que cambian respecto de S17', () => {
  const h17 = { h17: true };
  checkRow('11 duro (H17)', hard(11), 'Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh', h17);
  checkRow('15 duro (H17)', hard(15), 'S  S  S  S  S  H  H  H  Rh Rh', h17);
  checkRow('16 duro (H17)', hard(16), 'S  S  S  S  S  H  H  Rh Rh Rh', h17);
  checkRow('17 duro (H17)', hard(17), 'S  S  S  S  S  S  S  S  S  Rs', h17);
  checkRow('18 suave (H17)', soft(18), 'Ds Ds Ds Ds Ds S  S  H  H  H', h17);
  checkRow('19 suave (H17)', soft(19), 'S  S  S  S  Ds S  S  S  S  S', h17);
  checkRow('pareja 8-8 (H17)', pair(8), 'P  P  P  P  P  P  P  P  P  Rp', h17);
  // El resto de la tabla es igual a S17.
  for (const t of [9, 10, 12, 13, 14]) checkRow(`${t} duro (H17)`, hard(t), S17_HARD[t], h17);
  for (const r of ['2', '3', '4', '6', '7', '9', 'A']) checkRow(`pareja ${r}-${r} (H17)`, pair(r), S17_PAIRS[r], h17);
});

test('sin doblar tras dividir: las casillas Ph se piden', () => {
  const noDas = { das: false };
  checkRow('pareja 2-2 sin DAS', pair(2), 'H  H  P  P  P  P  H  H  H  H', noDas);
  checkRow('pareja 3-3 sin DAS', pair(3), 'H  H  P  P  P  P  H  H  H  H', noDas);
  checkRow('pareja 4-4 sin DAS', pair(4), 'H  H  H  H  H  H  H  H  H  H', noDas);
  checkRow('pareja 6-6 sin DAS', pair(6), 'H  P  P  P  P  H  H  H  H  H', noDas);
});

test('sin rendición: las casillas R se juegan con su alternativa', () => {
  const noSur = { surrender: false };
  checkRow('15 duro sin rendición', hard(15), 'S  S  S  S  S  H  H  H  H  H', noSur);
  checkRow('16 duro sin rendición', hard(16), 'S  S  S  S  S  H  H  H  H  H', noSur);
});

test('europeo sin carta oculta: casillas que cambian ante 10 y As', () => {
  const enhc = { noPeek: true, surrender: false };
  checkRow('11 duro (europeo)', hard(11), 'Dh Dh Dh Dh Dh Dh Dh Dh H  H', enhc);
  checkRow('10 duro (europeo)', hard(10), 'Dh Dh Dh Dh Dh Dh Dh Dh H  H', enhc);
  checkRow('pareja 8-8 (europeo)', pair(8), 'P  P  P  P  P  P  P  P  H  H', enhc);
  checkRow('pareja A-A (europeo)', pair('A'), 'P  P  P  P  P  P  P  P  P  H', enhc);
  checkRow('pareja 9-9 (europeo)', pair(9), S17_PAIRS[9], enhc);
});
