// Estrategia básica para blackjack multi-mazo (4–8 mazos), con variantes S17/H17,
// doblar tras dividir (DAS) y rendición tardía. Funciones puras, sin estado.

export const ACTIONS = {
  H: 'Pedir',
  S: 'Plantarse',
  D: 'Doblar',
  P: 'Dividir',
  R: 'Rendirse',
};

export function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J', '10'].includes(card.rank)) return 10;
  return Number(card.rank);
}

/** Total de la mano y si es suave (un As cuenta 11). */
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isPair(cards) {
  return cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
}

const upName = (u) => (u === 11 ? 'As' : String(u));

/**
 * Mejor jugada según estrategia básica.
 * @param {Array} cards  cartas del jugador
 * @param {Object} upCard carta visible del crupier
 * @param {Object} o { canDouble, canSplit, canSurrender, h17, das, noPeek }
 *   noPeek: el crupier no revisó si tiene Blackjack con esta carta y, si lo tiene, se pierden
 *   también las apuestas dobladas y divididas (regla europea).
 * @returns {{ action: 'H'|'S'|'D'|'P'|'R', ideal: string, reason: string }}
 *   action = jugada legal recomendada; ideal = jugada de la tabla (puede no estar permitida).
 */
export function bestAction(cards, upCard, o) {
  const u = cardValue(upCard);
  const { total, soft } = handValue(cards);
  const pair = isPair(cards);
  const pv = pair ? cardValue(cards[0]) : 0;
  const vs = `vs ${upName(u)}`;
  const weak = u >= 2 && u <= 6;

  const out = (action, reason, ideal = action) => ({ action, ideal, reason });
  // Doblar si se puede; si no, alternativa.
  const dbl = (fallback, reason) =>
    o.canDouble ? out('D', reason, 'D') : out(fallback, reason + ' Como ya no puedes doblar, ' + (fallback === 'H' ? 'pide.' : 'plántate.'), 'D');

  // 1. Rendición tardía
  if (o.canSurrender) {
    if (pair && pv === 8) {
      if (o.h17 && u === 11) return out('R', `8-8 ${vs} con H17: rendirse pierde menos que dividir contra un As fuerte.`);
    } else if (!soft) {
      if (total === 16 && u >= 9) return out('R', `16 duro ${vs}: es la peor mano del juego; rendirte recupera la mitad y pierde menos a la larga.`);
      if (total === 15 && u === 10) return out('R', `15 duro ${vs}: pierdes más del 50% de las veces jugándola; rendirse es mejor.`);
      if (o.h17 && u === 11 && (total === 15 || total === 17)) return out('R', `${total} duro ${vs} con H17: el crupier pide con 17 suave y rara vez se pasa; rendirse ahorra dinero.`);
    }
  }

  // 2. Parejas
  if (pair && o.canSplit) {
    const P = (reason) => out('P', reason);
    switch (pv) {
      case 11:
        if (o.noPeek && u === 11) break; // sin revisión contra As, dividir arriesga dos apuestas
        return P(`Pareja de Ases: siempre se divide. Un 12 suave es malo; dos manos empezando con 11 son excelentes.`);
      case 9: if ((u >= 2 && u <= 6) || u === 8 || u === 9) return P(`9-9 ${vs}: 18 no es suficiente; dividir convierte una mano mediocre en dos con ventaja.`); break;
      case 8:
        if (o.noPeek && u >= 10) {
          return out('H', `8-8 ${vs} sin revisión de Blackjack: si el crupier lo tiene perderías las dos apuestas, así que se pide en vez de dividir.`);
        }
        return P(`8-8: siempre se divide. 16 es la peor mano; dos manos de 8 tienen mucho mejor futuro.`);
      case 7: if (u <= 7) return P(`7-7 ${vs}: el crupier es vulnerable; dos manos de 7 rinden más que un 14.`); break;
      case 6: if (o.das ? u <= 6 : u >= 3 && u <= 6) return P(`6-6 ${vs}: con el crupier débil, dividir aprovecha que es probable que se pase.`); break;
      case 4: if (o.das && (u === 5 || u === 6)) return P(`4-4 ${vs} con doblar tras dividir: cada 4 puede volverse un buen doble contra un 5 o 6.`); break;
      case 3:
      case 2: if (o.das ? u <= 7 : u >= 4 && u <= 7) return P(`${pv}-${pv} ${vs}: con el crupier débil, dividir las cartas bajas gana valor.`); break;
      default: break; // 10-10 y 5-5 no se dividen
    }
  }

  // 3. Manos suaves
  if (soft && total <= 21) {
    if (total >= 20) return out('S', `${total} suave: mano fuerte, plántate.`);
    if (total === 19) {
      if (o.h17 && u === 6) return o.canDouble ? out('D', `19 suave vs 6 con H17: el crupier se pasa mucho; doblar saca más.`) : out('S', `19 suave: plántate (doblarías si fuese tu primera decisión).`, 'D');
      return out('S', `19 suave: mano fuerte, plántate.`);
    }
    if (total === 18) {
      const dblFrom = o.h17 ? 2 : 3;
      if (u >= dblFrom && u <= 6) return o.canDouble ? out('D', `18 suave ${vs}: no puedes pasarte con una carta y el crupier es débil; dobla.`) : out('S', `18 suave ${vs}: plántate (doblarías si pudieras).`, 'D');
      if (u <= 8) return out('S', `18 suave ${vs}: 18 le gana a lo que probablemente hará el crupier; plántate.`);
      return out('H', `18 suave ${vs}: contra un 9, 10 o As, 18 pierde a menudo; pide, no te puedes pasar.`);
    }
    if (total === 17) return u >= 3 && u <= 6 ? dbl('H', `17 suave ${vs}: el crupier está débil y no te pasas con una carta.`) : out('H', `17 suave ${vs}: 17 casi nunca gana; pide sin riesgo de pasarte.`);
    if (total === 15 || total === 16) return u >= 4 && u <= 6 ? dbl('H', `${total} suave ${vs}: el crupier está débil, aprovecha para doblar.`) : out('H', `${total} suave ${vs}: pide, no puedes pasarte.`);
    if (total === 13 || total === 14) return u === 5 || u === 6 ? dbl('H', `${total} suave ${vs}: contra 5 o 6 conviene doblar.`) : out('H', `${total} suave ${vs}: pide, no puedes pasarte.`);
    return out('H', `${total} suave: pide.`);
  }

  // 4. Manos duras
  if (total >= 17) return out('S', `${total} duro: el riesgo de pasarte es demasiado alto; plántate.`);
  if (total >= 13) {
    return weak
      ? out('S', `${total} duro ${vs}: deja que el crupier se arriesgue a pasarse; plántate.`)
      : out('H', `${total} duro ${vs}: el crupier probablemente hará 17 o más; tienes que pedir.`);
  }
  if (total === 12) {
    return u >= 4 && u <= 6
      ? out('S', `12 duro ${vs}: el crupier se pasa con frecuencia; plántate.`)
      : out('H', `12 duro ${vs}: solo te pasas con un 10; pedir es mejor.`);
  }
  if (total === 11) {
    if (o.noPeek && u >= 10) return out('H', `11 ${vs} sin revisión de Blackjack: si el crupier lo tiene perderías también lo doblado; pide.`);
    if (u === 11 && !o.h17) return out('H', `11 vs As con S17 en multi-mazo: pide (doblar es ligeramente peor).`);
    return dbl('H', `11 ${vs}: la mejor mano para doblar; muchas cartas valen 10.`);
  }
  if (total === 10) return u <= 9 ? dbl('H', `10 ${vs}: tienes ventaja sobre el crupier; dobla.`) : out('H', `10 ${vs}: contra 10 o As, mejor solo pedir.`);
  if (total === 9) return u >= 3 && u <= 6 ? dbl('H', `9 ${vs}: el crupier está débil; dobla.`) : out('H', `9 ${vs}: pide.`);
  return out('H', `${total}: no puedes pasarte; pide siempre.`);
}
