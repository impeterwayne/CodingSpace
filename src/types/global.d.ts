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
      openExternal: (url: string) => Promise<any>;
      openInAndroidStudio: (path: string) => Promise<any>;
      openInAntigravity: (path: string) => Promise<any>;
      openInAntigravityAgent: (path: string) => Promise<any>;
      ptyCreate: (opts: any) => Promise<any>;
      ptyCreateTool: (opts: any) => Promise<any>;
      resolveToolLaunch: (opts: { command: string; args?: string[] }) => Promise<any>;
      ptyWrite: (id: string, data: string) => void;
      ptyResize: (id: string, cols: number, rows: number) => void;
      ptyKill: (id: string) => Promise<any>;
      onPtyData: (callback: (payload: { id: string; data: string }) => void) => () => void;
      onPtyExit: (callback: (payload: { id: string; exitCode: number }) => void) => () => void;
      getSettings: () => Promise<{
        subworktreeBranchParents?: Record<string, string>;
        vscodePath?: string;
        androidStudioPath?: string;
        antigravityPath?: string;
        antigravityAgentPath?: string;
        openspecSourcePath?: string;
        bmadSourcePath?: string;
        autoRefreshCurrentProject?: boolean;
        autoRefreshInterval?: number;
      }>;
      updateSettings: (settings: {
        subworktreeBranchParents?: Record<string, string>;
        vscodePath?: string;
        androidStudioPath?: string;
        antigravityPath?: string;
        antigravityAgentPath?: string;
        openspecSourcePath?: string;
        bmadSourcePath?: string;
        autoRefreshCurrentProject?: boolean;
        autoRefreshInterval?: number;
      }) => Promise<{
        subworktreeBranchParents?: Record<string, string>;
        vscodePath?: string;
        androidStudioPath?: string;
        antigravityPath?: string;
        antigravityAgentPath?: string;
        openspecSourcePath?: string;
        bmadSourcePath?: string;
        autoRefreshCurrentProject?: boolean;
        autoRefreshInterval?: number;
      }>;
      selectExecutable: () => Promise<string | null>;
      detectIntegrationPaths: () => Promise<{
        antigravityPath: string | null;
        antigravityAgentPath: string | null;
        androidStudioPath: string | null;
        vscodePath: string | null;
      }>;
      gitPull: (path: string) => Promise<any>;
      gitFetch: (path: string) => Promise<any>;
      addWorktree: (opts: any) => Promise<any>;
      removeWorktree: (opts: WorktreeRemovalOptions) => Promise<WorktreeRemovalResult>;
      forceRemoveWorktree: (opts: WorktreeRemovalOptions) => Promise<WorktreeRemovalResult>;
      getBranches: (path: string) => Promise<string[]>;
      createBranch: (opts: any) => Promise<any>;
      mergeWorktreeToBranch: (opts: any) => Promise<any>;
      selectDirectory: (title: string) => Promise<string | null>;
      checkSymlinkStatus: (opts: { worktreePath: string; name: string; targetPath: string }) => Promise<any>;
      createSymlink: (opts: { worktreePath: string; name: string; targetPath: string }) => Promise<any>;
      deleteSymlink: (opts: { worktreePath: string; name: string }) => Promise<any>;
      scanSymlinks: (opts: { worktreePath: string }) => Promise<any[]>;
      updateGitExclude: (opts: { worktreePath: string; patterns: string[]; action: 'add' | 'remove' }) => Promise<any>;
      createDirectory: (path: string) => Promise<any>;
      pathExists: (path: string) => Promise<boolean>;
      checkToolkitStatus: (opts: { worktreePath: string; name: string; sourcePath?: string }) => Promise<{ exists: boolean }>;
      deployToolkit: (opts: { worktreePath: string; name: string; sourcePath: string }) => Promise<{ success: boolean; error?: string }>;
      removeToolkit: (opts: { worktreePath: string; name: string; sourcePath?: string }) => Promise<{ success: boolean; error?: string }>;
      getDefaultToolkitSources: () => Promise<{ openspecPath: string; bmadPath: string }>;
    };
  }
}


export {};
