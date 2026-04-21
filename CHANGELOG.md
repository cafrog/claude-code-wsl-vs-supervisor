# Changelog

Toutes les versions notables de **Claude Code WSL VS Supervisor**.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le
versioning [SemVer](https://semver.org/lang/fr/).

## [Unreleased]

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
