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
      subworktreeBranchParents: {
        ' feature/foo ': ' main ',
        '': 'ignored',
        'child': '   ',
      },
      vscodePath: '   code  ',
      androidStudioPath: '  studio64  ',
      antigravityPath: '  antigravity-ide  ',
      antigravityAgentPath: '  antigravity  ',
    }),
    {
      subworktreeBranchParents: {
        'feature/foo': 'main',
      },
      vscodePath: 'code',
      androidStudioPath: 'studio64',
      antigravityPath: 'antigravity-ide',
      antigravityAgentPath: 'antigravity',
    }
  );
});

test('normalizeSettings falls back for non-object input', () => {
  assert.deepStrictEqual(normalizeSettings(null), {
    subworktreeBranchParents: {},
    vscodePath: '',
    androidStudioPath: '',
    antigravityPath: '',
    antigravityAgentPath: '',
  });
});

test('normalizeWorkspaceConfig keeps projects array and normalizes settings', () => {
  const projects = [{ path: 'C:\\repo' }];
  const result = normalizeWorkspaceConfig({ projects, settings: {} });
  assert.strictEqual(result.projects, projects);
  assert.deepStrictEqual(result.settings, {
    subworktreeBranchParents: {},
    vscodePath: '',
    androidStudioPath: '',
    antigravityPath: '',
    antigravityAgentPath: '',
  });
});
