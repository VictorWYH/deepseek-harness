/**
 * CoderPlatform — Coder Agent 最小闭环原型的类型与 API 客户端。
 *
 * 与 host 插件 `packages/bundle/web-app/src/coder-platform.ts` 的 JSON 存储
 * 对接：所有数据通过同源 `/dashboard/coder/*` 读写（浏览器只跟 DSH origin
 * 通信）。不硬编码假数据；能力缺失时显示明确状态。
 */

export type HealthGrade = '正常' | '关注' | '警告' | '危险' | '暂停' | '已完成' | '已归档'
export type ProjectStatus = '共创中' | '进行中' | '已完成' | '已归档' | '暂停'

export interface CoderContract {
  version: number
  rawBrief: string
  conversations: { seq: number; role: 'ai' | 'human'; ts: string; text: string }[]
  decisions: { key: string; label: string; value: string; confirmedAt: string }[]
  goalEvolution: { ts: string; from: string; to: string; by: string }[]
  constraints: string[]
  pendingItems: string[]
  acceptanceBasis: string
  updatedAt: string
}

export interface CoderStage {
  id: string
  title: string
  goal: string
  order: number
  dependsOn: string[]
  acceptance: string
  status: '草稿' | '计划中' | '执行中' | '等待验收' | '通过' | '不通过'
  artifacts: { name: string; path: string; verified: boolean }[]
}

export interface CoderTask {
  id: string
  parentTaskId: string | null
  sourceReason: string
  input: string
  expectedOutput: string
  agent: string
  dependsOn: string[]
  doneCondition: string
  status: '待执行' | '执行中' | '等待确认' | '通过' | '不通过' | '已取消'
  reworkVersion: number
  rejectionCount: number
  createdAt: string
  updatedAt: string
}

export interface CoderEvent {
  eventId: string
  seq: number
  ts: string
  source: string
  status: string
  detail: string
  entityType: 'stage' | 'task' | 'approval' | 'loop' | 'creation'
  entityId: string | null
}

export interface CoderApproval {
  id: string
  entityType: 'stage' | 'task'
  entityId: string
  submittedBy: string
  decision: '待确认' | '批准' | '拒绝'
  reason: string
  attachments: { name: string; path: string }[]
  decidedBy: string
  decidedAt: string | null
  version: number
}

export interface CoderAudit {
  id: string
  ts: string
  operator: string
  role: string
  scope: string
  action: string
  from: string
  to: string
  decision: string
  reason: string
  evidence: string
}

export interface QualityGate {
  name: string
  state: '未运行' | '运行中' | '通过' | '失败' | '跳过'
  detail?: string
}

export interface CoderProjectRecord {
  id: string
  name: string
  type: 'coder'
  owner: string
  status: ProjectStatus
  health: HealthGrade
  loopNo: number
  lastLoopAt: string | null
  currentStageId: string | null
  createdAt: string
  updatedAt: string
  tags: string[]
  summary: string
  contract: CoderContract
  stages: CoderStage[]
  tasks: CoderTask[]
  events: CoderEvent[]
  approvals: CoderApproval[]
  audits: CoderAudit[]
  pendingConfirms: number
  riskBlocks: string[]
  qualityGates: QualityGate[]
}

export interface ProjectRow {
  id: string
  name: string
  status: ProjectStatus
  health: HealthGrade
  loopNo: number
  updatedAt: string
  summary: string
  pendingConfirms: number
}

const API = '/dashboard/coder'

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const resp = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  })
  if (!resp.ok) {
    let detail = `http_${resp.status}`
    try { const d = (await resp.json()) as { error?: string }; if (d.error) detail = d.error } catch { /* keep */ }
    throw new Error(detail)
  }
  return (await resp.json()) as T
}

/** 对谈确认项（C02）。 */
export const TALK_KEYS = [
  'projectGoal', 'stageGoals', 'successCriteria', 'stack', 'directory', 'scopeNonGoals',
  'timeResourcesCost', 'permissionBoundary', 'reportingCycle', 'acceptance',
] as const
export const TALK_LABELS: Record<string, string> = {
  projectGoal: '项目目标', stageGoals: '阶段目标', successCriteria: '成功标准',
  stack: '技术栈', directory: '项目目录', scopeNonGoals: '范围/非目标',
  timeResourcesCost: '时间/资源/费用', permissionBoundary: '权限边界',
  reportingCycle: '报告周期', acceptance: '验收方式',
}

export const api = {
  listProjects: (): Promise<{ ok: boolean; projects: ProjectRow[] }> => request('/projects'),
  createProject: (body: { name: string; type: string; owner: string; initialGoal: string }):
  Promise<{ ok: boolean; project: ProjectRow }> =>
    request('/projects', { method: 'POST', body: JSON.stringify(body) }),
  getProject: (id: string): Promise<{ ok: boolean; project: CoderProjectRecord }> => request('/projects/' + encodeURIComponent(id)),
  postTalk: (id: string, body: Record<string, unknown>): Promise<{ ok: boolean; contract: CoderContract; status: ProjectStatus }> =>
    request('/projects/' + encodeURIComponent(id) + '/talks', { method: 'POST', body: JSON.stringify(body) }),
  getContract: (id: string): Promise<{ ok: boolean; contract: CoderContract }> => request('/projects/' + encodeURIComponent(id) + '/contract'),
  postContract: (id: string, body: Record<string, unknown>): Promise<{ ok: boolean; contract: CoderContract }> =>
    request('/projects/' + encodeURIComponent(id) + '/contract', { method: 'POST', body: JSON.stringify(body) }),
  advanceLoop: (id: string): Promise<{ ok: boolean; project: CoderProjectRecord }> =>
    request('/projects/' + encodeURIComponent(id) + '/loop', { method: 'POST', body: JSON.stringify({ action: 'advance' }) }),
  listTasks: (id: string): Promise<{ ok: boolean; tasks: CoderTask[] }> => request('/projects/' + encodeURIComponent(id) + '/tasks'),
  addTask: (id: string, body: Record<string, unknown>): Promise<{ ok: boolean; task: CoderTask }> =>
    request('/projects/' + encodeURIComponent(id) + '/tasks', { method: 'POST', body: JSON.stringify(body) }),
  decideApproval: (id: string, body: Record<string, unknown>): Promise<{ ok: boolean; project: CoderProjectRecord }> =>
    request('/projects/' + encodeURIComponent(id) + '/approvals', { method: 'POST', body: JSON.stringify(body) }),
  reportGate: (id: string, body: Record<string, unknown>): Promise<{ ok: boolean; qualityGates: QualityGate[] }> =>
    request('/projects/' + encodeURIComponent(id) + '/quality-gates', { method: 'POST', body: JSON.stringify(body) }),
}
