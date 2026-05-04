# Terminal HQ

A premium Electron workspace manager for git worktree-based development workflows on Windows. Launch Windows Terminal with tmux for each worktree with a single click.

## Features

- **Git Worktree Management** — Auto-detects all worktrees in your project
- **Windows Terminal Integration** — Launch `wt.exe` with tmux (`tmux new-session -A -s <name>`) per workspace
- **tmux Toggle** — Enable/disable tmux session auto-start globally
- **Git Status Dashboard** — See branch, modified files, ahead/behind, and last commit at a glance
- **Quick Actions** — Pull, fetch, open VS Code, or explore any worktree
- **Worktree Creation** — Add new worktrees from available branches via modal
- **Persistent Config** — Projects are saved and restored between sessions

## Getting Started

```bash
cd terminal-hq
npm install
npm start
```

## Usage

1. Click **Add Project** to select a git repository root
2. All worktrees are displayed as cards with git status
3. Click **Terminal** on any worktree to open Windows Terminal (with tmux if enabled)
4. Use **Code** to open in VS Code, or **Pull** for quick git pull

## Requirements

- Windows 10/11
- [Windows Terminal](https://aka.ms/terminal) (`wt.exe` in PATH)
- [tmux](https://github.com/tmux/tmux) (if using tmux toggle — install via MSYS2 or WSL)
- Git

## Project Structure

```
terminal-hq/
├── src/
│   ├── main/
│   │   ├── main.js      # Electron main process
│   │   └── preload.js    # Context bridge
│   └── renderer/
│       ├── index.html    # App shell
│       ├── styles.css    # Dark premium design system
│       └── app.js        # Renderer logic
├── package.json
└── .gitignore
```
