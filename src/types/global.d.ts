type OpenWindowsTerminalOptions = {
  cwd: string;
  sessionName?: string;
  launchCommand?: string;
  launchArgs?: string[];
};

type WorktreeRemovalOptions = {
  projectPath: string;
  wtPath: string;
  deleteBranch?: boolean;
};

type WorktreeRemovalResult = {
  success: boolean;
  output?: string;
  error?: string;
  branchDeleted?: boolean;
  removedWorktree?: boolean;
};

declare global {
  interface Window {
    api: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      getWorkspaces: () => Promise<any[]>;
      addProject: () => Promise<any>;
      removeProject: (path: string) => Promise<any>;
      refreshWorktrees: (path: string) => Promise<any>;
      getGitInfo: (path: string) => Promise<any>;
      getRecentCommits: (path: string) => Promise<any>;
      openWindowsTerminal: (opts: OpenWindowsTerminalOptions) => Promise<any>;
      openInEditor: (path: string) => Promise<any>;
      openInExplorer: (path: string) => Promise<any>;
      openInAndroidStudio: (path: string) => Promise<any>;
      openInAntigravity: (path: string) => Promise<any>;
      ptyCreate: (opts: any) => Promise<any>;
      ptyCreateTool: (opts: any) => Promise<any>;
      resolveToolLaunch: (opts: { command: string; args?: string[] }) => Promise<any>;
      ptyWrite: (id: string, data: string) => void;
      ptyResize: (id: string, cols: number, rows: number) => void;
      ptyKill: (id: string) => Promise<any>;
      onPtyData: (callback: (payload: { id: string; data: string }) => void) => () => void;
      onPtyExit: (callback: (payload: { id: string; exitCode: number }) => void) => () => void;
      getSettings: () => Promise<{ worktreeBasePath: string; subworktreeBranchParents?: Record<string, string> }>;
      updateSettings: (settings: { worktreeBasePath: string; subworktreeBranchParents?: Record<string, string> }) => Promise<{ worktreeBasePath: string; subworktreeBranchParents?: Record<string, string> }>;
      getWorkspaces: () => Promise<any[]>;
      gitPull: (path: string) => Promise<any>;
      gitFetch: (path: string) => Promise<any>;
      addWorktree: (opts: any) => Promise<any>;
      removeWorktree: (opts: WorktreeRemovalOptions) => Promise<WorktreeRemovalResult>;
      forceRemoveWorktree: (opts: WorktreeRemovalOptions) => Promise<WorktreeRemovalResult>;
      getBranches: (path: string) => Promise<string[]>;
      createBranch: (opts: any) => Promise<any>;
      mergeWorktreeToBranch: (opts: any) => Promise<any>;
    };
  }
}


export {};
