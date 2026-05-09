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

function getSuggestedWorktreePath(baseDir, projectName, branch) {
  return branch ? `${baseDir}\\${projectName}-${branchToPascalPath(branch)}` : '';
}

function getWorktreeBasePath(project, settings) {
  const configuredBasePath = settings?.worktreeBasePath?.trim();
  return configuredBasePath || `${project.path}.subworktree`;
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

function getNestedWorktreeParentPath(project, wt, settings) {
  const parentBranch = getNestedWorktreeParentBranch(project, wt, settings);
  if (!parentBranch) return null;

  const parent = (project?.worktrees || []).find((candidate) => {
    if (!candidate?.branch) return false;
    return candidate.branch === parentBranch && classifyWorktreeLocation(project, candidate, settings) !== 'subworktree';
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
  slugifyWorktreeNameForBranch,
  formatBranchTimestampPart,
  getSuggestedSubWorktreeBranchName,
  getSuggestedWorktreePath,
  getWorktreeBasePath,
  getOfficialWorktreeBasePath,
  classifyWorktreeLocation,
  canCreateNestedWorktree,
  getNestedWorktreeParentBranch,
  getNestedWorktreeParentPath,
  buildWorktreeTree,
};

