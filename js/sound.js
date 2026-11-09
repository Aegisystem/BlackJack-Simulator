// Sonidos de la mesa: grabaciones reales de cartas y fichas («Casino Audio» de Kenney,
// licencia CC0) reproducidas con Web Audio. Cada vez se elige una variante distinta y se
// cambia un poco la velocidad para que dos cartas o dos fichas nunca suenen idénticas.
// Si un archivo no carga, se usa una versión sintetizada como respaldo.
// `pan` va de -1 (izquierda) a 1 (derecha).

const GROUPS = {
  slide: ['card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-4', 'card-slide-5'],
  place: ['card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'],
  shove: ['card-shove-1', 'card-shove-2'],
  shuffle: ['card-shuffle'],
  lay: ['chip-lay-1', 'chip-lay-2', 'chip-lay-3'],
  stack: ['chips-stack-1', 'chips-stack-2', 'chips-stack-3', 'chips-stack-4', 'chips-stack-5', 'chips-stack-6'],
  handle: ['chips-handle-1', 'chips-handle-2', 'chips-handle-3', 'chips-handle-4'],
  collide: ['chips-collide-1', 'chips-collide-2'],
};
const DIR = new URL('../sounds/', import.meta.url);

let ctx = null;
let master = null;
let noise = null;
let enabled = true;
let volume = 0.7;
let voiceOn = false;
let esVoice = null;

const raw = {}; // nombre -> ArrayBuffer descargado
const buffers = {}; // nombre -> AudioBuffer listo para sonar
const last = {}; // grupo -> última variante usada

const rand = (a, b) => a + Math.random() * (b - a);

// Los archivos se descargan al cargar la página (216 KB en total); se decodifican
// cuando el navegador permite crear el audio, tras el primer toque o tecla.
for (const name of Object.values(GROUPS).flat()) {
  fetch(new URL(`${name}.mp3`, DIR))
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((data) => {
      if (!data) return;
      raw[name] = data;
      if (ctx) decode(name);
    })
    .catch(() => {});
}

function decode(name) {
  const data = raw[name];
  if (!data || buffers[name]) return;
  delete raw[name];
  ctx.decodeAudioData(
    data,
    (b) => {
      buffers[name] = b;
    },
    () => {},
  );
}

function ensure() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    // Un compresor suave evita que un pago grande de fichas sature.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    Object.keys(raw).forEach(decode);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** El navegador solo deja sonar audio después de un toque o una tecla. */
export function unlock() {
  ensure();
}

export function configure(opts) {
  enabled = !!opts.enabled;
  volume = Math.max(0, Math.min(1, Number(opts.volume ?? volume)));
  voiceOn = enabled && !!opts.voice;
  if (master) master.gain.setTargetAtTime(enabled ? volume : 0, ctx.currentTime, 0.02);
  if (!voiceOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}

const at = (delay) => ctx.currentTime + 0.005 + delay;

function out(pan) {
  if (!pan || !ctx.createStereoPanner) return master;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(master);
  return p;
}

/** Reproduce una grabación concreta. Devuelve su duración, o 0 si no está disponible. */
function playName(name, { pan = 0, delay = 0, gain = 1, rate = [0.94, 1.06], dur = 0 } = {}) {
  if (!ensure() || !buffers[name]) return 0;
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  src.playbackRate.value = rand(rate[0], rate[1]);
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(out(pan));
  const t = at(delay);
  src.start(t);
  let len = src.buffer.duration / src.playbackRate.value;
  // dur corta la grabación con un desvanecido corto (por ejemplo, una barajada más rápida).
  if (dur && dur < len) {
    g.gain.setValueAtTime(gain, t + Math.max(0, dur - 0.2));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.stop(t + dur + 0.02);
    len = dur;
  }
  return len;
}

/** Reproduce una variante al azar del grupo, sin repetir la anterior. */
function play(group, opts) {
  if (!ensure()) return 0;
  let names = GROUPS[group].filter((n) => buffers[n]);
  if (!names.length) return 0;
  if (names.length > 1) names = names.filter((n) => n !== last[group]);
  const name = names[Math.floor(Math.random() * names.length)];
  last[group] = name;
  return playName(name, opts);
}

/* ───────────── Respaldo sintetizado (si una grabación no cargó) ───────────── */

function burst(t, { dur, type = 'bandpass', f0, f1, q = 1, gain, attack = 0.004, pan = 0 }) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(f0, t);
  if (f1) filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(out(pan));
  src.start(t, rand(0, 1.5), dur + 0.05);
}

function tone(t, { freq, freqEnd, dur, gain, type = 'sine', attack = 0.002 }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.03);
}

const synthCard = (pan, delay) => {
  const t = at(delay);
  burst(t, { dur: 0.11, f0: 5000, f1: 1800, q: 0.9, gain: 0.3, attack: 0.006, pan });
};
const synthChip = (pan, delay) => {
  const t = at(delay);
  burst(t, { dur: 0.02, type: 'highpass', f0: 2400, q: 0.7, gain: 0.25, attack: 0.0015, pan });
};

/* ───────────── Sonidos de la mesa ───────────── */

/** Una carta sale del zapato y se desliza por el paño. */
export function card(pan = 0, delay = 0) {
  if (!play('slide', { pan, delay, gain: 0.8 }) && ctx) synthCard(pan, delay);
}

