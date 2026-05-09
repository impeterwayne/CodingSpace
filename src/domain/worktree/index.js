function normalizePathForComparison(inputPath) {
  return String(inputPath || '')
    .replace(/[\\/]+/g, '\\')
    .replace(/[\\]+$/, '')
    .toLowerCase();
}

function getWorktreeBasePath(project, settings) {
  const configuredBasePath = settings?.worktreeBasePath?.trim();
  return configuredBasePath || `${project.path}.subworktree`;
}

function getOfficialWorktreeBasePath(project) {
  return `${project.path}.worktrees`;
}

function classifyWorktreeLocation(project, wt, settings) {
  if (!project || !wt?.path) return 'subworktree';

  const projectPath = normalizePathForComparison(project.path);
  const worktreePath = normalizePathForComparison(wt.path);
  const officialBasePath = normalizePathForComparison(getOfficialWorktreeBasePath(project));
  const nestedBasePath = normalizePathForComparison(getWorktreeBasePath(project, settings));

  if (worktreePath === projectPath) return 'root';
  if (worktreePath === officialBasePath || worktreePath.startsWith(`${officialBasePath}\\`)) return 'official';
  if (worktreePath === nestedBasePath || worktreePath.startsWith(`${nestedBasePath}\\`)) return 'subworktree';
  return 'subworktree';
}

function canCreateNestedWorktree(project, wt, settings) {
  return classifyWorktreeLocation(project, wt, settings) !== 'root';
}

function getWorktreeDisplayMeta(project, wt, settings) {
  const location = classifyWorktreeLocation(project, wt, settings);

  switch (location) {
    case 'root':
      return { location, badge: 'local', title: 'Local worktree' };
    case 'official':
      return { location, badge: 'official', title: 'Official worktree location' };
    case 'subworktree':
      return { location, badge: 'sub', title: 'Subworktree location' };
    default:
      return { location: 'subworktree', badge: 'sub', title: 'Subworktree location' };
  }
}

function getNestedWorktreeParentPath(project, wt, settings) {
  if (classifyWorktreeLocation(project, wt, settings) !== 'subworktree') return null;
  if (!wt.branch) return null;

  const parentBranch = settings?.subworktreeBranchParents?.[wt.branch];
  if (!parentBranch) return null;

  const parent = (project.worktrees || []).find((candidate) => {
    if (!candidate?.branch) return false;
    return candidate.branch === parentBranch && classifyWorktreeLocation(project, candidate, settings) !== 'subworktree';
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
  getWorktreeDisplayMeta,
  getNestedWorktreeParentPath,
  buildWorktreeTree,
};
