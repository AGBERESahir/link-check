#!/usr/bin/env node
// link-check : vérifie les liens des fichiers Markdown (fichiers locaux, ancres #titre, URL http/https).
// Voir README.md pour toutes les options.
const fs = require('fs');
const path = require('path');

const AIDE = `link-check : détecte les liens morts dans les fichiers Markdown.

Usage :
  link-check [dossier-ou-fichier ...] [options]

Options :
  --offline            Ne vérifie que les liens locaux et les ancres (aucun accès réseau)
  --timeout=MS         Délai maximal par URL (défaut : 8000)
  --concurrency=N      Nombre de requêtes en parallèle (défaut : 8)
  --ignore=REGEX       Ignore les liens correspondant à l'expression (ex. --ignore=localhost)
  --json               Sortie JSON (pour les scripts et la CI)
  -h, --help           Affiche cette aide

Code de sortie : 0 si aucun lien mort, 1 sinon.`;

const IGNORES = new Set(['node_modules', '.git']);

// Remplace le code (blocs et inline) par des espaces, en gardant les retours à la ligne :
// les liens d'exemple ne sont pas vérifiés et les numéros de ligne restent exacts.
function masquerCode(texte) {
  const blanc = s => s.replace(/[^\n]/g, ' ');
  return texte
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, blanc)
    .replace(/`[^`\n]*`/g, blanc);
}

function extraireLiens(texte) {
  const t = masquerCode(texte);
  const liens = [];
  const ajouter = (index, url) => liens.push({ ligne: t.slice(0, index).split('\n').length, url });
  for (const m of t.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*["'])?\s*\)/g)) ajouter(m.index, m[1]);
  for (const m of t.matchAll(/^ {0,3}\[(?!\^)[^\]]+\]:\s*<?(\S+?)>?(?:\s+["'(].*)?$/gm)) {
    if (/^(https?:|\/|\.{1,2}\/|#)|[./]/.test(m[1])) ajouter(m.index, m[1]);
  }
  for (const m of t.matchAll(/<(https?:\/\/[^>\s]+)>/g)) ajouter(m.index, m[1]);
  return liens;
}

// Identifiant d'ancre tel que GitHub le fabrique à partir d'un titre.
function slug(titre) {
  return titre.trim().toLowerCase()
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*~]/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function ancres(texte) {
  const trouvees = new Set();
  const compte = new Map();
  for (const m of masquerCode(texte).matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    const base = slug(m[1]);
    const n = compte.get(base) || 0;
    compte.set(base, n + 1);
    trouvees.add(n ? `${base}-${n}` : base);          // doublons : titre, titre-1, titre-2...
  }
  for (const m of texte.matchAll(/<a\s+[^>]*(?:name|id)=["']([^"']+)["']/gi)) trouvees.add(m[1].toLowerCase());
  return trouvees;
}

const cacheAncres = new Map();
function ancresDe(fichier) {
  if (!cacheAncres.has(fichier)) cacheAncres.set(fichier, ancres(fs.readFileSync(fichier, 'utf8')));
  return cacheAncres.get(fichier);
}

const decoder = s => { try { return decodeURIComponent(s); } catch { return s; } };

// Retourne null si le lien local est bon, sinon la raison de l'échec.
function verifierLocal(fichier, lien, racine) {
  const [sansAncre, ...reste] = lien.split('#');
  const ancre = reste.join('#');
  const chemin = decoder(sansAncre.split('?')[0]);
  const cible = !chemin ? fichier
    : chemin.startsWith('/') ? path.join(racine, chemin)
    : path.resolve(path.dirname(fichier), chemin);
  if (!fs.existsSync(cible)) return 'fichier introuvable';
  if (ancre && /\.(md|markdown)$/i.test(cible) && fs.statSync(cible).isFile()) {
    if (!ancresDe(cible).has(decoder(ancre).toLowerCase())) {
      return `ancre #${ancre} introuvable dans ${path.relative(racine, cible) || path.basename(cible)}`;
    }
  }
  return null;
}

