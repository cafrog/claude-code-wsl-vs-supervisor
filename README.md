# Claude Code WSL VS Supervisor

> Dashboard Windows pour superviser en temps réel tous vos agents **Claude Code** à travers plusieurs fenêtres VS Code / WSL.

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="Claude Code WSL VS Supervisor" width="96" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-0078d4" />
  <img src="https://img.shields.io/badge/Tauri-v2-ffc131" />
  <img src="https://img.shields.io/badge/React-18-61dafb" />
  <img src="https://img.shields.io/badge/Rust-stable-dea584" />
</p>

## À quoi ça sert

Quand vous faites tourner 10-15 agents Claude Code en parallèle, perdus dans autant de terminaux VS Code, répartis sur plusieurs projets… vous passez votre temps à chercher **qui attend, qui bosse, et sur quoi**.

Ce dashboard vous donne en une vue :

- L'état de chaque agent : **thinking**, **coding**, **waiting**
- Le dernier message envoyé et la dernière réponse (en markdown)
- Regroupement par projet, drag-and-drop pour réordonner
- **Chat latéral** pour envoyer un message à un agent sans quitter le dashboard
- **Clic** sur un agent → focus direct sur son terminal dans VS Code

## Aperçu

![Screenshot dashboard](docs/screenshot.png)

## Fonctionnalités

- **Détection multi-signaux** du statut : CPU delta, I/O réseau, shells enfants — pour distinguer thinking / coding / waiting sans se tromper
- **Survit au `/clear`** : résolution automatique du bon log de session via mtime du dossier `projects/`
- **Chat temps réel** avec historique complet scrollable et rendu markdown
- **Envoi de message** à un agent depuis le dashboard — va directement dans le bon terminal VS Code via l'extension compagnon
- **Focus terminal précis** : même avec 3 agents dans la même fenêtre VS Code, le clic ouvre le bon onglet
- **Bannière de mise à jour** automatique : l'app se tient à jour sans intervention
- **Toujours au-dessus** optionnel pour un monitoring permanent
- **Interface Terminal Matrix** : sombre, dense, typographiée, rien de superflu

## Prérequis

- **Windows 10/11** avec WSL 2 activé
- **Claude Code** installé dans WSL (`npm install -g @anthropic-ai/claude-code`)
- **VS Code** avec l'extension "WSL" pour vos sessions de travail
- L'**extension VS Code compagnon** (fournie dans ce repo) installée dans vos fenêtres VS Code

## Installation utilisateur

1. Téléchargez le dernier installeur sur la [page Releases](../../releases/latest) (`Claude Code WSL VS Supervisor_x.y.z_x64-setup.exe`)
2. Lancez l'installeur, choisissez **"pour moi uniquement"** ou **"tous les utilisateurs"**
3. Depuis PowerShell, installez l'extension compagnon dans VS Code :
   ```powershell
   code --install-extension "<path>\claude-code-wsl-vs-supervisor-helper-x.y.z.vsix"
   ```
4. Rechargez vos fenêtres VS Code (`Ctrl+Shift+P` → *Developer: Reload Window*)
5. Lancez **Claude Code WSL VS Supervisor** depuis le menu Démarrer

L'app détecte automatiquement votre distribution WSL et votre user, et commence à lister les agents actifs.

## Développement

### Stack

- **Frontend** : React 18 + TypeScript + Tailwind CSS (style custom)
- **Backend** : Rust + Tauri v2
- **Bundle** : NSIS + MSI pour Windows
- **Extension VS Code** : TypeScript + Node `http` server local

### Arborescence

```
.
├── src/                        Frontend React
│   ├── components/            TopBar, Sidebar, ProjectBlock, AgentRow, ChatPanel, …
│   ├── hooks/                 useAgents (écoute events Tauri), useProjectOrder
│   ├── types.ts
│   └── App.tsx
├── src-tauri/                 Backend Rust
│   ├── src/
│   │   ├── config.rs          Auto-détection WSL + persistance
│   │   ├── sessions.rs        Parse ~/.claude/sessions/*.json
│   │   ├── history.rs         Parse projects/<project>/<session>.jsonl
│   │   ├── status.rs          Détection statut (CPU delta, I/O, shells)
│   │   ├── poller.rs          Boucle de polling (2.5s)
│   │   ├── focus.rs           Win32 SetForegroundWindow + discovery helpers
│   │   ├── process_ext.rs     CREATE_NO_WINDOW sur Windows
│   │   └── lib.rs             Commandes Tauri exposées
│   ├── icons/                 .ico, .icns, PNG multi-résolution
│   └── tauri.conf.json
└── vscode-extension/          Extension VS Code compagnon
    └── src/extension.ts       Serveur HTTP local /focus + /send
```

### Setup local

```bash
# Pré-requis : Node.js 20+, Rust stable, Windows Build Tools C++

# Frontend + deps
npm install

# Lancement dev (recompilation auto à chaque changement)
npm run tauri dev

# Build production (génère le .msi + l'installeur NSIS)
npm run tauri build -- --bundles nsis,msi
```

Les artefacts de build atterrissent dans `src-tauri/target/release/bundle/`.

### Extension VS Code

```bash
cd vscode-extension
npm install
npm run compile
npx vsce package --no-dependencies --allow-missing-repository
# Produit claude-code-wsl-vs-supervisor-helper-x.y.z.vsix
```

## Architecture de détection du statut

Claude Code ne signale pas son statut directement. Le backend inspecte :

| Signal | Source | Usage |
|---|---|---|
| **CPU delta** | `/proc/<pid>/stat` (utime+stime) | ≥ 10 ticks / poll = agent actif |
| **rchar delta** | `/proc/<pid>/io` | > 12 KB / poll = stream API → **thinking** |
| **shell children** | `pgrep -P <pid>` filtrés | bash/sh/zsh avec stdout non-task → **coding** |
| **file mtime** | `~/.claude/projects/<proj>/*.jsonl` | Identifie le log actif après `/clear` |

Ces signaux sont collectés en **un seul appel `wsl.exe`** par poll pour éviter les latences (sinon chaque appel ajoute ~100 ms). Le flag `CREATE_NO_WINDOW` évite le flash de fenêtre console.

## Mise à jour automatique

L'app vérifie un manifest JSON publié à chaque release GitHub. Si une nouvelle version est disponible, une bannière apparaît dans la TopBar avec bouton **"Mettre à jour"**. Le nouvel installeur est téléchargé, sa signature vérifiée avec la clé publique embarquée, et appliqué automatiquement.

### Publier une nouvelle version

```bash
# 1. Bump version dans package.json + src-tauri/tauri.conf.json + Cargo.toml
# 2. Commit + tag
git commit -am "release: v0.2.0"
git tag v0.2.0
git push origin main --tags
```

GitHub Actions se charge du reste : build Windows, signature, création d'une Release avec `.exe`, `.msi` et `latest.json`.

## Roadmap

- [x] **Windows + WSL** — la configuration actuelle
- [ ] **Vue en grille** alternative pour petites fenêtres
- [ ] **Historique des sessions** fermées
- [ ] **Raccourcis clavier** globaux pour focus rapide par numéro d'agent

## License

MIT

## Crédits

Construit avec [Tauri](https://tauri.app), [React](https://react.dev), et beaucoup de phosphore vert.
