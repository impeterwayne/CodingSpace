function getAvailableWorktreeBranches(project, branches) {
  const existingWtBranches = (project?.worktrees || []).map((w) => w?.branch).filter(Boolean);
  return (branches || []).filter((branch) => !existingWtBranches.includes(branch) && !branch.startsWith('origin/'));
}

function isInvalidGitBranchName(branchName) {
  return /[\s~^:?*\[\\]/.test(String(branchName || ''));
}

function branchToPascalPath(branch) {
  if (!branch) return '';
  const shortName = branch.includes('/') ? branch.substring(branch.lastIndexOf('/') + 1) : branch;
  return shortName
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function getSuggestedWorktreePath(baseDir, projectName, branch) {
  return branch ? `${baseDir}\\${projectName}-${branchToPascalPath(branch)}` : '';
}

function getWorktreeBasePath(project) {
  return `${project.path}.subworktree`;
}

function getOfficialWorktreeBasePath(project) {
  return `${project.path}.worktrees`;
}

function normalizePathForComparison(inputPath) {
  return String(inputPath || '')
    .replace(/[\\/]+/g, '\\')
    .replace(/[\\]+$/, '')
    .toLowerCase();
}

function classifyWorktreeLocation(project, wt) {
  if (!project || !wt?.path) return 'subworktree';

  const projectPath = normalizePathForComparison(project.path);
  const worktreePath = normalizePathForComparison(wt.path);
  const officialBasePath = normalizePathForComparison(getOfficialWorktreeBasePath(project));
  const nestedBasePath = normalizePathForComparison(getWorktreeBasePath(project));

  if (worktreePath === projectPath) return 'root';
  if (worktreePath === officialBasePath || worktreePath.startsWith(`${officialBasePath}\\`)) return 'official';
  if (worktreePath === nestedBasePath || worktreePath.startsWith(`${nestedBasePath}\\`)) return 'subworktree';
  return 'subworktree';
}

function canCreateNestedWorktree(project, wt) {
  return classifyWorktreeLocation(project, wt) !== 'root';
}

function getNestedWorktreeParentPath(project, wt, settings) {
  if (classifyWorktreeLocation(project, wt) !== 'subworktree') return null;
  if (!wt?.branch) return null;

  const parentBranch = settings?.subworktreeBranchParents?.[wt.branch];
  if (!parentBranch) return null;

  const parent = (project?.worktrees || []).find((candidate) => {
    if (!candidate?.branch) return false;
    return candidate.branch === parentBranch && classifyWorktreeLocation(project, candidate) !== 'subworktree';
  });

  return parent?.path || null;
}

function buildWorktreeTree(project, settings) {
  const worktrees = project?.worktrees || [];
  const nodesByPath = new Map();

  for (const wt of worktrees) {
    nodesByPath.set(wt.path, { wt, children: [] });
  }

  const roots = [];
  for (const wt of worktrees) {
    const node = nodesByPath.get(wt.path);
    const parentPath = getNestedWorktreeParentPath(project, wt, settings);
    if (parentPath && nodesByPath.has(parentPath)) {
      nodesByPath.get(parentPath).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

module.exports = {
  getAvailableWorktreeBranches,
  isInvalidGitBranchName,
  branchToPascalPath,
  getSuggestedWorktreePath,
  getWorktreeBasePath,
  getOfficialWorktreeBasePath,
  classifyWorktreeLocation,
  canCreateNestedWorktree,
  getNestedWorktreeParentPath,
  buildWorktreeTree,
};
