// Service worker : l'appli fonctionne hors ligne et se met à jour quand le réseau est là.
const CACHE = 'carnet-salle-v30';
// Les photos d'exercices ont leur propre cache, gardé d'une version à l'autre
const PHOTO_CACHE = 'yosha-photos-1';
const FILES = ['./', './index.html', './guide.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './anton.woff2'];
// Fichiers utiles hors ligne, sans bloquer l'installation si l'un manque.
// Les photos ne sont plus téléchargées d'avance : elles se mettent en cache quand on les ouvre.
const EXTRA = []
  .concat(['./fb-app.js', './fb-auth.js', './fb-firestore.js', './fb-messaging.js', './installer.html', './legal.html']);

// Notifications : le programme d'envoi (Google Apps Script) passe par Firebase Cloud Messaging
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  const p = Object.assign({}, d.notification || {}, d.data || {}, d.title ? d : {});
  e.waitUntil(self.registration.showNotification(p.title || 'Yosha', {
    body: p.body || '', icon: './icon-192.png', badge: './icon-192.png',
    tag: p.tag || undefined, data: { url: p.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return clients.openWindow(url);
  }));
});

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES).then(() =>
    Promise.all(EXTRA.map(p => c.add(p).catch(() => {})))
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== PHOTO_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Page : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
    e.respondWith(
      // Chaque page est rangée sous sa propre adresse (sans ?…) : le guide ou la page légale ne remplacent plus l'appli
      fetch(req).then(r => {
        if (r.ok) { const u = new URL(req.url), key = u.pathname.endsWith('/') ? './index.html' : u.origin + u.pathname, c = r.clone(); caches.open(CACHE).then(x => x.put(key, c)); }
        return r;
      }).catch(() => {
        const u = new URL(req.url);
        return caches.match(u.pathname.endsWith('/') ? './index.html' : u.origin + u.pathname).then(h => h || caches.match('./index.html'));
      })
    );
  } else {
    // Fichiers : cache d'abord, sinon réseau (et on garde une copie).
    const box = /.jpg$/i.test(new URL(req.url).pathname) ? PHOTO_CACHE : CACHE;
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(box).then(x => x.put(req, c)); }
      return r;
    })));
  }
});
