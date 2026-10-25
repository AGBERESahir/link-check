const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extraireLiens, slug, ancres, verifierLocal } = require('../link-check.js');

test('ignore les liens dans le code et donne le bon numéro de ligne', () => {
  const liens = extraireLiens('[a](a.md)\n```\n[b](b.md)\n```\n`[c](c.md)` [d](d.md "titre")\n');
  assert.deepStrictEqual(liens, [{ ligne: 1, url: 'a.md' }, { ligne: 5, url: 'd.md' }]);
});

test('reconnaît liens de référence et autoliens, pas les notes de bas de page', () => {
  const liens = extraireLiens('[x]: ./x.md\n[^1]: une note\n<https://exemple.org>\n');
  assert.deepStrictEqual(liens.map(l => l.url), ['./x.md', 'https://exemple.org']);
});

test('slug suit la règle GitHub (accents conservés, ponctuation retirée)', () => {
  assert.strictEqual(slug('Ce que l’outil ne fait pas'), 'ce-que-loutil-ne-fait-pas');
  assert.strictEqual(slug('Installation & `usage`'), 'installation--usage');
});

test('ancres : doublons numérotés', () => {
  const a = ancres('# Titre\n## Suite\n## Suite\n');
  assert.ok(a.has('titre') && a.has('suite') && a.has('suite-1'));
});

test('verifierLocal : fichier, ancre valide et ancre cassée', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-'));
  fs.writeFileSync(path.join(dir, 'a.md'), '# A\n');
  fs.writeFileSync(path.join(dir, 'b.md'), '# B\n## Partie\n');
  const f = path.join(dir, 'a.md');
  assert.strictEqual(verifierLocal(f, 'b.md#partie', dir), null);
  assert.match(verifierLocal(f, 'b.md#autre', dir), /ancre/);
  assert.strictEqual(verifierLocal(f, 'absent.md', dir), 'fichier introuvable');
});
