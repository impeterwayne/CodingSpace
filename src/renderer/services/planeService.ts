export interface PlaneProject {
  id: string;
  name: string;
  identifier: string;
  description?: string;
}

export interface PlaneIssue {
  id: string;
  sequence_id: number;
  name: string;
  description_html?: string;
  priority: string;
  state: string; // State ID
  stateName?: string;
  stateGroup?: string;
  project_identifier?: string;
  project_detail?: {
    id?: string;
    identifier?: string;
    name?: string;
  };
  start_date?: string;
  target_date?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PlaneState {
  id: string;
  name: string;
  group: string;
}

export interface PlaneConfig {
  baseUrl: string;
  workspaceSlug: string;
  projectId: string;
  apiKey: string;
}

export interface EvidenceMedia {
  type: 'image' | 'video';
  webUrl: string;
  mediaId: string;
  localPath: string;
  posterPath?: string;
}

export const DEFAULT_PLANE_CONFIG: PlaneConfig = {
  baseUrl: 'https://plane.itgproduct.com',
  workspaceSlug: 'product',
  projectId: '',
  apiKey: '',
};

const USER_AGENT_HEADER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function fetchProjectStates(cfg: PlaneConfig): Promise<Map<string, PlaneState>> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/v1/workspaces/${cfg.workspaceSlug}/projects/${cfg.projectId}/states/`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-API-Key': cfg.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch states: HTTP ${response.status} (${response.statusText})`);
  }

  const data = await response.json();
  const stateMap = new Map<string, PlaneState>();

  let stateList: PlaneState[] = [];
  if (Array.isArray(data)) {
    stateList = data;
  } else if (data && Array.isArray(data.results)) {
    stateList = data.results;
  }

  for (const state of stateList) {
    if (state.id) {
      stateMap.set(state.id, state);
    }
  }

  return stateMap;
}

export async function fetchProjectIssues(cfg: PlaneConfig): Promise<PlaneIssue[]> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/v1/workspaces/${cfg.workspaceSlug}/projects/${cfg.projectId}/issues/`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-API-Key': cfg.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch issues: HTTP ${response.status} (${response.statusText})`);
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    return data;
  } else if (data && Array.isArray(data.results)) {
    return data.results;
  }
  return [];
}

export async function fetchProjectDetails(cfg: PlaneConfig): Promise<PlaneProject | null> {
  try {
    const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/v1/workspaces/${cfg.workspaceSlug}/projects/${cfg.projectId}/`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-API-Key': cfg.apiKey,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.warn('Failed to fetch project details:', err);
    return null;
  }
}

export async function fetchWorkspaceProjects(cfg: Pick<PlaneConfig, 'baseUrl' | 'workspaceSlug' | 'apiKey'>): Promise<PlaneProject[]> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/api/v1/workspaces/${cfg.workspaceSlug}/projects/`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-API-Key': cfg.apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch projects: HTTP ${response.status} (${response.statusText})`);
  }

  const data = await response.json();
  const list: PlaneProject[] = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : []);
  return list
    .filter((p) => p && typeof p.id === 'string')
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

// Matches herdr-launcher's plane.filterProjects: substring over name, identifier and id.
export function filterPlaneProjects(projects: PlaneProject[], query: string): PlaneProject[] {
  const q = (query || '').trim().toLowerCase();
  if (!q) return projects;
  return projects.filter((p) =>
    [p.name, p.identifier, p.id].some((v) => String(v || '').toLowerCase().includes(q))
  );
}

