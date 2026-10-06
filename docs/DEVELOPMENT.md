# Développement de WikiTools

Le code Firefox de la version 0.14.2 se trouve dans `src/`. Son manifeste contient l’identifiant et l’adresse de mises à jour utilisés pour la distribution GitHub. Ne pas les modifier pour une simple mise à jour.

## Commandes

Node.js 24 ou supérieur et pnpm 11.25.0 :

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
```

Les tests peuvent être lancés sans dépendances : `node scripts/test.cjs`.

La construction crée un ZIP **non signé** dans `dist/`, sans les tests. Un paquet déjà signé ne doit jamais être modifié : les futures versions seront à faire signer par Mozilla.

## Organisation

- `src/` : fichiers de l’extension et icône.
- `src/tests/` : tests automatisés.
- `scripts/` : lancement des tests et de web-ext.
- `docs/` : instructions techniques et notes de relecture.
- `assets/` : visuels du dépôt existant.

Le README, les visuels et la licence existants ont été conservés. Aucun fichier iPhone, sauvegarde, dépendance installée ou image personnelle ne fait partie de cet import.

## Publier une mise à jour

Augmenter la version dans `src/manifest.json` et `package.json`, tester puis construire. Faire signer le ZIP par Mozilla et joindre le XPI signé à la nouvelle Release. Joindre également un `updates.json` correspondant au nom et au tag réels du fichier signé. Le manifeste consulte :

https://github.com/0xBricks/WikiTools/releases/latest/download/updates.json

L’envoi de code sur la branche principale ne met pas à jour les installations des utilisateurs. Les Releases et leurs fichiers ne sont pas modifiés par cet import.

## Validation

52 tests passent. web-ext ne signale aucune erreur et conserve deux avertissements connus concernant les versions minimales déclarées pour la collecte de données (Firefox 115 contre prise en charge 140/142). La licence du dépôt est définie par le fichier LICENSE à la racine.
