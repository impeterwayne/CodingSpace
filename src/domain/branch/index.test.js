const assert = require('assert');
const { getAvailableWorktreeBranches, isInvalidGitBranchName } = require('./index');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

test('getAvailableWorktreeBranches filters existing and remote branches', () => {
  const project = {
    worktrees: [
      { branch: 'main' },
      { branch: 'feature/existing' },
      { branch: '' },
      {},
    ],
  };

  assert.deepStrictEqual(
    getAvailableWorktreeBranches(project, [
      'main',
      'develop',
      'feature/existing',
      'feature/new',
      'origin/main',
      'origin/feature/new',
    ]),
    ['develop', 'feature/new']
  );
});

test('isInvalidGitBranchName matches current forbidden characters', () => {
  assert.strictEqual(isInvalidGitBranchName('feature/ok-name'), false);
  assert.strictEqual(isInvalidGitBranchName('feature with space'), true);
  assert.strictEqual(isInvalidGitBranchName('feature~name'), true);
  assert.strictEqual(isInvalidGitBranchName('feature^name'), true);
  assert.strictEqual(isInvalidGitBranchName('feature:name'), true);
  assert.strictEqual(isInvalidGitBranchName('feature?name'), true);
  assert.strictEqual(isInvalidGitBranchName('feature*name'), true);
  assert.strictEqual(isInvalidGitBranchName('feature[name'), true);
  assert.strictEqual(isInvalidGitBranchName('feature\\name'), true);
});