const normalizePathKey =(p: string) => (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const pathBasename = (p: string) => normalizePathKey(p).split('/').pop() || '';

// Same lookup order as herdr-launcher's plane.resolveProjectId so both tools agree on the mapping:
// exact path (worktree, parent repo, sibling worktrees) → ancestor directory → folder basename.
export function resolvePlaneProjectId(projectPlaneIds: Record<string, string> | undefined, candidatePaths: string[]): string {
  if (!projectPlaneIds || typeof projectPlaneIds !== 'object') return '';
  const candidates = [...new Set(candidatePaths.filter(Boolean).map(normalizePathKey))];
  if (candidates.length === 0) return '';
  const entries = Object.entries(projectPlaneIds)
    .filter(([key, id]) => key && key.trim() && typeof id === 'string' && id.trim())
    .map(([key, id]) => [normalizePathKey(key.trim()), id.trim()] as const);

  const exact = entries.find(([key]) => candidates.includes(key));
  if (exact) return exact[1];

  const ancestor = entries.find(([key]) => candidates.some((cand) => cand.startsWith(key + '/')));
  if (ancestor) return ancestor[1];

  const bases = new Set(candidates.map(pathBasename));
  const byBase = entries.find(([key]) => bases.has(pathBasename(key)));
  return byBase ? byBase[1] : '';
}

export function cleanHTML(html?: string): string {
  if (!html) return '';
  const text = html.replace(/<[^>]*>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

export function formatPriority(priority?: string): string {
  switch ((priority || '').toLowerCase()) {
    case 'urgent':
      return '🔥 Urgent';
    case 'high':
      return '🔴 High';
    case 'medium':
      return '🟡 Medium';
    case 'low':
      return '🔵 Low';
    default:
      return '⚪ None';
  }
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return 'Unset';
  return dateStr;
}

export async function scrapeLightshotImageURL(prntUrl: string): Promise<string | null> {
  try {
    const res = await fetch(prntUrl, {
      headers: { 'User-Agent': USER_AGENT_HEADER },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
    if (ogMatch && ogMatch[1]) return ogMatch[1];

    const imgMatch = html.match(/id=["']screenshot-image["']\s+src=["']([^"']+)["']/i);
    if (imgMatch && imgMatch[1]) return imgMatch[1];
  } catch (e) {
    // Ignore fetch errors
  }
  return null;
}

export async function scrapeStreamableMediaURLs(mediaId: string, streamableUrl: string): Promise<{ videoUrl: string | null; posterUrl: string | null }> {
  try {
    const apiRes = await fetch(`https://api.streamable.com/videos/${mediaId}`, {
      headers: { 'User-Agent': USER_AGENT_HEADER },
    });
    if (apiRes.ok) {
      const data = await apiRes.json();
      let videoUrl: string | null = null;
      let posterUrl: string | null = null;

      if (data.thumbnail_url) {
        posterUrl = data.thumbnail_url.startsWith('//') ? 'https:' + data.thumbnail_url : data.thumbnail_url;
      }
      if (data.files && data.files.mp4 && data.files.mp4.url) {
        const u = data.files.mp4.url;
        videoUrl = u.startsWith('//') ? 'https:' + u : u;
      }
      if (videoUrl) return { videoUrl, posterUrl };
    }

    const htmlRes = await fetch(streamableUrl, {
      headers: { 'User-Agent': USER_AGENT_HEADER },
    });
    if (htmlRes.ok) {
      const html = await htmlRes.text();
      let videoUrl: string | null = null;
      let posterUrl: string | null = null;

      const videoMatch = html.match(/<meta\s+property=["']og:video:secure_url["']\s+content=["']([^"']+)["']/i);
      if (videoMatch && videoMatch[1]) videoUrl = videoMatch[1];

      const imageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      if (imageMatch && imageMatch[1]) posterUrl = imageMatch[1];

      return { videoUrl, posterUrl };
    }
  } catch (e) {
    // Ignore fetch errors
  }
  return { videoUrl: null, posterUrl: null };
}

export type IssueCategory = 'backlog' | 'todo' | 'in_progress' | 'on_testing' | 'done' | 'cancelled' | 'other';

// "On Testing" is usually a custom state in Plane's "started" group, so match it by name before the group.
export function isOnTestingState(stateName?: string) {
  return /\btest(ing)?\b/i.test(stateName || '');
}

export function getIssueCategory(issue: PlaneIssue): IssueCategory {
  const group = (issue.stateGroup || '').toLowerCase();
  const name = (issue.stateName || '').toLowerCase();
  if (group === 'backlog' || name === 'backlog') return 'backlog';
  if (group === 'unstarted' || name === 'todo') return 'todo';
  if (isOnTestingState(name)) return 'on_testing';
  if (group === 'started' || name === 'in progress') return 'in_progress';
  if (group === 'completed' || name === 'done') return 'done';
  if (group === 'cancelled' || name === 'cancelled') return 'cancelled';
  return 'other';
}

export function categorizeIssues(issues: PlaneIssue[], stateMap: Map<string, PlaneState>) {
  const backlog: PlaneIssue[] = [];
  const todo: PlaneIssue[] = [];
  const inProgress: PlaneIssue[] = [];
  const onTesting: PlaneIssue[] = [];
  const done: PlaneIssue[] = [];
  const cancelled: PlaneIssue[] = [];
  const other: PlaneIssue[] = [];

  for (const issue of issues) {
    const stateInfo = stateMap.get(issue.state);
    if (stateInfo) {
      issue.stateName = stateInfo.name;
      issue.stateGroup = stateInfo.group;
    } else {
      issue.stateName = issue.stateName || 'Unknown';
      issue.stateGroup = issue.stateGroup || 'other';
    }

    switch (getIssueCategory(issue)) {
      case 'backlog': backlog.push(issue); break;
      case 'todo': todo.push(issue); break;
      case 'in_progress': inProgress.push(issue); break;
      case 'on_testing': onTesting.push(issue); break;
      case 'done': done.push(issue); break;
      case 'cancelled': cancelled.push(issue); break;
      default: other.push(issue);
    }
  }

  return { backlog, todo, inProgress, onTesting, done, cancelled, other };
}

export function generateTaskListMD(
  cfg: PlaneConfig,
  issues: PlaneIssue[],
  stateMap: Map<string, PlaneState>,
  mediaMap?: Map<number, EvidenceMedia[]>,
  projectInfo?: PlaneProject | null
): string {
  const { backlog, todo, inProgress, onTesting, done, cancelled, other } = categorizeIssues(issues, stateMap);
  const totalCount = issues.length;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const projectName = projectInfo?.name || issues[0]?.project_detail?.name || 'Plane Project';
  const projectIdentifier = projectInfo?.identifier || issues[0]?.project_detail?.identifier || issues[0]?.project_identifier || '';

  let md = `# 📋 Plane Comprehensive Task List (All States)\n\n`;
  md += `> **Workspace:** \`${cfg.workspaceSlug}\` | **Project:** \`${projectName}\` (\`${cfg.projectId}\`)  \n`;
  md += `> **Generated:** ${now}  \n`;
  md += `> **Total Tasks Included:** **${totalCount}** (All Categories)  \n\n`;

  md += `--- \n\n`;
  md += `## 📊 Summary Overview\n\n`;
  md += `| State Category | Task Count | Status Emoji |\n`;
  md += `| :--- | :---: | :---: |\n`;
  md += `| 🔴 **Backlog** | ${backlog.length} | 🔴 |\n`;
  md += `| 🟡 **Todo** | ${todo.length} | 🟡 |\n`;
  md += `| 🔵 **In Progress** | ${inProgress.length} | 🔵 |\n`;
  md += `| 🟣 **On Testing** | ${onTesting.length} | 🟣 |\n`;
  md += `| 🟢 **Done** | ${done.length} | 🟢 |\n`;
  md += `| ⚪ **Cancelled** | ${cancelled.length} | ⚪ |\n`;
  if (other.length > 0) {
    md += `| ❓ **Other/Draft** | ${other.length} | ❓ |\n`;
  }
  md += `| **TOTAL** | **${totalCount}** | ✨ |\n\n`;

  const formatItem = (checkbox: string, item: PlaneIssue) => {
    const itemPrefix = projectIdentifier || item.project_detail?.identifier || item.project_identifier || '';
    const taskTag = itemPrefix ? `${itemPrefix}-${item.sequence_id}` : `#${item.sequence_id}`;
    let itemMd = `- [${checkbox}] **${taskTag}**: ${item.name}\n`;
    itemMd += `  - **Priority:** ${formatPriority(item.priority)} | **Start Date:** \`${formatDate(item.start_date)}\``;
    if (item.updated_at) {
      itemMd += ` | **Last Updated:** \`${formatDate(item.updated_at)}\``;
    }
    itemMd += `\n`;
    const desc = cleanHTML(item.description_html);
    if (desc) itemMd += `  - **Details/Evidence:** ${desc}\n`;

    const mediaList = mediaMap?.get(item.sequence_id);
    if (mediaList && mediaList.length > 0) {
      itemMd += `  - **Downloaded Offline Evidence:**\n`;
      for (const m of mediaList) {
        if (m.type === 'image') {
          itemMd += `    - Screenshot: [${m.mediaId}](${m.webUrl}) → ![Preview](${m.localPath})\n`;
        } else if (m.type === 'video') {
          itemMd += `    - Video Recording: [${m.mediaId}](${m.webUrl}) → [Full MP4 Video](${m.localPath})\n`;
          itemMd += `      <video controls src="${m.localPath}" poster="${m.posterPath || ''}" width="480"></video>\n`;
        }
      }
    }
    itemMd += `\n`;
    return itemMd;
  };

  // 1. Backlog
  if (backlog.length > 0) {
    md += `--- \n\n## 🔴 1. Backlog Tasks (${backlog.length})\n\n`;
    for (const item of backlog) md += formatItem(' ', item);
  }

  // 2. Todo
  if (todo.length > 0) {
    md += `--- \n\n## 🟡 2. Todo Tasks (${todo.length})\n\n`;
    for (const item of todo) md += formatItem(' ', item);
  }

  // 3. In Progress
  if (inProgress.length > 0) {
    md += `--- \n\n## 🔵 3. In Progress Tasks (${inProgress.length})\n\n`;
    for (const item of inProgress) md += formatItem('/', item);
  }

  // 4. On Testing
  if (onTesting.length > 0) {
    md += `--- \n\n## 🟣 4. On Testing Tasks (${onTesting.length})\n\n`;
    for (const item of onTesting) md += formatItem('/', item);
  }

  // 5. Done
  if (done.length > 0) {
    md += `--- \n\n## 🟢 5. Done Tasks (${done.length})\n\n`;
    for (const item of done) md += formatItem('x', item);
  }

  // 6. Cancelled
  if (cancelled.length > 0) {
    md += `--- \n\n## ⚪ 6. Cancelled Tasks (${cancelled.length})\n\n`;
    for (const item of cancelled) md += formatItem(' ', item);
  }

  // 7. Other / Draft
  if (other.length > 0) {
    md += `--- \n\n## ❓ 7. Other / Draft Tasks (${other.length})\n\n`;
    for (const item of other) md += formatItem(' ', item);
  }

  md += `---\n*Comprehensive task list generated automatically via TypeScript REST API client.*`;
  return md;
}