// 2xx/3xx : vivant. 401, 403, 429 : le site refuse les robots, on avertit sans condamner.
async function verifierUrl(url, delai) {
  let derniere = 'aucune réponse';
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(url, {
        method, redirect: 'follow', signal: AbortSignal.timeout(delai),
        headers: { 'user-agent': 'link-check (+https://github.com/AGBERESahir/link-check)' },
      });
      if (r.ok) return { etat: 'ok' };
      if ([401, 403, 429].includes(r.status)) return { etat: 'avertissement', raison: `HTTP ${r.status} (accès refusé aux robots ?)` };
      derniere = `HTTP ${r.status}`;
    } catch (e) {
      derniere = e.name === 'TimeoutError' ? `délai dépassé (${delai} ms)` : 'serveur injoignable';
    }
  }
  return { etat: 'mort', raison: derniere };
}

async function pool(taches, n) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, taches.length) }, async () => {
    while (i < taches.length) await taches[i++]();
  }));
}

function fichiersMarkdown(entree) {
  const st = fs.statSync(entree);
  if (st.isFile()) return [entree];
  return fs.readdirSync(entree, { withFileTypes: true }).flatMap(e =>
    IGNORES.has(e.name) ? [] : e.isDirectory() ? fichiersMarkdown(path.join(entree, e.name))
      : /\.(md|markdown)$/i.test(e.name) ? [path.join(entree, e.name)] : []);
}

async function main(argv) {
  if (argv.includes('-h') || argv.includes('--help')) { console.log(AIDE); return 0; }
  const opt = n => (argv.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=');
  const hors = argv.includes('--offline'), json = argv.includes('--json');
  const delai = parseInt(opt('timeout'), 10) || 8000;
  const parallele = parseInt(opt('concurrency'), 10) || 8;
  const ignore = opt('ignore') ? new RegExp(opt('ignore')) : null;
  const entrees = argv.filter(a => !a.startsWith('-'));
  if (!entrees.length) entrees.push('.');
  for (const e of entrees) if (!fs.existsSync(e)) { console.error(`Introuvable : ${e}`); return 1; }

  const racine = path.resolve(entrees[0]) && (fs.statSync(entrees[0]).isDirectory() ? path.resolve(entrees[0]) : path.dirname(path.resolve(entrees[0])));
  const morts = [], avertissements = [], distants = new Map();
  let total = 0;

  for (const fichier of entrees.flatMap(fichiersMarkdown)) {
    for (const { ligne, url } of extraireLiens(fs.readFileSync(fichier, 'utf8'))) {
      if (/^(mailto:|tel:|javascript:|data:)/i.test(url) || (ignore && ignore.test(url))) continue;
      total++;
      const lien = url.startsWith('//') ? 'https:' + url : url;
      if (/^https?:/i.test(lien)) {
        if (!distants.has(lien)) distants.set(lien, []);
        distants.get(lien).push({ fichier, ligne });
      } else {
        const raison = verifierLocal(fichier, lien, racine);
        if (raison) morts.push({ fichier, ligne, lien: url, raison });
      }
    }
  }

  if (!hors) {
    await pool([...distants].map(([url, lieux]) => async () => {
      const r = await verifierUrl(url, delai);
      for (const l of lieux) {
        if (r.etat === 'mort') morts.push({ ...l, lien: url, raison: r.raison });
        if (r.etat === 'avertissement') avertissements.push({ ...l, lien: url, raison: r.raison });
      }
    }), parallele);
  } else {
    total -= [...distants.values()].reduce((s, l) => s + l.length, 0);
  }

  const tri = (a, b) => a.fichier.localeCompare(b.fichier) || a.ligne - b.ligne;
  morts.sort(tri); avertissements.sort(tri);
  if (json) {
    console.log(JSON.stringify({ verifies: total, morts, avertissements }, null, 2));
  } else {
    console.log(`${total} lien(s) vérifié(s)${hors ? ' (mode hors ligne)' : ''}, ${morts.length} mort(s), ${avertissements.length} avertissement(s).`);
    morts.forEach(m => console.log(`  ✗ ${m.fichier}:${m.ligne} → ${m.lien} (${m.raison})`));
    avertissements.forEach(m => console.log(`  ! ${m.fichier}:${m.ligne} → ${m.lien} (${m.raison})`));
  }
  return morts.length ? 1 : 0;
}

module.exports = { extraireLiens, slug, ancres, masquerCode, verifierLocal };
if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c));
