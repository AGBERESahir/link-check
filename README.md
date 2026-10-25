# link-check

Détecte les **liens morts** dans tes fichiers Markdown : fichiers locaux introuvables, **ancres** (`#section`) qui ne mènent nulle part et URL qui ne répondent plus.

Idéal avant de publier un README, une documentation ou un dépôt rempli de fichiers `.md` : un lien cassé donne tout de suite une impression de projet abandonné.

- Aucune dépendance, un seul fichier, Node 18 ou plus.
- Rapide : les URL sont testées en parallèle, et une URL présente dix fois n'est testée qu'une fois.
- Indique le **fichier et la ligne** de chaque problème.
- Utilisable en CI : code de sortie `1` si un lien est mort, sortie JSON possible.

## Ce qui est vérifié

| Type de lien | Exemple | Vérification |
|---|---|---|
| Fichier local | `[guide](docs/guide.md)` | Le fichier ou dossier existe. |
| Ancre dans le même fichier | `[voir](#installation)` | Un titre correspondant existe (règle d'identifiants de GitHub, accents conservés, doublons `titre-1`, `titre-2`). |
| Ancre dans un autre fichier | `[voir](guide.md#usage)` | Le fichier existe **et** contient ce titre. |
| URL web | `[site](https://exemple.org)` | Réponse 2xx ou 3xx (essai `HEAD`, puis `GET`). |
| Liens de référence, images, autoliens | `[id]: ./x.md`, `![logo](logo.png)`, `<https://…>` | Même contrôle que ci-dessus. |

**Ignorés volontairement** : `mailto:`, `tel:`, les liens situés dans les blocs de code et le code inline (ce sont des exemples), et les notes de bas de page.

**Avertissement plutôt que « mort »** : si un site répond 401, 403 ou 429, il refuse souvent les robots alors que la page existe. Le lien est signalé par `!`, sans faire échouer la vérification.

## Installation

Sans rien installer :

```bash
npx github:AGBERESahir/link-check
```

Ou en clonant le dépôt :

```bash
git clone https://github.com/AGBERESahir/link-check.git
cd link-check
node link-check.js /chemin/vers/ton/projet
```

## Utilisation

```text
link-check [dossier-ou-fichier ...] [options]
```

Sans argument, le dossier courant est analysé récursivement (`node_modules` et `.git` sont ignorés).

| Option | Effet |
|---|---|
| `--offline` | Vérifie seulement les liens locaux et les ancres, sans accès réseau. |
| `--timeout=MS` | Délai maximal par URL (défaut : `8000`). |
| `--concurrency=N` | Nombre de requêtes en parallèle (défaut : `8`). |
| `--ignore=REGEX` | Ignore les liens qui correspondent à l'expression, par exemple `--ignore=localhost`. |
| `--json` | Affiche un rapport JSON : `{ verifies, morts, avertissements }`. |
| `-h`, `--help` | Affiche l'aide. |

### Exemple de rapport

```text
$ link-check docs/ README.md
42 lien(s) vérifié(s), 3 mort(s), 1 avertissement(s).
  ✗ README.md:12 → guide.md#installaton (ancre #installaton introuvable dans guide.md)
  ✗ docs/api.md:30 → ./images/schema.png (fichier introuvable)
  ✗ docs/api.md:44 → https://exemple.org/ancienne-page (HTTP 404)
  ! docs/api.md:51 → https://reseau-social.exemple/profil (HTTP 403 (accès refusé aux robots ?))
```

### En intégration continue (GitHub Actions)

```yaml
name: Liens
on: [push, pull_request]
jobs:
  liens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx github:AGBERESahir/link-check
```

Pour un contrôle rapide sans réseau (par exemple dans un hook `pre-commit`), utilise `npx github:AGBERESahir/link-check --offline`.

## Limites connues

- Les URL qui contiennent des parenthèses (certaines pages Wikipédia) peuvent être mal découpées : encode-les (`%28`, `%29`).
- Seules les ancres des fichiers Markdown sont vérifiées, pas celles d'une page HTML distante.
- Une page qui répond 200 mais dont le contenu a changé n'est pas détectée : l'outil vérifie que le lien répond, pas qu'il dit encore la même chose.

## Développement

```bash
npm test          # tests node:test, aucune dépendance à installer
npm run check     # lance link-check en mode hors ligne sur ce dépôt
```

Les fonctions `extraireLiens`, `slug`, `ancres` et `verifierLocal` sont exportées par `link-check.js`.

## Licence

MIT, voir [LICENSE](LICENSE).
