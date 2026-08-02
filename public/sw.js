/* Service worker — پوسته برنامه آفلاین کار می‌کند؛ درخواست‌های API هرگز کش نمی‌شوند. */
const CACHE = 'hesabyar-shell-v1-7-2';
const SHELL = [
  '/', '/index.html', '/assets/app.css', '/manifest.webmanifest',
  '/js/app.js', '/js/core.js', '/js/data.js', '/js/ui.js',
  '/js/views-sales.js', '/js/views-finance.js',
  '/js/views-chat.js', '/js/agent.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // فقط پاسخ‌های موفق کش می‌شوند تا خطاها جای محتوای سالم را نگیرند
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/index.html'))),
  );
});
