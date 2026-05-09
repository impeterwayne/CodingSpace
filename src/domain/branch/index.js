function getAvailableWorktreeBranches(project, branches) {
  const existingWtBranches = (project.worktrees || []).map((w) => w.branch).filter(Boolean);
  return branches.filter((branch) => !existingWtBranches.includes(branch) && !branch.startsWith('origin/'));
}

function isInvalidGitBranchName(branchName) {
  return /[\s~^:?*\[\\]/.test(branchName);
}

module.exports = {
  getAvailableWorktreeBranches,
  isInvalidGitBranchName,
};
