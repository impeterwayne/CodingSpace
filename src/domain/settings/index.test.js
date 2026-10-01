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
      openspecSourcePath: '',
      autoRefreshCurrentProject: true,
      autoRefreshInterval: 10,
      planeApiKey: '',
      planeBaseUrl: 'https://plane.itgproduct.com',
      planeWorkspaceSlug: 'product',
      projectPlaneIds: {},
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
    openspecSourcePath: '',
    autoRefreshCurrentProject: true,
    autoRefreshInterval: 10,
    planeApiKey: '',
    planeBaseUrl: 'https://plane.itgproduct.com',
    planeWorkspaceSlug: 'product',
    projectPlaneIds: {},
  });
});

test('normalizeSettings preserves autoRefreshCurrentProject boolean state', () => {
  assert.strictEqual(
    normalizeSettings({ autoRefreshCurrentProject: false }).autoRefreshCurrentProject,
    false
  );
  assert.strictEqual(
    normalizeSettings({ autoRefreshCurrentProject: true }).autoRefreshCurrentProject,
    true
  );
  assert.strictEqual(
    normalizeSettings({}).autoRefreshCurrentProject,
    true
  );
});

test('normalizeSettings validates and preserves autoRefreshInterval', () => {
  assert.strictEqual(
    normalizeSettings({ autoRefreshInterval: 5 }).autoRefreshInterval,
    5
  );
  assert.strictEqual(
    normalizeSettings({ autoRefreshInterval: 0 }).autoRefreshInterval,
    10
  );
  assert.strictEqual(
    normalizeSettings({ autoRefreshInterval: -5 }).autoRefreshInterval,
    10
  );
  assert.strictEqual(
    normalizeSettings({ autoRefreshInterval: 'not-a-number' }).autoRefreshInterval,
    10
  );
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
    openspecSourcePath: '',
    autoRefreshCurrentProject: true,
    autoRefreshInterval: 10,
    planeApiKey: '',
    planeBaseUrl: 'https://plane.itgproduct.com',
    planeWorkspaceSlug: 'product',
    projectPlaneIds: {},
  });
});
