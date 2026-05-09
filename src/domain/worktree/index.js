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

function slugifyWorktreeNameForBranch(worktreeName) {
  const slug = String(worktreeName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'worktree';
}

function formatBranchTimestampPart(timestamp = Date.now()) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function getSuggestedSubWorktreeBranchName(worktreeName, timestamp = Date.now()) {
  return `tmp/${slugifyWorktreeNameForBranch(worktreeName)}-${formatBranchTimestampPart(timestamp)}`;
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

function getNestedWorktreeParentBranch(project, wt, settings) {
  if (classifyWorktreeLocation(project, wt, settings) !== 'subworktree') return null;
  if (!wt?.branch) return null;

  return settings?.subworktreeBranchParents?.[wt.branch] || null;
}

function getWorktreeDisplayMeta(project, wt, settings) {
  const location = classifyWorktreeLocation(project, wt, settings);

  switch (location) {
    case 'root':
      return { location, badge: 'local', title: 'Local worktree' };
    case 'official':
      return { location, badge: 'official', title: 'Official worktree location' };
    case 'subworktree':
      return { location, badge: 'sub', title: 'Sub-worktree location' };
    default:
      return { location: 'subworktree', badge: 'sub', title: 'Sub-worktree location' };
  }
}

function getNestedWorktreeParentPath(project, wt, settings) {
  const parentBranch = getNestedWorktreeParentBranch(project, wt, settings);
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
  slugifyWorktreeNameForBranch,
  formatBranchTimestampPart,
  getSuggestedSubWorktreeBranchName,
  getOfficialWorktreeBasePath,
  classifyWorktreeLocation,
  canCreateNestedWorktree,
  getWorktreeDisplayMeta,
  getNestedWorktreeParentBranch,
  getNestedWorktreeParentPath,
  buildWorktreeTree,
};

