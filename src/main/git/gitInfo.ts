function getWorktrees(projectPath, execSync, path, Buffer) {
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 10000,
    });

    const worktrees: Array<{ path?: string; head?: string; branch?: string; bare?: boolean; detached?: boolean; name?: string; id?: string }> = [];
    let current: { path?: string; head?: string; branch?: string; bare?: boolean; detached?: boolean; name?: string; id?: string } = {};

    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        current = { path: line.replace('worktree ', '').trim() };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.replace('HEAD ', '').trim();
      } else if (line.startsWith('branch ')) {
        current.branch = line.replace('branch refs/heads/', '').trim();
      } else if (line === 'bare') {
        current.bare = true;
      } else if (line === 'detached') {
        current.detached = true;
      } else if (line === '') {
        if (current.path) {
          current.name = path.basename(current.path);
          current.id = Buffer.from(current.path).toString('base64url');
          worktrees.push(current);
        }
        current = {};
      }
    }

    return worktrees;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Failed to get worktrees for', projectPath, ':', message);
    return [];
  }
}

function getGitInfo(dirPath, execSync) {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: dirPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    const statusOutput = execSync('git status --porcelain', {
      cwd: dirPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    const modifiedCount = statusOutput ? statusOutput.split('\n').length : 0;

    let lastCommit = '';
    let lastCommitDate = '';
    try {
      lastCommit = execSync('git log -1 --format="%s"', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      lastCommitDate = execSync('git log -1 --format="%cr"', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch (_) {
      // Ignore when repository has no commits yet.
    }

    let aheadBehind = '';
    try {
      aheadBehind = execSync('git rev-list --left-right --count HEAD...@{upstream}', {
        cwd: dirPath,
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
    } catch (_) {
      // Ignore when branch has no upstream configured.
    }

    return { branch, modifiedCount, lastCommit, lastCommitDate, aheadBehind };
  } catch (e) {
    return { branch: 'unknown', modifiedCount: 0, lastCommit: '', lastCommitDate: '', aheadBehind: '' };
  }
}

module.exports = {
  getWorktrees,
  getGitInfo,
};
