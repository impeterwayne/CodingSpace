# Terminal Architecture Research: VSCode-Style Separation Patterns

**Research Date**: 2026-05-10  
**Sources**: VSCode, xterm.js, WezTerm, Ghostty, tmux, and modern terminal emulator implementations

---

## Executive Summary

Modern terminal architectures separate concerns into **three distinct layers**:

1. **PTY/Process Layer** - Manages shell processes, I/O, and session lifecycle
2. **Terminal Model Layer** - Maintains terminal state without DOM dependencies  
3. **View/Renderer Layer** - Handles xterm.js attachment and DOM rendering

The critical insight: **Terminal instances can exist without being attached to the DOM**, enabling tab switching, background sessions, and reconnection without destroying state.

---

## Core Architectural Patterns

### 1. Three-Layer Separation

\\\
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  (Tab Management, Worktree Switching, UI Controllers)       │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│              Terminal Instance (Model)                       │
│  • Owns TerminalProcessManager (PTY lifecycle)              │
│  • Owns XtermTerminal (wrapper, no DOM refs)                │
│  • Manages state: title, cwd, shell type, capabilities      │
│  • Lifecycle: create → attach → detach → reattach → dispose │
│  • Can exist without DOM attachment                          │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
┌───────▼──────────┐    ┌────────▼─────────────┐
│ ProcessManager   │    │  XtermTerminal       │
│ (PTY Layer)      │    │  (View Wrapper)      │
│                  │    │                      │
│ • node-pty       │    │ • xterm.js instance  │
│ • I/O threads    │    │ • Addons             │
│ • Flow control   │    │ • attachToElement()  │
│ • Reconnection   │    │ • No DOM until open  │
└──────────────────┘    └──────────────────────┘
\\\

---

## Key Implementation Patterns

### Pattern 1: Attach/Detach Lifecycle