/** El crupier voltea su carta oculta. */
export function flip(pan = 0, delay = 0) {
  if (!play('place', { pan, delay, gain: 0.9, rate: [1, 1.08] }) && ctx) synthCard(pan, delay);
}

/** Fichas sobre la mesa: una ficha suelta o una pila. */
export function chips(n = 1, pan = 0, delay = 0) {
  if (!play(n > 1 ? 'stack' : 'lay', { pan, delay, gain: 0.85 }) && ctx) synthChip(pan, delay);
}

// Golpes limpios de ficha contra ficha (un solo impacto, sin rebote), de más grave a más
// brillante. Se eligieron midiendo cada grabación.
const CLACKS = ['chips-collide-1', 'chips-stack-4', 'chips-stack-1', 'chips-collide-2', 'chips-stack-2', 'chips-stack-5', 'chips-stack-6'];
// Las fichas de más valor suenan un poco más graves y pesadas.
const weight = (value) => Math.max(0.82, 1.06 - 0.012 * Math.log2(Math.max(1, value)));
let combo = 0;
let lastBet = 0;
let lastClack = '';

/**
 * Ficha que el jugador agrega a su apuesta. Si se agregan varias seguidas, cada golpe suena
 * un poco más agudo y brillante, como una pila que crece. La primera ficha cae en el paño.
 */
export function bet(value = 5, pan = 0, first = false) {
  if (!ensure()) return;
  const now = performance.now();
  combo = now - lastBet < 700 ? Math.min(combo + 1, 14) : 0;
  lastBet = now;
  const r = weight(value) * (1 + combo * 0.018);
  const rate = [r * 0.99, r * 1.01];
  if (first && playName('chip-lay-1', { pan, gain: 1, rate })) return;
  const top = Math.min(CLACKS.length - 1, 1 + Math.floor(combo / 2));
  let options = CLACKS.slice(Math.max(0, top - 2), top + 1).filter((n) => buffers[n] && n !== lastClack);
  if (!options.length) options = CLACKS.filter((n) => buffers[n]);
  if (!options.length) return synthChip(pan, 0);
  lastClack = options[Math.floor(Math.random() * options.length)];
  playName(lastClack, { pan, gain: 1, rate });
}

/** Marcar una ficha en la bandeja: un toque corto y suave. */
export function pick() {
  if (!playName('chip-lay-1', { gain: 0.45, rate: [1.18, 1.22] }) && ctx) synthChip(0, 0);
}

/** Duplicar la apuesta: una cascada corta de fichas. */
export function betDouble(pan = 0) {
  if (!ensure()) return;
  [0, 0.055, 0.1].forEach((d, i) => {
    const name = CLACKS[2 + i * 2];
    if (!playName(name, { pan, delay: d, gain: 0.9 - i * 0.1, rate: [1 + i * 0.03, 1.01 + i * 0.03] })) synthChip(pan, d);
  });
}

/** El crupier paga: apila las fichas junto a la apuesta. */
export function payout(pan = 0, delay = 0, big = false) {
  if (!play('stack', { pan, delay, gain: 0.85 }) && ctx) synthChip(pan, delay);
  play('stack', { pan, delay: delay + 0.16, gain: 0.7 });
  if (big) play('collide', { pan, delay: delay + 0.34, gain: 0.7 });
}

/** El crupier recoge una apuesta perdida. */
export function collect(pan = 0, delay = 0) {
  if (!play('handle', { pan, delay, gain: 0.75 }) && ctx) synthChip(pan, delay);
}

/** El crupier junta las cartas de la ronda anterior. */
export function sweep(delay = 0) {
  play('shove', { delay, gain: 0.7 });
}

/** La barajada: varios riffles seguidos. rate cambia el ritmo y maxDur la corta antes de terminar. */
export function shuffle(delay = 0, { rate = 1.08, maxDur = 0 } = {}) {
  return play('shuffle', { delay, gain: 0.8, rate: [rate, rate], dur: maxDur });
}

/** Tono del entrenador cuando la jugada es correcta. */
export function good() {
  if (!ensure()) return;
  const t = at(0);
  tone(t, { freq: 784, dur: 0.14, gain: 0.06, attack: 0.004 });
  tone(t + 0.07, { freq: 1175, dur: 0.22, gain: 0.05, attack: 0.004 });
}

/** Tono del entrenador cuando la jugada no es la de la tabla. */
export function bad() {
  if (!ensure()) return;
  tone(at(0), { freq: 330, freqEnd: 220, dur: 0.24, gain: 0.08, type: 'triangle', attack: 0.004 });
}

/* ───────────── Voz del crupier (síntesis de voz del sistema) ───────────── */

function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  const es = voices.filter((v) => /^es([-_]|$)/i.test(v.lang));
  esVoice = es.find((v) => /mónica|monica|paulina|jorge|google/i.test(v.name)) || es[0] || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  window.speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export function say(text) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = esVoice ? esVoice.lang : 'es-ES';
  if (esVoice) u.voice = esVoice;
  u.rate = 1.05;
  u.volume = Math.min(1, volume + 0.2);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export const hasVoice = () => 'speechSynthesis' in window;
