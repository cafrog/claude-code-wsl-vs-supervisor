# Changelog

Toutes les versions notables de **Claude Code WSL VS Supervisor**.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le
versioning [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

## [0.1.21] - 2026-04-22

### Ajouté

- Tri cliquable sur les en-têtes de colonnes (statut, agent, dernier message,
  dernière réponse, δt). Le tri réordonne les agents **à l'intérieur** de
  chaque projet et les projets eux-mêmes selon leur agent le plus pertinent
  (le plus frais pour δt, le plus prioritaire pour le statut, etc.). Cycle
  des clics : ascendant → descendant → ordre par défaut. Pour les timestamps,
  ascendant signifie « le plus récent en premier ». Le choix est persisté
  entre les lancements.

## [0.1.2] - 2026-04-22

### Corrigé

- L'ordre personnalisé des projets était perdu à chaque redémarrage de l'app :
  le premier render réconciliait la liste persistée avec un tableau de projets
  encore vide (avant que le poller ait livré ses données) et écrasait donc
  la sauvegarde. Le hook `useProjectOrder` ignore désormais cette phase.

### Ajouté

- Header projet enrichi : affichage du délai depuis la dernière interaction
  à côté du compteur d'agents, coloré selon la fraîcheur (vert < 1 min,
  ambre < 10 min, gris au-delà).
- Quand un projet est plié, une ligne compacte affiche le nom de l'agent le
  plus récent et un extrait du dernier échange, pour avoir le contexte sans
  déplier.

## [0.1.1] - 2026-04-22

### Corrigé

- Statut bloqué sur "pense" après une commande locale (`/mcp`, `/model`, etc.) :
  le tag `<local-command-caveat>` est maintenant filtré au même titre que les
  autres messages synthétiques de Claude Code.
- L'auto-updater ne détectait aucune mise à jour : le fichier `latest.json`
  manquait dans les releases GitHub à cause d'un bug de `tauri-action` avec les
  espaces dans le `productName`. Une étape dédiée du workflow génère et uploade
  désormais `latest.json` + le `.nsis.zip` signé.

### Ajouté

- Le badge de version dans la barre d'en-tête est maintenant **cliquable** pour
  forcer immédiatement une recherche de mise à jour (icône `↻` pendant la
  vérification, retour à `✓ à jour` ensuite).

### Modifié

- L'auto-updater vérifie désormais les nouvelles versions toutes les 30 min
  pendant que l'app tourne, et immédiatement au retour de focus sur la fenêtre
  (plus seulement au démarrage).

## [0.1.0] - 2026-04-21

Première release publique.

### Ajouté

- Dashboard temps réel des agents Claude Code actifs dans WSL
- Détection multi-signaux du statut (thinking / coding / waiting)
  - CPU delta via `/proc/<pid>/stat`
  - rchar delta via `/proc/<pid>/io`
  - shells enfants foreground filtrés
- Regroupement par projet avec drag-and-drop pour réordonner
- Collapse / expand par projet, état persistant (localStorage)
- Chat latéral avec historique complet, rendu markdown et typing indicator live
- Envoi de messages directement depuis le dashboard au terminal cible
- Extension VS Code compagnon (endpoints `/focus` et `/send`)
- Détection du bon log après `/clear` via mtime des fichiers `projects/`
- Filtrage des messages synthétiques (`<task-notification>`, `<system-reminder>`)
- Option "Toujours au-dessus" pour monitoring permanent
- Filtres sidebar par projet et par statut
- Barre de recherche globale
- Auto-updater Tauri avec signature minisign
- Build GitHub Actions automatisé sur tag `v*`
- Installeurs MSI + NSIS pour Windows 10/11
- Icône custom phosphore sur fond sombre

### Connu

- L'extension VS Code compagnon doit être installée manuellement après chaque
  mise à jour majeure (pour reload les endpoints)
- Après `/clear` dans un agent, quelques secondes peuvent s'écouler avant que
  le dashboard détecte le changement de sessionId
