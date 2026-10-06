# Installer WikiTools sur Firefox PC

1. Ouvre les [Releases](https://github.com/0xBricks/WikiTools/releases) et télécharge le **XPI signé** de la version voulue (pas les archives « Source code »).
2. Dans Firefox, ouvre `about:addons`.
3. Clique sur la roue dentée, puis **Installer un module depuis un fichier…**.
4. Sélectionne le XPI, confirme l’installation et recharge WikiMasters.
5. Les réglages sont dans **Outils Wiki**, en bas à droite de la page du jeu.

Pour tester le code sans signature : télécharge et décompresse le dépôt, ouvre `about:debugging#/runtime/this-firefox`, puis **Charger un module complémentaire temporaire** et sélectionne `src/manifest.json`. Cette installation temporaire disparaît au redémarrage de Firefox.

Les cadenas et personnalisations sont locaux au profil Firefox. Garde le même identifiant d’extension pour les mises à jour ; une installation avec un autre identifiant ne reprend pas automatiquement les données.
