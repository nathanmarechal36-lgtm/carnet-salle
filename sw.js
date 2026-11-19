// Service worker : l'appli fonctionne hors ligne et se met à jour quand le réseau est là.
const CACHE = 'carnet-salle-v9';
const FILES = ['./', './index.html', './guide.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
// Photos des exercices : mises en cache à l'installation (sans bloquer si l'une manque)
const PHOTOS = 'peck tpoulie arnold russian presse abduct pompes elat extnuque rowc dih curlinc nordic cmj sj tirv lext curlez sdt dc rowu hipthrust mbslam rowb roue deadbug bandpull dm splitj efront dipst curlpup dcs face adduct mollets crunchp frontsq boxj gainlat broadj tuck mbthrow hack stepup curlm oiseau pullo squat dropj pallof skull molassis trac rotext calfsl dips lomb dib planche rdj dch lcurl trapdl shrug gobletsq curlpb fentes'
  .split(' ').flatMap(id => ['./' + id + '-0.jpg', './' + id + '-1.jpg']);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES).then(() =>
    Promise.all(PHOTOS.map(p => c.add(p).catch(() => {})))
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Page : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
    e.respondWith(
      fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put('./index.html', c)); return r; })
        .catch(() => caches.match('./index.html'))
    );
  } else {
    // Fichiers : cache d'abord, sinon réseau (et on garde une copie).
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); }
      return r;
    })));
  }
});
