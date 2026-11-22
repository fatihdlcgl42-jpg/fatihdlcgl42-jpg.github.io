// Çevrimdışı çalışma: uygulama dosyaları telefona önbelleğe alınır.
// Bu dosya hiçbir kullanıcı verisine dokunmaz; veriler IndexedDB'dedir.
const ONBELLEK = 'kisisel-finans-v2';
const TEMEL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(ONBELLEK).then((c) => c.addAll(TEMEL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((adlar) => Promise.all(adlar.filter((a) => a !== ONBELLEK).map((a) => caches.delete(a))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const istek = e.request;
  if (istek.method !== 'GET' || new URL(istek.url).origin !== self.location.origin) return;

  // Ekonomi verisi (/veri/*.json): önce internet (güncel kalsın), yoksa önbellek.
  if (new URL(istek.url).pathname.includes('/veri/')) {
    e.respondWith(
      fetch(istek)
        .then((yanit) => {
          if (yanit.ok) {
            const kopya = yanit.clone();
            caches.open(ONBELLEK).then((c) => c.put(istek, kopya));
          }
          return yanit;
        })
        .catch(() => caches.match(istek)),
    );
    return;
  }

  // Sayfanın kendisi: önce internet (güncelleme gelsin), yoksa önbellek.
  if (istek.mode === 'navigate') {
    e.respondWith(
      fetch(istek)
        .then((yanit) => {
          const kopya = yanit.clone();
          caches.open(ONBELLEK).then((c) => c.put('./index.html', kopya));
          return yanit;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Diğer dosyalar (adları içerik özetli): önce önbellek, yoksa internet ve önbelleğe al.
  e.respondWith(
    caches.match(istek).then(
      (bulunan) =>
        bulunan ||
        fetch(istek).then((yanit) => {
          if (yanit.ok) {
            const kopya = yanit.clone();
            caches.open(ONBELLEK).then((c) => c.put(istek, kopya));
          }
          return yanit;
        }),
    ),
  );
});
