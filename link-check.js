#!/usr/bin/env node
// link-check : vérifie les liens des fichiers Markdown (fichiers locaux + URL http/https).
// Usage : node dev/link-check.js [dossier]   (Node 18+)
const fs = require('fs');
const path = require('path');

const root = process.argv[2] || '.';
const SKIP = new Set(['node_modules', '.git']);
function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
    SKIP.has(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.md') ? [path.join(d, e.name)] : []);
}

async function alive(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(8000) });
      if (r.ok) return true;
    } catch { /* on essaie la méthode suivante */ }
  }
  return false;
}

(async () => {
  const dead = [];
  let total = 0;
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const link = m[1].split('#')[0];
      if (!link || link.startsWith('mailto:')) continue;
      total++;
      const ok = /^https?:/.test(link) ? await alive(link) : fs.existsSync(path.resolve(path.dirname(file), link));
      if (!ok) dead.push(`${file} → ${link}`);
    }
  }
  console.log(`${total} lien(s) vérifié(s), ${dead.length} mort(s).`);
  dead.forEach(d => console.log('  ✗', d));
  process.exit(dead.length ? 1 : 0);
})();
