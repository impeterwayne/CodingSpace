# Coding Space

[English](README.md) | [Tiếng Việt](README.vi.md)

Coding Space is a developer workspace manager built on Electron and TypeScript. It optimizes development workflows using Git worktrees, allowing you to manage branches concurrently, share directories via symlinks, integrate AI agent toolkits (OpenSpec), and operate using embedded or external terminal interfaces.

![Coding Space Interface](assets/screenshot.png)

## Features

- **Git Worktree Orchestration**: Automated scanning, lifecycle management, and branch/merge syncing directly from the UI.
- **Symlink Management**: Share large directories like `node_modules` or assets between worktrees to save disk space.
- **AI Agent Toolkit**: Deploy shared AI skills, command definitions, and prompt templates (OpenSpec, Antigravity, Claude, Codex, OpenCode) with automatic `.git/info/exclude` configuration.
- **Terminal Integration**: Integrated tabs via xterm.js and node-pty with resizing, plus a toggle to spawn sessions in an external terminal (Windows Terminal on Windows, Terminal.app on macOS, the system terminal emulator on Linux). The new-tab menu includes danger-marked Codex (YOLO), Claude, and Antigravity CLI launchers for explicitly unsandboxed / permission-bypassed sessions.
- **Prefix Shortcuts**: Press `Ctrl+B`, then a key within 2s — `c` / `Alt+T` terminal, `Alt+C` Claude, `Alt+Shift+C` Codex (YOLO), `Alt+A` Antigravity, `Alt+O` OpenCode. `Ctrl+B` twice sends a literal `Ctrl+B` to the terminal.
- **Quick Launcher**: One-click launcher for VS Code, Android Studio, Antigravity IDE, Antigravity Agent Manager, Claude Desktop, and the OS file manager (Explorer / Finder / Files).

## Getting Started

### Requirements
- Windows 10/11, macOS 11+, or a modern x64 Linux desktop
- Node.js (v20+ recommended)
- Git
- Linux only: a C++ toolchain for building `node-pty` (`sudo apt install build-essential python3` on Debian/Ubuntu)

### Installation & Run
```bash
npm install
npm start
```

## Packaging

```bash
# Build for the current OS using its default targets
npm run make

# Windows: NSIS installer + portable EXE (x64)
npm run make:win

# macOS: DMG + ZIP (arm64 and x64) — must run on macOS
npm run make:mac

# Linux: AppImage + .deb (x64) — must run on Linux
npm run make:linux

# Fast packaged build (unpacked directory)
npm run pack
```

All build artifacts are written to the `release/` directory.

`node-pty` is a native module, so each platform has to be packaged on that platform. The
[Build workflow](.github/workflows/build.yml) does this on GitHub Actions for all three OSes —
run it manually or push a `v*` tag, then download the installers from the run's artifacts.

macOS builds are not code-signed or notarized. After downloading, either right-click the app →
**Open**, or clear the quarantine flag with `xattr -cr "/Applications/Coding Space.app"`.

## Codebase Architecture

- **Main Process**: [src/main/main.ts](src/main/main.ts) & [src/main/ipc/workspaceIpc.ts](src/main/ipc/workspaceIpc.ts)
- **Preload Bridge**: [src/main/preload.ts](src/main/preload.ts)
- **Renderer Frontend**: [src/renderer/index.html](src/renderer/index.html), [src/renderer/app.ts](src/renderer/app.ts), & [src/renderer/styles.css](src/renderer/styles.css)
- **Services**: [src/application/workspaceService.ts](src/application/workspaceService.ts) & [src/application/workspaceConfigStore.ts](src/application/workspaceConfigStore.ts)
