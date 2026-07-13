function normalizePathForComparison(inputPath) {
  return String(inputPath || '')
    .replace(/[\\/]+/g, '\\')
    .replace(/[\\]+$/, '')
    .toLowerCase();
}

function getWorktreeBasePath(project) {
  return `${project.path}.subworktree`;
}

function getOfficialWorktreeBasePath(project) {
  return `${project.path}.worktrees`;
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
  if (!wt.branch) return null;

  const parentBranch = settings?.subworktreeBranchParents?.[wt.branch];
  if (!parentBranch) return null;

  const parent = (project.worktrees || []).find((candidate) => {
    if (!candidate?.branch) return false;
    return candidate.branch === parentBranch && classifyWorktreeLocation(project, candidate) !== 'subworktree';
  });

  return parent?.path || null;
}

function buildWorktreeTree(project, settings) {
  const worktrees = project.worktrees || [];
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
  normalizePathForComparison,
  getWorktreeBasePath,
  getOfficialWorktreeBasePath,
  classifyWorktreeLocation,
  canCreateNestedWorktree,
  getNestedWorktreeParentPath,
  buildWorktreeTree,
};
