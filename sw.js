// Service worker de Mesa 21: guarda los archivos para poder jugar sin internet.
// Los archivos propios se piden primero a la red (así siempre se ve la última versión)
// y, si no hay conexión, se usan los guardados. Las fuentes se sirven desde el caché.
const CACHE = 'mesa21-v2';
const SOUNDS = [
  'card-place-1', 'card-place-2', 'card-place-3', 'card-place-4', 'card-shove-1', 'card-shove-2', 'card-shuffle',
  'card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-4', 'card-slide-5', 'chip-lay-1', 'chip-lay-2', 'chip-lay-3',
  'chips-collide-1', 'chips-collide-2', 'chips-handle-1', 'chips-handle-2', 'chips-handle-3', 'chips-handle-4',
  'chips-stack-1', 'chips-stack-2', 'chips-stack-3', 'chips-stack-4', 'chips-stack-5', 'chips-stack-6',
].map((n) => `sounds/${n}.mp3`);
const FILES = [
  './', 'index.html', 'css/styles.css', 'js/app.js', 'js/strategy.js', 'js/sound.js', 'js/online.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  ...SOUNDS,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./'))),
    );
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
