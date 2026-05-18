# Terminal Architecture Research Summary

## Research Completed: 2026-05-10

### Document Created
- **File**: TERMINAL_ARCHITECTURE_RESEARCH.md
- **Size**: 605 lines, 493 content lines
- **Commit**: ed65f73

### Key Findings

#### 1. Three-Layer Architecture Pattern
Modern terminal emulators (VSCode, WezTerm, Ghostty) separate concerns into:
- **PTY/Process Layer**: Manages shell processes, I/O, session lifecycle
- **Terminal Model Layer**: Maintains state without DOM dependencies
- **View/Renderer Layer**: Handles xterm.js attachment and rendering

#### 2. Critical Insight: DOM-Independent Terminal Instances
Terminal instances can exist without being attached to the DOM, enabling:
- Tab switching without destroying state
- Background sessions that continue running
- Reconnection without process restart
- Worktree switching without terminal recreation

#### 3. Attach/Detach Lifecycle Pattern
**VSCode Implementation** (with GitHub permalinks):
\\\	ypescript
detachFromElement(): void {
  this._wrapperElement.remove();  // Remove from DOM
  this._container = undefined;
  // xterm instance remains intact
}

attachToElement(container: HTMLElement): void {
  if (this._container === container) return;
  this._container = container;
  this._container.appendChild(this._wrapperElement);
  if (this.xterm?.raw.element) {
    this.xterm.raw.open(this.xterm.raw.element);
  }
  this.xterm?.refresh();
}
\\\

#### 4. Persistent Wrapper Element Pattern
- Wrapper element created once in constructor
- Moved between containers, never recreated
- Preserves xterm.js instance and scrollback buffer
- Enables instant tab switching

#### 5. PTY Process Independence
- PTY runs in separate process for crash isolation
- Dedicated reader/writer threads prevent blocking
- Flow control: pause PTY when renderer falls behind
- Process survives terminal detachment

#### 6. Central Event Routing
- Separate threads for I/O and parsing
- Socket pair decouples PTY reads from terminal updates
- Parser respects synchronized output mode
- Terminal state updates are atomic

### Implementation Checklist for Refactor

- [ ] Create TerminalInstance without DOM dependency
- [ ] Implement attach/detach methods (idempotent)
- [ ] Use persistent wrapper element
- [ ] Separate XtermTerminal wrapper (no business logic)
- [ ] Independent TerminalProcessManager
- [ ] Worktree switching support (Map<worktreeId, TerminalInstance>)
- [ ] Clean disposal (detach → kill PTY → dispose xterm)

### Sources Analyzed

**Primary Code Sources**:
- VSCode terminalInstance.ts (2933 lines)
- VSCode xtermTerminal.ts (1137 lines)
- VSCode terminalProcessManager.ts (894 lines)

**Architecture Documentation**:
- WezTerm PTY and Process Management
- VSCode Terminal Backend Architecture
- tmux Client Lifecycle and Attachment
- Ghostty libghostty Reconnectable Terminal

**Real-World Implementations**:
- Superset Terminal Cache (hide-attach pattern)
- Open Relay PTY Architecture
- xterm.js Layering Improvements

### Anti-Patterns Identified

❌ Destroying terminal on tab switch
❌ Tight coupling to DOM (requiring container in constructor)
❌ Mixing concerns (terminal handling PTY directly)
❌ Recreating xterm instances on reattach

### Next Steps

1. **Refactor TerminalSession** → Separate into:
   - TerminalInstance (model, owns state)
   - XtermWrapper (view, handles DOM)
   - ProcessManager (PTY lifecycle)

2. **Implement Attach/Detach**:
   - Add attachToElement(container) method
   - Add detachFromElement() method
   - Use persistent wrapper element

3. **Update Worktree Switching**:
   - Maintain Map<worktreeId, TerminalInstance>
   - Detach old terminal, attach new terminal
   - Lazy creation on first switch

4. **Test Scenarios**:
   - Switch between worktrees (no flicker)
   - Background terminal continues running
   - Scrollback preserved across switches
   - PTY survives detachment

### Benefits of This Architecture

✅ **No terminal recreation** on tab/worktree switch
✅ **Instant switching** (just DOM reparenting)
✅ **Preserved state** (scrollback, PTY, running processes)
✅ **Better separation** of concerns
✅ **Easier testing** (model layer has no DOM)
✅ **Crash isolation** (PTY in separate process)

---

**Research Duration**: ~2 hours
**Confidence Level**: High (based on production implementations)
**Ready for Implementation**: Yes
