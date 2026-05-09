const assert = require('assert');
const {
  normalizePathForComparison,
  getWorktreeBasePath,
  getOfficialWorktreeBasePath,
  classifyWorktreeLocation,
  canCreateNestedWorktree,
  getWorktreeDisplayMeta,
  getNestedWorktreeParentPath,
  buildWorktreeTree,
} = require('./index');

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

const project = {
  path: 'C:\\Repo',
  worktrees: [
    { path: 'C:\\Repo', branch: 'main', name: 'root' },
    { path: 'C:\\Repo.worktrees\\feature-a', branch: 'feature/a', name: 'official child' },
    { path: 'C:\\Repo.subworktree\\nested-a', branch: 'feature/nested-a', name: 'nested child a' },
    { path: 'C:\\Repo.subworktree\\nested-b', branch: 'feature/nested-b', name: 'nested child b' },
  ],
};

const settings = {
  worktreeBasePath: '',
  subworktreeBranchParents: {
    'feature/nested-a': 'feature/a',
    'feature/nested-b': 'main',
  },
};

test('normalizePathForComparison normalizes slashes, trailing separators, and case', () => {
  assert.strictEqual(normalizePathForComparison('C:/Repo\\Path\\'), 'c:\\repo\\path');
});

test('getWorktreeBasePath uses configured path or default suffix', () => {
  assert.strictEqual(getWorktreeBasePath(project, { worktreeBasePath: '  D:\\Nested  ' }), 'D:\\Nested');
  assert.strictEqual(getWorktreeBasePath(project, settings), 'C:\\Repo.subworktree');
});

test('getOfficialWorktreeBasePath uses official suffix', () => {
  assert.strictEqual(getOfficialWorktreeBasePath(project), 'C:\\Repo.worktrees');
});

test('classifyWorktreeLocation matches current path rules', () => {
  assert.strictEqual(classifyWorktreeLocation(project, { path: 'C:\\Repo' }, settings), 'root');
  assert.strictEqual(classifyWorktreeLocation(project, { path: 'C:\\repo.worktrees\\x' }, settings), 'official');
  assert.strictEqual(classifyWorktreeLocation(project, { path: 'C:\\repo.subworktree\\x' }, settings), 'subworktree');
  assert.strictEqual(classifyWorktreeLocation(project, { path: 'C:\\elsewhere' }, settings), 'subworktree');
  assert.strictEqual(classifyWorktreeLocation(null, { path: 'C:\\elsewhere' }, settings), 'subworktree');
});

test('canCreateNestedWorktree blocks root only', () => {
  assert.strictEqual(canCreateNestedWorktree(project, { path: 'C:\\Repo' }, settings), false);
  assert.strictEqual(canCreateNestedWorktree(project, { path: 'C:\\Repo.worktrees\\feature-a' }, settings), true);
  assert.strictEqual(canCreateNestedWorktree(project, { path: 'C:\\Repo.subworktree\\nested-a' }, settings), true);
});

test('getWorktreeDisplayMeta returns current badge metadata', () => {
  assert.deepStrictEqual(getWorktreeDisplayMeta(project, { path: 'C:\\Repo' }, settings), {
    location: 'root',
    badge: 'local',
    title: 'Local worktree',
  });
  assert.deepStrictEqual(getWorktreeDisplayMeta(project, { path: 'C:\\Repo.worktrees\\feature-a' }, settings), {
    location: 'official',
    badge: 'official',
    title: 'Official worktree location',
  });
  assert.deepStrictEqual(getWorktreeDisplayMeta(project, { path: 'C:\\Repo.subworktree\\nested-a' }, settings), {
    location: 'subworktree',
    badge: 'sub',
    title: 'Subworktree location',
  });
});

test('getNestedWorktreeParentPath resolves only subworktrees with mapped non-subworktree parent branch', () => {
  assert.strictEqual(
    getNestedWorktreeParentPath(project, project.worktrees[2], settings),
    'C:\\Repo.worktrees\\feature-a'
  );
  assert.strictEqual(
    getNestedWorktreeParentPath(project, project.worktrees[3], settings),
    'C:\\Repo'
  );
  assert.strictEqual(
    getNestedWorktreeParentPath(project, project.worktrees[1], settings),
    null
  );
  assert.strictEqual(
    getNestedWorktreeParentPath(project, { path: 'C:\\Repo.subworktree\\unknown', branch: 'missing' }, settings),
    null
  );
});

test('buildWorktreeTree attaches nested worktrees under resolved parent paths', () => {
  const roots = buildWorktreeTree(project, settings);
  assert.strictEqual(roots.length, 2);
  assert.strictEqual(roots[0].wt.path, 'C:\\Repo');
  assert.deepStrictEqual(
    roots[0].children.map((child) => child.wt.path),
    ['C:\\Repo.subworktree\\nested-b']
  );
  assert.strictEqual(roots[1].wt.path, 'C:\\Repo.worktrees\\feature-a');
  assert.deepStrictEqual(
    roots[1].children.map((child) => child.wt.path),
    ['C:\\Repo.subworktree\\nested-a']
  );
});
