/* 离线缓存：装到手机主屏后没网也能算番 */
var CACHE = 'mahjong-fan-v3';
var ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/tiles.js',
  'js/decompose.js',
  'js/hand.js',
  'js/render.js',
  'js/rules/common.js',
  'js/rules/mcr.js',
  'js/rules/riichi.js',
  'js/rules/sichuan.js',
  'js/rules/guangdong.js',
  'js/rules/taiwan.js',
  'js/rules/hongkong.js',
  'js/rules/index.js',
  'js/glossary.js',
  'js/glossary-page.js',
  'js/vision-local.js',
  'js/recognize.js',
  'js/score.js',
  'js/room-core.js',
  'js/lan.js',
  'js/host.js',
  'server/rooms.js',
  'js/app.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    /* 逐个装，个别文件缺失不至于整份缓存失败 */
    return Promise.all(ASSETS.map(function (u) {
      return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      return k === CACHE ? null : caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (new URL(req.url).pathname.indexOf('/api') === 0) return;
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('index.html');
      });
    })
  );
});
