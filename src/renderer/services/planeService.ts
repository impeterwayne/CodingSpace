export interface PlaneIssue {
  id: string;
  sequence_id: number;
  name: string;
  description_html?: string;
  priority: string;
  state: string; // State ID
  stateName?: string;
  stateGroup?: string;
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

export const DEFAULT_PLANE_CONFIG: PlaneConfig = {
  baseUrl: 'https://plane.itgproduct.com',
  workspaceSlug: 'product',
  projectId: '',
  apiKey: 'plane_api_468d764bbdbe4b87ae158976ac2e1559',
};

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

export function categorizeIssues(issues: PlaneIssue[], stateMap: Map<string, PlaneState>) {
  const backlog: PlaneIssue[] = [];
  const todo: PlaneIssue[] = [];
  const inProgress: PlaneIssue[] = [];
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

    const group = (issue.stateGroup || '').toLowerCase();
    const name = (issue.stateName || '').toLowerCase();

    if (group === 'backlog' || name === 'backlog') {
      backlog.push(issue);
    } else if (group === 'unstarted' || name === 'todo') {
      todo.push(issue);
    } else if (group === 'started' || name === 'in progress') {
      inProgress.push(issue);
    } else if (group === 'completed' || name === 'done') {
      done.push(issue);
    } else if (group === 'cancelled' || name === 'cancelled') {
      cancelled.push(issue);
    } else {
      other.push(issue);
    }
  }

  return { backlog, todo, inProgress, done, cancelled, other };
}

export function generateTaskListMD(cfg: PlaneConfig, issues: PlaneIssue[], stateMap: Map<string, PlaneState>): string {
  const { backlog, todo, inProgress, done, cancelled, other } = categorizeIssues(issues, stateMap);
  const totalCount = issues.length;
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let md = `# 📋 Plane Comprehensive Task List (All States)\n\n`;
  md += `> **Workspace:** \`${cfg.workspaceSlug}\` | **Project:** \`PDF Fill&Sign 5\` (\`${cfg.projectId}\`)  \n`;
  md += `> **Generated:** ${now}  \n`;
  md += `> **Total Tasks Included:** **${totalCount}** (All Categories)  \n\n`;

  md += `--- \n\n`;
  md += `## 📊 Summary Overview\n\n`;
  md += `| State Category | Task Count | Status Emoji |\n`;
  md += `| :--- | :---: | :---: |\n`;
  md += `| 🔴 **Backlog** | ${backlog.length} | 🔴 |\n`;
  md += `| 🟡 **Todo** | ${todo.length} | 🟡 |\n`;
  md += `| 🔵 **In Progress** | ${inProgress.length} | 🔵 |\n`;
  md += `| 🟢 **Done** | ${done.length} | 🟢 |\n`;
  md += `| ⚪ **Cancelled** | ${cancelled.length} | ⚪ |\n`;
  if (other.length > 0) {
    md += `| ❓ **Other/Draft** | ${other.length} | ❓ |\n`;
  }
  md += `| **TOTAL** | **${totalCount}** | ✨ |\n\n`;

  // 1. Backlog
  if (backlog.length > 0) {
    md += `--- \n\n## 🔴 1. Backlog Tasks (${backlog.length})\n\n`;
    for (const item of backlog) {
      md += `- [ ] **PDFFILLSIG-${item.sequence_id}**: ${item.name}\n`;
      md += `  - **Priority:** ${formatPriority(item.priority)} | **Start Date:** \`${formatDate(item.start_date)}\`\n`;
      const desc = cleanHTML(item.description_html);
      if (desc) md += `  - **Details/Evidence:** ${desc}\n`;
      md += `\n`;
    }
  }

  // 2. Todo
  if (todo.length > 0) {
    md += `--- \n\n## 🟡 2. Todo Tasks (${todo.length})\n\n`;
    for (const item of todo) {
      md += `- [ ] **PDFFILLSIG-${item.sequence_id}**: ${item.name}\n`;
      md += `  - **Priority:** ${formatPriority(item.priority)} | **Start Date:** \`${formatDate(item.start_date)}\`\n`;
      const desc = cleanHTML(item.description_html);
      if (desc) md += `  - **Details/Evidence:** ${desc}\n`;
      md += `\n`;
    }
  }

  // 3. In Progress
  if (inProgress.length > 0) {
    md += `--- \n\n## 🔵 3. In Progress Tasks (${inProgress.length})\n\n`;
    for (const item of inProgress) {
      md += `- [/] **PDFFILLSIG-${item.sequence_id}**: ${item.name}\n`;
      md += `  - **Priority:** ${formatPriority(item.priority)} | **Start Date:** \`${formatDate(item.start_date)}\` | **Last Updated:** \`${formatDate(item.updated_at)}\` \n`;
      const desc = cleanHTML(item.description_html);
      if (desc) md += `  - **Details/Evidence:** ${desc}\n`;
      md += `\n`;
    }
  }

  // 4. Done
  if (done.length > 0) {
    md += `--- \n\n## 🟢 4. Done Tasks (${done.length})\n\n`;
    for (const item of done) {
      md += `- [x] **PDFFILLSIG-${item.sequence_id}**: ${item.name}\n`;
      md += `  - **Priority:** ${formatPriority(item.priority)} | **Completed At:** \`${formatDate(item.updated_at)}\`\n`;
      const desc = cleanHTML(item.description_html);
      if (desc) md += `  - **Details/Evidence:** ${desc}\n`;
      md += `\n`;
    }
  }

  // 5. Cancelled
  if (cancelled.length > 0) {
    md += `--- \n\n## ⚪ 5. Cancelled Tasks (${cancelled.length})\n\n`;
    for (const item of cancelled) {
      md += `- [ ] ~**PDFFILLSIG-${item.sequence_id}**: ${item.name}~\n`;
      md += `  - **Priority:** ${formatPriority(item.priority)}\n`;
      const desc = cleanHTML(item.description_html);
      if (desc) md += `  - **Details/Evidence:** ${desc}\n`;
      md += `\n`;
    }
  }

  // 6. Other / Draft
  if (other.length > 0) {
    md += `--- \n\n## ❓ 6. Other / Draft Tasks (${other.length})\n\n`;
    for (const item of other) {
      md += `- [ ] **PDFFILLSIG-${item.sequence_id}**: ${item.name} (State: ${item.stateName})\n`;
      md += `  - **Priority:** ${formatPriority(item.priority)}\n`;
      const desc = cleanHTML(item.description_html);
      if (desc) md += `  - **Details/Evidence:** ${desc}\n`;
      md += `\n`;
    }
  }

  md += `---\n*Comprehensive task list generated automatically via TypeScript REST API client.*`;
  return md;
}
