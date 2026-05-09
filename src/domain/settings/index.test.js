const assert = require('assert');
const { normalizeSettings, normalizeWorkspaceConfig } = require('./index');

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

test('normalizeSettings trims values and drops blank entries', () => {
  assert.deepStrictEqual(
    normalizeSettings({
      worktreeBasePath: '  C:\\Worktrees  ',
      subworktreeBranchParents: {
        ' feature/foo ': ' main ',
        '': 'ignored',
        'child': '   ',
      },
    }),
    {
      worktreeBasePath: 'C:\\Worktrees',
      subworktreeBranchParents: {
        'feature/foo': 'main',
      },
    }
  );
});

test('normalizeSettings falls back for non-object input', () => {
  assert.deepStrictEqual(normalizeSettings(null), {
    worktreeBasePath: '',
    subworktreeBranchParents: {},
  });
});

test('normalizeWorkspaceConfig keeps projects array and normalizes settings', () => {
  const projects = [{ path: 'C:\\repo' }];
  const result = normalizeWorkspaceConfig({ projects, settings: { worktreeBasePath: ' x ' } });
  assert.strictEqual(result.projects, projects);
  assert.deepStrictEqual(result.settings, {
    worktreeBasePath: 'x',
    subworktreeBranchParents: {},
  });
});
