/** `dashboard` namespace dictionaries: the product shell copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'shell.title': 'Agent 工作台',
  'shell.loading': '加载中…',
  'nav.agents': 'Agents',
  'agent.coder': '编码 Agent',
  'agent.btender': '招标 Agent',
  'agent.invest': '投资 Agent',
  'agent.video': '视频 Agent',
  'stat.workspaces': '工作区',
  'stat.sessions': '会话',
  'stat.running': '运行中',
  'session.new': '新建会话',
  'session.open': '打开会话',
  'session.current': '当前',
  'session.running': '运行中',
  'sessions.empty': '暂无会话',
  'group.ungrouped': '未分组',
} satisfies Record<string, string>

/** The dashboard namespace key union. */
export type DashboardKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'shell.title': 'Agent Dashboard',
  'shell.loading': 'Loading…',
  'nav.agents': 'Agents',
  'agent.coder': 'Coder Agent',
  'agent.btender': 'Bid Agent',
  'agent.invest': 'Invest Agent',
  'agent.video': 'Video Agent',
  'stat.workspaces': 'Workspaces',
  'stat.sessions': 'Sessions',
  'stat.running': 'Running',
  'session.new': 'New session',
  'session.open': 'Open session',
  'session.current': 'Current',
  'session.running': 'Running',
  'sessions.empty': 'No sessions yet',
  'group.ungrouped': 'Ungrouped',
} satisfies Record<DashboardKey, string>
