# Coding Space

Coding Space is a developer workspace manager built on Electron and TypeScript. It optimizes development workflows using Git worktrees, allowing you to manage branches concurrently, share directories via symlinks, integrate AI agent toolkits (OpenSpec), and operate using embedded or external terminal interfaces.

![Coding Space Interface](assets/screenshot.png)

## Features

- **Git Worktree Orchestration**: Automated scanning, lifecycle management, and branch/merge syncing directly from the UI.
- **Symlink Management**: Share large directories like `node_modules` or assets between worktrees to save disk space.
- **AI Agent Toolkit**: Deploy shared AI skills, command definitions, and prompt templates (OpenSpec, Antigravity, Claude, Codex, OpenCode) with automatic `.git/info/exclude` configuration.
- **Terminal Integration**: Integrated tabs via xterm.js and node-pty with resizing, plus a toggle to spawn sessions in external Windows Terminal windows. The new-tab menu includes danger-marked Codex (YOLO), Claude, and Antigravity CLI launchers for explicitly unsandboxed / permission-bypassed sessions.
- **Quick Launcher**: One-click launcher for VS Code, Android Studio, Antigravity IDE, Antigravity Agent Manager, and Windows Explorer.

## Getting Started

### Requirements
- Windows 10/11
- Node.js (v20+ recommended)
- Git

### Installation & Run
```bash
npm install
npm start
```

## Packaging for Windows

```bash
# Generate NSIS installer and portable EXE
npm run make

# Windows target explicitly
npm run make:win

# Fast packaged build (unpacked directory)
npm run pack
```

All build artifacts are written to the `release/` directory.

## Codebase Architecture

- **Main Process**: [src/main/main.ts](file:///D:/Quest/CodingSpace/src/main/main.ts) & [src/main/ipc/workspaceIpc.ts](file:///D:/Quest/CodingSpace/src/main/ipc/workspaceIpc.ts)
- **Preload Bridge**: [src/main/preload.ts](file:///D:/Quest/CodingSpace/src/main/preload.ts)
- **Renderer Frontend**: [src/renderer/index.html](file:///D:/Quest/CodingSpace/src/renderer/index.html), [src/renderer/app.ts](file:///D:/Quest/CodingSpace/src/renderer/app.ts), & [src/renderer/styles.css](file:///D:/Quest/CodingSpace/src/renderer/styles.css)
- **Services**: [src/application/workspaceService.ts](file:///D:/Quest/CodingSpace/src/application/workspaceService.ts) & [src/application/workspaceConfigStore.ts](file:///D:/Quest/CodingSpace/src/application/workspaceConfigStore.ts)
