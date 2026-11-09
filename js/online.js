// Conexión entre navegadores para la mesa en línea, con PeerJS.
// PeerJS usa su servicio público gratuito solo para que los navegadores se encuentren;
// las cartas, apuestas y jugadas viajan directo entre ellos (WebRTC).
// La biblioteca se carga solo cuando alguien crea una sala o se une a una.

const PEERJS = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/+esm';
const PREFIX = 'mesa21-sala-';
// Sin letras ni números que se confundan (O/0, I/1).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TIMEOUT = 12000;
// Servidores STUN públicos: cada navegador averigua cómo lo ven desde internet.
// (Los TURN que PeerJS trae por defecto ya no existen, así que no se usan.)
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] };
// Prueba en un solo computador: con ?localnet en la dirección, las pestañas se hablan por
// BroadcastChannel en vez de por la red. Los mensajes pasan por JSON, igual que con PeerJS.
const LOCAL = typeof location !== 'undefined' && new URLSearchParams(location.search).has('localnet');

let PeerClass = null;
async function loadPeer() {
  if (!PeerClass) {
    const mod = await import(PEERJS);
    PeerClass = mod.Peer || mod.default;
  }
  return PeerClass;
}

const newCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

function errorText(err) {
  switch (err && err.type) {
    case 'peer-unavailable':
      return 'No hay ninguna sala abierta con ese código.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'No se pudo conectar con el servicio para encontrar la sala. Revisa tu internet.';
    case 'browser-incompatible':
      return 'Este navegador no permite conexiones directas.';
    default:
      return (err && err.message) || 'No se pudo conectar.';
  }
}

function waitOpen(peer) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El servicio para encontrar la sala no respondió.')), TIMEOUT);
    peer.once('open', (id) => {
      clearTimeout(timer);
      resolve(id);
    });
    peer.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/**
 * Abre una sala nueva. Prueba varios códigos por si uno ya está en uso.
 * handlers: onJoin(conn), onData(conn, msg), onLeave(conn), onError(texto)
 */
export async function host(handlers) {
  if (LOCAL) return localHost(handlers);
  const Peer = await loadPeer();
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const peer = new Peer(PREFIX + code, { debug: 0, config: ICE });
    try {
      await waitOpen(peer);
    } catch (e) {
      peer.destroy();
      lastError = e;
      if (e && e.type === 'unavailable-id') continue;
      throw new Error(errorText(e));
    }
    peer.on('connection', (conn) => {
      conn.on('open', () => handlers.onJoin(conn));
      conn.on('data', (msg) => handlers.onData(conn, msg));
      conn.on('close', () => handlers.onLeave(conn));
      conn.on('error', () => handlers.onLeave(conn));
    });
    // Si se pierde el contacto con el servicio, las conexiones abiertas siguen; se intenta volver.
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', (e) => handlers.onError(errorText(e)));
    return { code, peer };
  }
  throw new Error(errorText(lastError));
}

/**
 * Se une a la sala `code`. handlers: onData(msg), onClose()
 */
export async function join(code, meta, handlers) {
  if (LOCAL) return localJoin(code, meta, handlers);
  const Peer = await loadPeer();
  const peer = new Peer({ debug: 0, config: ICE });
  try {
    await waitOpen(peer);
  } catch (e) {
    peer.destroy();
    throw new Error(errorText(e));
  }
  const conn = peer.connect(PREFIX + cleanCode(code), { reliable: true, serialization: 'json', metadata: meta });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('La sala existe, pero los dispositivos no lograron conectarse directo. Prueben conectados a la misma Wi‑Fi o con otra red: algunas redes móviles lo bloquean.')),
      TIMEOUT,
    );
    conn.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    peer.once('error', (e) => {
      clearTimeout(timer);
      reject(new Error(errorText(e)));
    });
  }).catch((e) => {
    peer.destroy();
    throw e;
  });
  conn.on('data', handlers.onData);
  conn.on('close', handlers.onClose);
  peer.on('disconnected', () => {
    if (!peer.destroyed) peer.reconnect();
  });
  return { peer, conn, id: peer.id };
}

export function send(conn, msg) {
  if (conn && conn.open) {
    try {
      conn.send(msg);
    } catch {
      /* la conexión se está cerrando */
    }
  }
}

export function close(peer) {
  try {
    peer && peer.destroy();
  } catch {
    /* ya estaba cerrada */
  }
}

/* ── Prueba local (?localnet): las pestañas del mismo navegador hacen de dispositivos ── */

const wire = (m) => JSON.parse(JSON.stringify(m));

function localHost(handlers) {
  const code = newCode();
  const bc = new BroadcastChannel(PREFIX + code);
  const conns = new Map();
  bc.onmessage = ({ data: m }) => {
    if (!m || m.to !== 'host') return;
    let conn = conns.get(m.from);
    if (m.type === 'connect' && !conn) {
      const c = {
        peer: m.from,
        open: true,
        metadata: m.meta,
        send: (msg) => bc.postMessage({ to: m.from, type: 'data', data: wire(msg) }),
        close() {
          if (!c.open) return;
          c.open = false;
          conns.delete(m.from);
          bc.postMessage({ to: m.from, type: 'close' });
          handlers.onLeave(c);
        },
      };
      conn = c;
      conns.set(m.from, conn);
      bc.postMessage({ to: m.from, type: 'accept' });
      handlers.onJoin(conn);
    } else if (m.type === 'data' && conn) {
      handlers.onData(conn, m.data);
    } else if (m.type === 'close' && conn) {
      conn.open = false;
      conns.delete(m.from);
      handlers.onLeave(conn);
    }
  };
  const peer = {
    destroyed: false,
    destroy() {
      if (peer.destroyed) return;
      peer.destroyed = true;
      for (const id of conns.keys()) bc.postMessage({ to: id, type: 'close' });
      conns.clear();
      bc.close();
    },
  };
  return { code, peer };
}

function localJoin(code, meta, handlers) {
  const id = `local-${Math.random().toString(36).slice(2, 10)}`;
  const bc = new BroadcastChannel(PREFIX + cleanCode(code));
  const conn = { peer: PREFIX + cleanCode(code), open: false, send: (msg) => bc.postMessage({ from: id, to: 'host', type: 'data', data: wire(msg) }) };
  const peer = {
    id,
    destroyed: false,
    destroy() {
      if (peer.destroyed) return;
      peer.destroyed = true;
      if (conn.open) bc.postMessage({ from: id, to: 'host', type: 'close' });
      conn.open = false;
      bc.close();
    },
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bc.close();
      reject(new Error('No hay ninguna sala abierta con ese código.'));
    }, 1500);
    bc.onmessage = ({ data: m }) => {
      if (!m || m.to !== id) return;
      if (m.type === 'accept') {
        clearTimeout(timer);
        conn.open = true;
        resolve({ peer, conn, id });
      } else if (m.type === 'data') handlers.onData(m.data);
      else if (m.type === 'close') {
        conn.open = false;
        handlers.onClose();
      }
    };
    addEventListener('pagehide', () => peer.destroy());
    bc.postMessage({ from: id, to: 'host', type: 'connect', meta });
  });
}
