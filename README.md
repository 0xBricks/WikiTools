<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.png">
    <img src="assets/banner.png" alt="WikiTools+" width="100%">
  </picture>
</p>

<p align="center">
  <img src="https://img.shields.io/github/license/0xBricks/WikiTools?style=flat-square&v=4" alt="Licence">
  <img src="https://img.shields.io/github/v/release/0xBricks/WikiTools?style=flat-square&v=4" alt="Version">
  <img src="https://img.shields.io/github/stars/0xBricks/WikiTools?style=flat-square&v=4" alt="Stars">
  <img src="https://img.shields.io/github/issues/0xBricks/WikiTools?style=flat-square&v=4" alt="Issues">
</p>

<p align="center">
  <b>Personnalise tes cartes et simplifie la gestion de ta collection WikiMasters.</b>
</p>

## Fonctionnalités

- **Cadenas** : protège les cartes de ton choix contre les ventes et défausses accidentelles réalisées depuis ce navigateur.
- **Étiquettes** : applique plusieurs étiquettes à tes cartes pour organiser ta collection.
- **Full Art** : personnalise les cartes de toutes les raretés, avec leur image d’origine ou une image importée. Ajuste le cadrage, le zoom, le halo et les effets visuels.
- **Raccourcis clavier** : utilise Entrée et les flèches pendant l’ouverture des boosters.

Les fonctions peuvent être activées ou désactivées depuis le menu **Outils Wiki** du site.

## Installation sur Firefox

1. Ouvre la page des [releases](https://github.com/0xBricks/WikiTools/releases).
2. Dans les fichiers de la release, télécharge le fichier **`.xpi` signé**. Les archives « Source code » contiennent le code, pas le module prêt à installer.
3. Dans Firefox, ouvre `about:addons`.
4. Clique sur la roue dentée, puis sur **Installer un module depuis un fichier…**.
5. Sélectionne le fichier `.xpi` et confirme l’installation.
6. Ouvre ou recharge [WikiMasters](https://www.wiki-masters.com/).

Il n’est pas nécessaire de décompresser le XPI ou d’activer un mode développeur. Cette version est destinée à Firefox ; aucune version Chrome n’est proposée ici.

## Utilisation

Ouvre le menu **Outils Wiki**, affiché sur le site, pour activer les fonctions et accéder aux réglages.

Pour personnaliser une carte, active le Full Art, lance la sélection d’une carte depuis son panneau, puis clique sur la carte dans la page. Tu peux ensuite choisir une image, ajuster son cadrage et activer ou désactiver son halo.

Sur la page d’ouverture des boosters :

| Touche | Action |
|---|---|
| Entrée | Activer le bouton d’ouverture ou de continuation disponible |
| Flèche gauche / droite | Utiliser la navigation disponible entre les cartes |

Les raccourcis peuvent être désactivés dans le menu. Il n’y a pas de raccourci clavier dédié aux cadenas.

## Sauvegarde et limites

Les cadenas, les réglages et les images importées sont enregistrés localement dans le profil Firefox. Ils restent disponibles après la fermeture du navigateur, mais ne sont pas synchronisés entre appareils. La suppression des données de l’extension ou sa désinstallation peut les effacer.

Les images importées sont traitées sur ton appareil et ne sont pas envoyées à un serveur par l’extension. Les personnalisations Full Art sont visibles dans ton navigateur.

Les cadenas sont une protection locale : ils ne verrouillent pas les cartes sur ton compte depuis un autre navigateur ou appareil. Une évolution du site, de ses sélecteurs ou de ses composants internes peut perturber certaines fonctions.

## Mises à jour

L’extension est configurée pour rechercher ses mises à jour via les releases GitHub. Pour qu’une nouvelle version soit proposée automatiquement, sa release doit fournir le XPI signé et un fichier `updates.json` à jour. Publier uniquement des modifications du code source ne met pas à jour les extensions installées.

## Code source et retours

Le dossier [`src`](src) contient le code de l’extension. Pour l’utiliser normalement, installe le XPI signé depuis les releases.

Pour signaler un bug ou proposer une amélioration, ouvre une [issue](https://github.com/0xBricks/WikiTools/issues) en indiquant ta version de Firefox, celle de WikiTools et les étapes permettant de reproduire le problème.

## Licence

Le code est distribué sous licence **Apache 2.0**. Consulte le fichier [LICENSE](LICENSE).

WikiTools est un projet communautaire non officiel, non affilié à WikiMasters.
