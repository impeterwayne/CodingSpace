# Coding Space

My Coding Space

## Features

- **Git Worktree Management** — Auto-detects all worktrees in your project.
- **Embedded Terminal** — Built-in `xterm.js` and `node-pty` terminal tabs.
- **psmux Integration** — Automatically start psmux sessions inside the embedded terminal.
- **Git Status Dashboard** — See branch, modified files, ahead/behind, and last commit at a glance.
- **Quick Actions** — Open VS Code, Android Studio, Antigravity, or Windows Explorer with a single click.
- **Quick Tools** — Launch tools like OpenCode and Gemini directly in terminal tabs.
- **Persistent Config** — Projects are saved and restored between sessions.

## Getting Started

```bash
npm install
npm start
```

## Usage

1. Click **Add Project** to select a git repository root.
2. Select a worktree to view its integrated terminal.
3. Use the **+** button in the terminal tab bar to open new terminals, OpenCode, or Gemini.
4. Use quick action buttons to open the worktree in VS Code, Android Studio, or Antigravity.

## Requirements

- Windows 10/11
- Node.js & npm
- Git
- [psmux](https://github.com/psmux/psmux) (optional, for psmux integration)
