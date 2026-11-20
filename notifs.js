// KIAI : envoi des notifications (lancé toutes les 15 min par GitHub Actions, gratuit).
// Lit les réglages users/{uid}/push/cfg écrits par l'appli, et envoie via Firebase Cloud Messaging.
// La clé du compte de service vient du secret GitHub FIREBASE_SERVICE_ACCOUNT : elle n'est jamais dans ce fichier.
const admin = require('firebase-admin');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
const db = admin.firestore();
const fcm = admin.messaging();

// Une notification part si l'heure prévue est passée depuis moins de 3 h et qu'elle n'est pas déjà partie aujourd'hui
const WINDOW = 180;

const TONE = {
  volley: ['Aujourd’hui, on vise plus haut que le filet.', 'Tant que le ballon n’a pas touché le sol, rien n’est fini.', 'Seul on saute, ensemble on vole.'],
  foot: ['Ton ego est ton moteur. Fais-le rugir.', 'Un vrai attaquant ne doute jamais devant le but.', 'Sois plus affamé que les autres.'],
  basket: ['Entre dans la zone : plus rien d’autre n’existe.', 'L’équipe, c’est toi plus quatre.', 'Le travail ne ment pas.'],
  rugby: ['On avance ensemble, ou on n’avance pas.', 'Plaque bas, relève-toi, recommence.', 'Le courage se travaille comme un muscle.']
};
const pick = (sport, n) => { const l = TONE[sport] || TONE.volley; return l[n % l.length]; };

// Date et heure locales de l'utilisateur (fuseau enregistré par l'appli)
function localNow(tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz || 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const wd = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday); // 0 = lundi, comme dans l'appli
  return { date, wd, min: (+p.hour) * 60 + (+p.minute) };
}
const addDays = (ds, n) => { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const toMin = hhmm => { const [h, m] = String(hhmm || '18:00').split(':').map(Number); return h * 60 + (m || 0); };
const fr = n => String(Math.round(n * 10) / 10).replace('.', ',');

const teamCache = {};
async function teamProgress(code, monday) {
  if (!teamCache[code]) {
    const s = await db.collection('teams').doc(code).collection('members').get();
    teamCache[code] = s.docs.map(d => d.data());
  }
  const L = teamCache[code], cur = L.filter(m => m.wkOf === monday);
  const kg = cur.reduce((a, m) => a + (m.wkKg || 0), 0), tgt = Math.max(10000, L.length * 6000);
  return { kg, tgt };
}

async function main() {
  const snap = await db.collectionGroup('push').get();
  let sent = 0;
  for (const doc of snap.docs) {
    const c = doc.data();
    if (!c.on || !Array.isArray(c.tokens) || !c.tokens.length) continue;
    const t = c.t || {}, now = localNow(c.tz), done = Object.assign({}, c.sent || {});
    const msgs = [];
    const due = (key, target) => now.min >= target && now.min < target + WINDOW && done[key] !== now.date;
    const n = Math.floor(Date.parse(now.date) / 864e5);

    // Rappel de séance : 30 min avant, les jours choisis
    if (t.rappel !== false && (c.rdays || []).includes(now.wd)) {
      const target = Math.max(0, toMin(c.rtime) - 30);
      if (due('rappel', target)) msgs.push(['rappel', 'Séance dans 30 min 💪', pick(c.sport, n) + ' Fais ton bilan forme avant de commencer.']);
    }
    // Veille de match : 20 h
    if (t.veille !== false && c.match && c.match === addDays(now.date, 1) && due('veille', 20 * 60)) {
      msgs.push(['veille', 'Match demain 🔥', 'Pas de jambes lourdes ni de sauts aujourd’hui. Féculents ce soir et au lit tôt.']);
    }
    // Défi d'équipe : dimanche 18 h
    if (t.defi !== false && c.team && now.wd === 6 && due('defi', 18 * 60)) {
      try {
        const { kg, tgt } = await teamProgress(c.team, addDays(now.date, -6));
        msgs.push(['defi', 'Défi d’équipe', kg >= tgt
          ? `Défi réussi : ${fr(kg / 1000)} t soulevées ensemble cette semaine 🔥`
          : `L’équipe est à ${fr(kg / 1000)} t sur ${fr(tgt / 1000)} t. Dernier jour pour aller la chercher !`]);
      } catch (e) { console.warn('équipe', c.team, e.message); }
    }
    // Bilan de la semaine : lundi 9 h
    if (t.bilan !== false && now.wd === 0 && due('bilan', 9 * 60)) {
      msgs.push(['bilan', 'Nouvelle semaine 気合', 'Ton bilan t’attend, et de nouveaux défis aussi.']);
    }
    if (!msgs.length) continue;

    const dead = new Set();
    for (const [key, title, body] of msgs) {
      for (const token of c.tokens) {
        try {
          await fcm.send({ token, webpush: { headers: { Urgency: 'high', TTL: '7200' }, data: { title, body, tag: 'kiai-' + key, url: './' } } });
          sent++;
        } catch (e) {
          const code = e.code || (e.errorInfo && e.errorInfo.code) || '';
          if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) dead.add(token);
          else console.warn('envoi', code, e.message);
        }
      }
      done[key] = now.date;
    }
    const upd = { sent: done };
    if (dead.size) upd.tokens = admin.firestore.FieldValue.arrayRemove(...dead);
    await doc.ref.set(upd, { merge: true });
  }
  console.log(`${snap.size} abonnés, ${sent} notification(s) envoyée(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