**VSCode Implementation** ([terminalInstance.ts#L1047-1079](https://github.com/microsoft/vscode/blob/9384620560b6ffa888a0c45f8c87ce41f7394f12/src/vs/workbench/contrib/terminal/browser/terminalInstance.ts#L1047-L1079)):

\\\	ypescript
class TerminalInstance {
  private _container: HTMLElement | undefined;
  private _wrapperElement: HTMLElement;  // Persistent wrapper
  private xterm: XtermTerminal | undefined;

  detachFromElement(): void {
    // Remove wrapper from DOM but keep it alive
    this._wrapperElement.remove();
    this._container = undefined;
    // xterm instance remains intact
  }

  attachToElement(container: HTMLElement): void {
    // Skip if already attached to same container
    if (this._container === container) return;

    // Move wrapper to new container
    this._container = container;
    this._container.appendChild(this._wrapperElement);

    // If xterm already opened, refresh for new window context
    if (this.xterm?.raw.element) {
      this.xterm.raw.open(this.xterm.raw.element);
    }

    this.xterm?.refresh();
  }
}
\\\

**Key Insights**:
- Wrapper element persists across detach/attach cycles
- xterm.js instance is never destroyed during tab switches
- Scrollback buffer, terminal state, and PTY connection survive
- Re-opening xterm on same element handles window context changes

---

### Pattern 2: XtermTerminal as Stateless View Wrapper

**VSCode Implementation** ([xtermTerminal.ts#L489-530](https://github.com/microsoft/vscode/blob/9384620560b6ffa888a0c45f8c87ce41f7394f12/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts#L489-L530)):

\\\	ypescript
class XtermTerminal {
  readonly raw: RawXtermTerminal;  // xterm.js instance
  private _attached?: { container: HTMLElement; options: IXtermAttachToElementOptions };

  attachToElement(container: HTMLElement, options?: Partial<IXtermAttachToElementOptions>): HTMLElement {
    if (!this._attached) {
      // First attachment: open xterm
      this.raw.open(container);
    }

    // Setup DOM event listeners (focus, blur, wheel)
    const ad = this._attachedDisposables;
    ad.clear();
    ad.add(dom.addDisposableListener(this.raw.textarea, 'focus', ...));
    ad.add(dom.addDisposableListener(this.raw.textarea, 'blur', ...));

    this._attached = { container, options };
    return container.querySelector('.xterm-screen')!;
  }
}
\\\

**Key Insights**:
- XtermTerminal wraps xterm.js but holds no business logic
- Attachment is idempotent and reentrant
- DOM listeners are disposable and recreated on each attach
- Returns screen element for widget attachment

---

### Pattern 3: PTY Process Independence

**VSCode Implementation** ([terminalProcessManager.ts#L74-100](https://github.com/microsoft/vscode/blob/9384620560b6ffa888a0c45f8c87ce41f7394f12/src/vs/workbench/contrib/terminal/browser/terminalProcessManager.ts#L74-L100)):

\\\	ypescript
class TerminalProcessManager {
  private _process: ITerminalChildProcess | null = null;
  processState: ProcessState = ProcessState.Uninitialized;
  
  // PTY runs independently of terminal attachment
  // Continues processing I/O even when terminal is detached
  
  onProcessData: Event<IProcessDataEvent>;  // Buffered if no consumer
  onProcessReady: Event<IProcessReadyEvent>;
  onProcessExit: Event<number | undefined>;
}
\\\

**Architecture** (from research):
\\\
┌──────────────────┐
│  Pty Host        │  Separate Node.js process
│  (node-pty)      │  • Crash isolation
│                  │  • Flow control
│  ┌────────────┐  │  • Event batching
│  │ PTY Reader │──┼──→ IPC Channel ──→ TerminalProcessManager
│  │  Thread    │  │
│  └────────────┘  │
│  ┌────────────┐  │
│  │ PTY Writer │  │
│  │  Thread    │  │
│  └────────────┘  │
└──────────────────┘
\\\

**Key Insights**:
- PTY runs in separate process for crash isolation
- Dedicated reader/writer threads prevent blocking
- Flow control: pause PTY when renderer falls behind
- Process survives terminal detachment

---

### Pattern 4: Central PTY Event Routing

**From WezTerm research** ([PTY and Process Management](https://deepwiki.com/wezterm/wezterm/4.5-pty-and-process-management)):

\\\	ypescript
// Conceptual pattern from WezTerm's architecture
class LocalPane {
  private pty: Mutex<Box<dyn MasterPty>>;
  private reader_thread: JoinHandle<()>;
  private parser_thread: JoinHandle<()>;

  // Reader thread: blocking PTY reads
  fn read_from_pane_pty() {
    loop {
      let data = pty.read();  // Blocking
      socket_pair.write(data);  // Non-blocking buffer
    }
  }

  // Parser thread: escape sequence processing
  fn parse_buffered_data() {
    loop {
      let data = socket_pair.read();
      terminal.perform_actions(parse(data));
    }
  }
}
\\\

**Key Insights**:
- Separate threads for I/O and parsing prevent blocking
- Socket pair decouples PTY reads from terminal updates
- Parser respects synchronized output mode (DEC 2026)
- Terminal state updates are atomic

---

### Pattern 5: Tab/Worktree Switching Without Destruction

**From Superset Terminal Cache** ([PR #3348](https://github.com/superset-sh/superset/pull/3348)):

\\\	ypescript
// Module-level singleton cache
const terminalCache = new Map<string, {
  xterm: Terminal;
  fitAddon: FitAddon;
  wrapper: HTMLDivElement;  // Detached wrapper
  stream: TerminalStream;   // tRPC subscription
}>();

function useTerminalLifecycle(paneId: string) {
  useEffect(() => {
    // On mount: reattach existing or create new
    const cached = terminalCache.get(paneId);
    if (cached) {
      // Fast path: reattach existing terminal
      containerRef.current.appendChild(cached.wrapper);
      cached.fitAddon.fit();
      // Stream already running, skip scrollback restore
    } else {
      // Slow path: create new terminal
      const { xterm, wrapper, stream } = createTerminal();
      terminalCache.set(paneId, { xterm, wrapper, stream });
      containerRef.current.appendChild(wrapper);
    }

    return () => {
      // On unmount: detach but keep alive
      const cached = terminalCache.get(paneId);
      if (cached && !isPaneDestroyed) {
        cached.wrapper.remove();  // Detach from DOM
        // xterm, stream, and buffer stay alive
      } else {
        // Only dispose on explicit pane destruction
        cached?.xterm.dispose();
        cached?.stream.unsubscribe();
        terminalCache.delete(paneId);
      }
    };
  }, [paneId]);
}
\\\

**Key Insights**:
- Cache keeps xterm instances alive across React mount/unmount
- Wrapper element is moved between containers, not recreated
- Reattach skips scrollback restoration (already in memory)
- Stream/subscription persists across tab switches
- Only dispose on explicit pane destruction

---

### Pattern 6: Explicit Attach/Detach Lifecycle

**From tmux Client Architecture** ([Client Lifecycle](https://deepwiki.com/tmux/tmux/6.5-client-lifecycle-and-attachment)):

\\\c
// tmux's client-server model
struct client {
    struct session *session;     // NULL when detached
    struct tty tty;              // Terminal characteristics
    int flags;                   // CLIENT_ATTACHED, CLIENT_DEAD, etc.
};

// Attach client to session
void server_client_set_session(struct client *c, struct session *s) {
    // 1. Update session tracking
    if (c->session) {
        c->session->last_client = NULL;
    }
    c->session = s;
    s->last_client = c;
    
    // 2. Set attached flag
    c->flags |= CLIENT_ATTACHED;
    
    // 3. Trigger full redraw
    server_redraw_client(c);
}

// Detach client from session
void server_client_detach(struct client *c) {
    c->session = NULL;
    c->flags |= CLIENT_EXIT;
    // Session continues running
}
\\\

**Key Insights**:
- Explicit attached/detached states
- Session persists independently of client attachment
- Multiple clients can attach to same session
- Detachment is clean separation, not destruction

---

## Best Practices for Your Refactor

### 1. **Separate Terminal Instance from DOM**

\\\	ypescript
// GOOD: Terminal instance owns state, not DOM
class TerminalInstance {
  private processManager: TerminalProcessManager;
  private xtermWrapper: XtermTerminal;
  private container?: HTMLElement;  // Optional, set on attach
  
  // Can exist without DOM
  constructor(shellConfig: IShellLaunchConfig) {
    this.processManager = new TerminalProcessManager(shellConfig);
    this.xtermWrapper = new XtermTerminal();
    // No DOM operations here
  }
}

// BAD: Terminal tightly coupled to DOM
class TerminalInstance {
  constructor(container: HTMLElement) {  // ❌ Requires DOM upfront
    this.xterm = new Terminal();
    this.xterm.open(container);  // ❌ Immediate attachment
  }
}
\\\

---

### 2. **Use Persistent Wrapper Element**

\\\	ypescript
class TerminalInstance {
  private readonly wrapperElement: HTMLDivElement;

  constructor() {
    // Create wrapper once, reuse forever
    this.wrapperElement = document.createElement('div');
    this.wrapperElement.className = 'terminal-wrapper';
  }

  attachToElement(container: HTMLElement): void {
    container.appendChild(this.wrapperElement);
    if (!this.xterm.raw.element) {
      // First attach: open xterm inside wrapper
      const xtermHost = document.createElement('div');
      this.wrapperElement.appendChild(xtermHost);
      this.xterm.attachToElement(xtermHost);
    }
  }

  detachFromElement(): void {
    this.wrapperElement.remove();  // Remove from DOM, keep alive
  }
}
\\\

---

### 3. **Implement Idempotent Attach**

\\\	ypescript
attachToElement(container: HTMLElement): void {
  // Guard: already attached to this container
  if (this.container === container) {
    return;
  }

  // Move wrapper to new container
  this.container = container;
  this.container.appendChild(this.wrapperElement);

  // Refresh xterm for new window context
  if (this.xterm?.raw.element) {
    this.xterm.raw.open(this.xterm.raw.element);
  }

  // Trigger resize to fit new container
  this.layout(this.container.getBoundingClientRect());
}
\\\

---

### 4. **Decouple PTY from Terminal Rendering**

\\\	ypescript
class TerminalProcessManager {
  private process: ITerminalChildProcess;
  private dataBuffer: Uint8Array[] = [];

  onProcessData = new Emitter<string>();

  constructor() {
    // PTY runs independently
    this.process.onData(data => {
      // Buffer data if no consumer attached
      if (this.onProcessData.hasListeners()) {
        this.onProcessData.fire(data);
      } else {
        this.dataBuffer.push(data);
      }
    });
  }

  // Terminal can attach/detach without affecting PTY
  attachConsumer(consumer: (data: string) => void): IDisposable {
    // Flush buffered data
    for (const data of this.dataBuffer) {
      consumer(data);
    }
    this.dataBuffer = [];

    return this.onProcessData.event(consumer);
  }
}
\\\

---

### 5. **Handle Worktree Switching**

\\\	ypescript
class WorktreeTerminalManager {
  private terminals = new Map<string, TerminalInstance>();
  private currentContainer: HTMLElement;

  switchToWorktree(worktreeId: string): void {
    // Detach current terminal
    const current = this.getCurrentTerminal();
    current?.detachFromElement();

    // Attach target terminal (create if needed)
    let terminal = this.terminals.get(worktreeId);
    if (!terminal) {
      terminal = new TerminalInstance({ cwd: worktreeId });
      this.terminals.set(worktreeId, terminal);
    }

    terminal.attachToElement(this.currentContainer);
    terminal.focus();
  }

  disposeWorktree(worktreeId: string): void {
    const terminal = this.terminals.get(worktreeId);
    if (terminal) {
      terminal.dispose();  // Kills PTY, disposes xterm
      this.terminals.delete(worktreeId);
    }
  }
}
\\\

---

### 6. **Implement Clean Disposal**

\\\	ypescript
class TerminalInstance extends Disposable {
  dispose(): void {
    // 1. Detach from DOM
    this.detachFromElement();

    // 2. Kill PTY process
    this.processManager.dispose();

    // 3. Dispose xterm and addons
    this.xterm?.dispose();

    // 4. Clean up listeners
    super.dispose();
  }
}
\\\

---

## Critical Separation Boundaries

| Layer | Responsibilities | Does NOT Handle |
|-------|-----------------|-----------------|
| **TerminalInstance** | • Lifecycle management<br>• State coordination<br>• Attach/detach orchestration | • DOM manipulation<br>• PTY I/O<br>• Escape sequence parsing |
| **XtermTerminal** | • xterm.js wrapper<br>• Addon management<br>• DOM attachment | • Process management<br>• Business logic<br>• State persistence |
| **TerminalProcessManager** | • PTY lifecycle<br>• I/O flow control<br>• Process monitoring | • Terminal rendering<br>• DOM events<br>• User interaction |

---

## Anti-Patterns to Avoid

### ❌ **Destroying Terminal on Tab Switch**
\\\	ypescript
// BAD: Recreates everything on switch
function switchTab(tabId: string) {
  currentTerminal.dispose();  // ❌ Kills PTY, loses state
  currentTerminal = new TerminalInstance();
  currentTerminal.open(container);
}
\\\

### ❌ **Tight Coupling to DOM**
\\\	ypescript
// BAD: Can't exist without DOM
class TerminalInstance {
  constructor(container: HTMLElement) {
    this.container = container;  // ❌ Required upfront
    this.xterm.open(container);
  }
}
\\\

### ❌ **Mixing Concerns**
\\\	ypescript
// BAD: Terminal handles PTY directly
class TerminalInstance {
  private pty: IPty;
  
  constructor() {
    this.pty = spawn('bash');  // ❌ Should be in ProcessManager
    this.pty.onData(data => {
      this.xterm.write(data);  // ❌ No buffering, flow control
    });
  }
}
\\\

---

## Implementation Checklist

- [ ] **Create TerminalInstance without DOM dependency**
  - Constructor takes shell config, not container
  - Can exist in "unattached" state
  
- [ ] **Implement attach/detach methods**
  - \ttachToElement(container: HTMLElement)\
  - \detachFromElement()\
  - Idempotent and reentrant
  
- [ ] **Use persistent wrapper element**
  - Created once in constructor
  - Moved between containers, not recreated
  
- [ ] **Separate XtermTerminal wrapper**
  - No business logic
  - Only handles xterm.js lifecycle
  - Returns screen element for widgets
  
- [ ] **Independent TerminalProcessManager**
  - Runs PTY regardless of attachment
  - Buffers data when no consumer
  - Handles flow control
  
- [ ] **Worktree switching support**
  - Map worktree ID → TerminalInstance
  - Detach old, attach new
  - Lazy creation on first switch
  
- [ ] **Clean disposal**
  - Detach from DOM
  - Kill PTY process
  - Dispose xterm instance
  - Clear all listeners

---

## References

### Primary Sources
- **VSCode Terminal**: [terminalInstance.ts](https://github.com/microsoft/vscode/blob/9384620560b6ffa888a0c45f8c87ce41f7394f12/src/vs/workbench/contrib/terminal/browser/terminalInstance.ts)
- **VSCode XtermTerminal**: [xtermTerminal.ts](https://github.com/microsoft/vscode/blob/9384620560b6ffa888a0c45f8c87ce41f7394f12/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts)
- **VSCode ProcessManager**: [terminalProcessManager.ts](https://github.com/microsoft/vscode/blob/9384620560b6ffa888a0c45f8c87ce41f7394f12/src/vs/workbench/contrib/terminal/browser/terminalProcessManager.ts)

### Architecture Documentation
- **WezTerm PTY Management**: [PTY and Process Management](https://deepwiki.com/wezterm/wezterm/4.5-pty-and-process-management)
- **VSCode Terminal Backend**: [Pty Host and Shell Processes](https://deepwiki.org/microsoft/vscode/6.2-terminal-backend:-pty-host-and-shell-processes)
- **tmux Client Lifecycle**: [Client Lifecycle and Attachment](https://deepwiki.com/tmux/tmux/6.5-client-lifecycle-and-attachment)

### Real-World Implementations
- **Superset Terminal Cache**: [PR #3348](https://github.com/superset-sh/superset/pull/3348) - Hide-attach pattern
- **Ghostty libghostty**: [Reconnectable Terminal Discussion](https://github.com/ghostty-org/ghostty/discussions/12176)
- **Open Relay PTY Architecture**: [ARCHITECTURE_PTY.md](https://github.com/slaveOftime/open-relay/blob/main/ARCHITECTURE_PTY.md)

### Additional Context
- **xterm.js Layering**: [Issue #1507](https://github.com/xtermjs/xterm.js/issues/1507) - Improved layering discussion
- **VSCode Pty Host**: [Issue #74620](https://github.com/microsoft/vscode/issues/74620) - Flow control and event batching
- **Terminal Fundamentals**: [TTY Architecture](https://www.terminfo.dev/fundamentals/tty-architecture)

---

**Generated**: 2026-05-10  
**For**: CodingSpace Terminal Refactor  
**Next Steps**: Apply these patterns to separate TerminalSession, TerminalView, and PTY management
