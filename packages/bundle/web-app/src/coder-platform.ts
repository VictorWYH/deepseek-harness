/**
 * coder-platform — Coder Agent 最小闭环原型的本地存储 host 插件。
 *
 * 阶段一 (阶段内最小闭环) — 只实现 Coder（不做 Video），遵循评审决策清单：
 *   A 项目创建+启动共创（R30-R33, C02）→ 契约落库；
 *   B 轻量 JSON 数据模型（R20-R26, R22）— Project/Phase/Task/Event/Approval/
 *     Feedback/Audit 统一模型，存 JSON 文件，不改 DSH 内核；
 *   C 最小 Loop 控制面 + 健康度规则推导（R10-R13, R64）；
 *   D 批准-拒绝-重提审批闭环 + 审计（R80-R84, C03）。
 *
 * 浏览器不能直接写盘，本插件在 DSH webserver 注册 `/dashboard/coder/*` 前缀
 * 路由，对所有请求做 JSON 解析/校验并读写磁盘存储．所有写操作写审计记录；
 * 健康度由系统规则从真实任务/事件/质量门推导，AI 只解释。
 *
 * @module @deepseek-ai/dsh-web-app/coder-platform
 */

import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** 稳定插件名。 */
export const name = 'coder-platform'

/** 依赖：DSH webserver（注册前缀路由）。 */
export const inject = ['webServer']

/** 浏览器侧前缀。 */
export const PROXY_PREFIX = '/dashboard/coder'

/** dsh-fork 仓库根（存储默认落在其下 .coder-platform/，环境变量可覆盖）。 */
const SOURCE_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** 连续拒绝达到该阈值后停止自动重提并升级人工介入。 */
const MAX_REJECTIONS = 3

/** 阶段闭环：一次对谈里 AI 按序确认的各项（C02）。 */
const TALKS = [
  'projectGoal', 'stageGoals', 'successCriteria', 'stack', 'directory', 'scopeNonGoals',
  'timeResourcesCost', 'permissionBoundary', 'reportingCycle', 'acceptance',
] as const
type TalkKey = (typeof TALKS)[number]
const TALK_LABELS: Record<TalkKey, string> = {
  projectGoal: '项目目标', stageGoals: '阶段目标', successCriteria: '成功标准',
  stack: '技术栈', directory: '项目目录', scopeNonGoals: '范围/非目标',
  timeResourcesCost: '时间/资源/费用', permissionBoundary: '权限边界',
  reportingCycle: '报告周期', acceptance: '验收方式',
}

/** 一个项目的核心契约记录。 */
export interface CoderContract {
  version: number
  rawBrief: string
  conversations: { seq: number; role: 'ai' | 'human'; ts: string; text: string }[]
  decisions: { key: TalkKey; label: string; value: string; confirmedAt: string }[]
  goalEvolution: { ts: string; from: string; to: string; by: string }[]
  constraints: string[]
  pendingItems: string[]
  acceptanceBasis: string
  updatedAt: string
}

/** 统一元信息项目行（R65 子集）。 */
export interface CoderProjectRecord {
  id: string
  name: string
  type: 'coder'
  owner: string
  status: '共创中' | '进行中' | '已完成' | '已归档' | '暂停'
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
  qualityGates: { name: string; state: '未运行' | '运行中' | '通过' | '失败' | '跳过'; detail?: string | undefined }[]
}

/** 阶段（R26）。 */
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

/** 任务（R21）。 */
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

/** 事件（R11/R67）。 */
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

/** 审批记录（R80-R83）。 */
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

/** 审计（R84）。 */
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

type HealthGrade = '正常' | '关注' | '警告' | '危险' | '暂停' | '已完成' | '已归档'

/** 健康度推导规则（R64）：纯系统规则基于真实任务/事件/质量门。 */
function deriveHealth(p: CoderProjectRecord): HealthGrade {
  if (p.status === '已完成') return '已完成'
  if (p.status === '已归档') return '已归档'
  const running = p.tasks.filter(t => t.status === '执行中' || t.status === '待执行')
  const failedGates = p.qualityGates.filter(g => g.state === '失败').length
  const rejected = p.tasks.filter(t => t.rejectionCount >= MAX_REJECTIONS).length
  if (rejected > 0) return '暂停'
  if (failedGates > 0) return '危险'
  const lastEvent = p.events.length > 0 ? p.events[p.events.length - 1] : undefined
  const stale = lastEvent !== undefined && Date.now() - new Date(lastEvent.ts).getTime() > 30 * 60_000
  if (stale && running.length > 0) return '警告'
  if (running.length > 6) return '关注'
  if (p.riskBlocks.length > 0) return '关注'
  return '正常'
}

/** 磁盘 JSON 读写：UTF-8 显式编码。 */
function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback
  try { return JSON.parse(readFileSync(file, 'utf8')) as T } catch { return fallback }
}
function writeJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8')
}

/**
 * 注册 Coder 平台路由。每个项目一个 `projects/<id>.json` 文件，索引 `index.json`。
 * @param ctx - plugin context。
 */
export function apply(ctx: Context): void {
  const storeRoot = path.join(process.env.CODER_PLATFORM_DATA ?? path.join(SOURCE_ROOT, '.coder-platform'), 'projects')
  mkdirSync(storeRoot, { recursive: true })
  const indexFile = path.join(storeRoot, '..', 'index.json')

  const readIndex = (): Record<string, string> => readJson(indexFile, {})
  const writeIndex = (v: Record<string, string>): void => writeJson(indexFile, v)

  const load = (id: string): CoderProjectRecord | null => {
    const safe = /^[A-Za-z0-9_-]+$/u.test(id) ? id : ''
    if (!safe) return null
    const file = path.join(storeRoot, safe + '.json')
    const p = readJson<CoderProjectRecord | null>(file, null)
    if (p === null || p.id !== safe) return null
    return p
  }
  const save = (p: CoderProjectRecord): void => {
    p.updatedAt = new Date().toISOString()
    p.health = deriveHealth(p)
    writeJson(path.join(storeRoot, p.id + '.json'), p)
  }

  const json = (res: ServerResponse, code: number, body: unknown): void => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> => new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8') })
    req.on('end', () => {
      try { const v = raw === '' ? {} : JSON.parse(raw); resolve(typeof v === 'object' && v !== null ? v as Record<string, unknown> : {}) }
      catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })

  const audit = (p: CoderProjectRecord, from: string, to: string, action: string, decision: string, reason: string, evidence = 'coder-platform'): void => {
    p.audits.unshift({
      id: 'aud-' + p.audits.length + '-' + Date.now(),
      ts: new Date().toISOString(),
      operator: 'human',
      role: 'owner',
      scope: `project:${p.id}`,
      action, from, to, decision, reason, evidence,
    })
  }

  const createEvent = (p: CoderProjectRecord, source: string, status: string, detail: string, entityType: CoderEvent['entityType'], entityId: string | null): void => {
    p.events.push({ eventId: 'ev-' + Date.now() + '-' + p.events.length, seq: p.events.length + 1, ts: new Date().toISOString(), source, status, detail, entityType, entityId })
  }

  ctx.webServer.register({
    kind: 'prefix',
    path: PROXY_PREFIX,
    handler(req: IncomingMessage, res: ServerResponse): void {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://dsh.invalid')
        const seg = url.pathname.slice(PROXY_PREFIX.length).split('/').filter(Boolean)
        const method = req.method ?? 'GET'

        // 路由: /dashboard/coder/projects
        if (seg.length === 1 && seg[0] === 'projects') {
          if (method === 'GET') {
            const index = readIndex()
            const rows = Object.values(index).map((id) => {
              const row = load(id)
              if (row === null) return null
              return {
                id: row.id, name: row.name, status: row.status, health: row.health, loopNo: row.loopNo,
                updatedAt: row.updatedAt, summary: row.summary, pendingConfirms: row.pendingConfirms,
              }
            }).filter(Boolean)
            json(res, 200, { ok: true, projects: rows })
            return
          }
          if (method === 'POST') {
            const body = await readBody(req)
            const name = typeof body.name === 'string' ? body.name.trim() : ''
            const owner = typeof body.owner === 'string' ? body.owner.trim() : '未指定'
            const initialGoal = typeof body.initialGoal === 'string' ? body.initialGoal.trim() : ''
            if (name === '') { json(res, 400, { ok: false, error: '项目名称不能为空' }); return }
            const id = 'proj-' + Date.now().toString(36)
            const now = new Date().toISOString()
            const contract: CoderContract = { version: 1, rawBrief: initialGoal, conversations: [], decisions: [], goalEvolution: [], constraints: [], pendingItems: ['等待共创对谈确认各项决策'], acceptanceBasis: '项目整体验收由人确认；阶段达标需「任务完成+质量门全绿+产物齐备+人阶段验收」四项全满足', updatedAt: now }
            const p: CoderProjectRecord = { id, name, type: 'coder', owner, status: '共创中', health: '正常', loopNo: 0, lastLoopAt: null, currentStageId: null, createdAt: now, updatedAt: now, tags: ['coder'], summary: initialGoal, contract, stages: [], tasks: [], events: [], approvals: [], audits: [], pendingConfirms: 0, riskBlocks: [], qualityGates: [{ name: 'lint', state: '未运行' }, { name: 'typecheck', state: '未运行' }, { name: '测试', state: '未运行' }, { name: '构建', state: '未运行' }] }
            createEvent(p, 'human', 'ok', `创建项目「${name}」，初始目标：${initialGoal}`, 'creation', p.id)
            audit(p, '无', '共创中', '创建项目', 'ok', '人类创建项目并填写初始目标')
            const idx = readIndex(); idx[id] = id; writeIndex(idx)
            save(p)
            json(res, 201, { ok: true, project: { id: p.id, name: p.name, status: p.status, health: p.health } })
            return
          }
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }

        // 路由: /dashboard/coder/projects/:id — 完整记录 / 对谈 / 契约 / loop / 任务 / 审批 / 审计
        if (seg.length >= 2 && seg[0] === 'projects') {
          const id = seg[1]
          if (id === undefined) { json(res, 404, { ok: false, error: '项目不存在' }); return }
          const p = load(id)
          if (p === null) { json(res, 404, { ok: false, error: '项目不存在' }); return }
          const sub = seg[2]

          if (sub === undefined && method === 'GET') { json(res, 200, { ok: true, project: p }); return }

          // 共创对谈：AI 主导、人类逐项补充（R30-R33, C02）
          if (sub === 'talks') {
            if (method === 'POST') {
              const body = await readBody(req)
              const seq = p.contract.conversations.length + 1
              const now = new Date().toISOString()
              const text = typeof body.text === 'string' ? body.text : ''
              if (text !== '') p.contract.conversations.push({ seq, role: 'human', ts: now, text })
              // 确认某一决策项
              const key = typeof body.key === 'string' ? body.key as TalkKey : null
              if (key !== null && TALKS.includes(key)) {
                const value = typeof body.value === 'string' ? body.value : ''
                const existing = p.contract.decisions.findIndex(d => d.key === key)
                const current = existing >= 0 ? p.contract.decisions[existing] : undefined
                if (current !== undefined) { current.value = value; current.confirmedAt = now }
                else p.contract.decisions.push({ key, label: TALK_LABELS[key], value, confirmedAt: now })
                p.contract.pendingItems = p.contract.pendingItems.filter(x => x !== key)
                createEvent(p, 'human', 'ok', `确认「${TALK_LABELS[key]}」：${value}`, 'creation', p.id)
                audit(p, `未确认确认项「${TALK_LABELS[key]}」`, labelOf(p, key), '确认对谈项', 'ok', `人类确认${TALK_LABELS[key]}`)
              }
              if (typeof body.goalEvolution === 'object' && body.goalEvolution !== null) {
                const ge = body.goalEvolution as { from?: unknown; to?: unknown; by?: unknown }
                p.contract.goalEvolution.push({ ts: now, from: String(ge.from ?? ''), to: String(ge.to ?? ''), by: String(ge.by ?? 'human') })
              }
              // 全部决策项确认后项目进入「进行中」
              const allConfirmed = TALKS.every(k => p.contract.decisions.some(d => d.key === k))
              if (allConfirmed && p.status === '共创中') {
                p.status = '进行中'
                createEvent(p, 'system', 'ok', '共创对谈完成，项目契约形成，进入进行中', 'creation', p.id)
                audit(p, '共创中', '进行中', '完成共创', 'ok', '全部决策项确认，项目契约记入版本 1')
                // 生成初始阶段（R26 阶段由 AI 设计，人确认）
                const s0 = { id: p.id + '-s1', title: '阶段一：软件交付基线', goal: p.contract.decisions.find(d => d.key === 'stageGoals')?.value ?? '完成可运行最小闭环', order: 1, dependsOn: [] as string[], acceptance: p.contract.decisions.find(d => d.key === 'acceptance')?.value ?? '人验收通过', status: '执行中' as const, artifacts: [] as { name: string; path: string; verified: boolean }[] }
                p.stages.push(s0)
                p.currentStageId = s0.id
                createEvent(p, 'system', 'ok', `生成初始阶段「${s0.title}」`, 'stage', s0.id)
              }
              save(p)
              json(res, 200, { ok: true, contract: p.contract, status: p.status })
              return
            }
            json(res, 405, { ok: false, error: 'method not allowed' })
            return
          }

          // 契约页（版本化，A4）
          if (sub === 'contract') {
            if (method === 'GET') { json(res, 200, { ok: true, contract: p.contract }); return }
            if (method === 'POST') {
              const body = await readBody(req)
              const note = typeof body.note === 'string' ? body.note.trim() : ''
              const constraint = typeof body.constraint === 'string' ? body.constraint.trim() : ''
              if (constraint !== '') { p.contract.constraints.push(constraint); audit(p, '', `约束:${constraint}`, '追加约束', 'ok', '人类补充约束') }
              if (note !== '' && typeof body.decision === 'object' && body.decision !== null) {
                p.contract.decisions.push({ key: 'projectGoal', label: TALK_LABELS.projectGoal, value: note, confirmedAt: new Date().toISOString() })
                p.contract.pendingItems = p.contract.pendingItems.filter(x => x !== 'human-note')
                audit(p, '补充说明', note, '补充项目说明', 'ok', '人类补充')
              }
              const bump = body.bumpVersion === true
              if (bump) { p.contract.version += 1; audit(p, `契约 v${p.contract.version - 1}`, `契约 v${p.contract.version}`, '契约版本更新', 'ok', '人类确认版本递增') }
              p.contract.updatedAt = new Date().toISOString()
              save(p)
              json(res, 200, { ok: true, contract: p.contract })
              return
            }
          }

          // 最小 Loop 控制面（C1/C2）：发起一轮自动推进，创建任务并生成事件
          if (sub === 'loop') {
            if (method === 'POST') {
              const body = await readBody(req)
              const action = typeof body.action === 'string' ? body.action : 'advance'
              if (action === 'advance') {
                p.loopNo += 1
                p.lastLoopAt = new Date().toISOString()
                createEvent(p, 'loop', 'ok', `第 ${p.loopNo} 轮 Loop：观察→理解→计划→派发→验证→决策→汇报`, 'loop', null)
                // 若存在待处理任务则派发；否则创建首个最小任务
                const pending = p.tasks.find(t => t.status === '待执行')
                if (pending) {
                  pending.status = '执行中'
                  createEvent(p, 'system', 'ok', `派发任务 ${pending.id}：${pending.expectedOutput}`, 'task', pending.id)
                } else if (p.tasks.length < 2) {
                  const t: CoderTask = { id: 't' + (p.tasks.length + 1) + '-' + Date.now().toString(36), parentTaskId: null, sourceReason: `第 ${p.loopNo} 轮 Loop 自动推进`, input: p.summary, expectedOutput: p.contract.acceptanceBasis, agent: 'coder', dependsOn: [], doneCondition: '任务完成且质量门通过', status: '待执行', reworkVersion: 1, rejectionCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                  p.tasks.push(t)
                  createEvent(p, 'loop', 'ok', `创建任务 ${t.id}：${t.expectedOutput}`, 'task', t.id)
                }
                p.riskBlocks = p.tasks.filter(t => t.status === '不通过').map(t => `任务 ${t.id} 未通过验收`)
                audit(p, `Loop v${p.loopNo - 1}`, `Loop v${p.loopNo}`, '发起下一轮 Loop', 'ok', 'AI 自动推进创建任务并产生事件')
                save(p)
                json(res, 200, { ok: true, project: {
                  loopNo: p.loopNo, lastLoopAt: p.lastLoopAt, health: p.health, pendingConfirms: p.pendingConfirms,
                  tasks: p.tasks, events: p.events.slice(-5),
                } })
                return
              }
              json(res, 400, { ok: false, error: 'unknown loop action' })
              return
            }
          }

          // 任务（R21）：提交 → 等待确认；重提生成新版本
          if (sub === 'tasks') {
            if (method === 'GET') { json(res, 200, { ok: true, tasks: p.tasks }); return }
            if (method === 'POST') {
              const body = await readBody(req)
              const expected = typeof body.expectedOutput === 'string' ? body.expectedOutput.trim() : ''
              if (expected === '') { json(res, 400, { ok: false, error: '缺少预期产物' }); return }
              const t: CoderTask = { id: 't' + (p.tasks.length + 1) + '-' + Date.now().toString(36), parentTaskId: typeof body.parentTaskId === 'string' ? body.parentTaskId : null, sourceReason: typeof body.sourceReason === 'string' ? body.sourceReason : '人工补充任务', input: String(body.input ?? ''), expectedOutput: expected, agent: 'coder', dependsOn: Array.isArray(body.dependsOn) ? body.dependsOn.map(String) : [], doneCondition: typeof body.doneCondition === 'string' ? body.doneCondition : '质量门通过', status: '待执行', reworkVersion: 1, rejectionCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
              p.tasks.push(t)
              audit(p, '', expected, '人工追加任务', 'ok', '人类补充任务')
              save(p)
              json(res, 201, { ok: true, task: t })
              return
            }
          }

          // 审批闭环（R80-R83，D）
          if (sub === 'approvals') {
            if (method === 'POST') {
              const body = await readBody(req)
              const entityType = typeof body.entityType === 'string' && (body.entityType === 'stage' || body.entityType === 'task') ? body.entityType : 'task'
              const entityId = String(body.entityId ?? '')
              const decision = String(body.decision ?? '')
              const reason = String(body.reason ?? '')
              const target = entityType === 'stage' ? p.stages.find(s => s.id === entityId) : p.tasks.find(t => t.id === entityId)
              if (target === undefined) { json(res, 404, { ok: false, error: '实体不存在' }); return }
              const task = entityType === 'task' ? target as CoderTask : null
              // 批准：通过继续下游
              if (decision === '批准') {
                if (task !== null) task.status = '通过'
                else (target as CoderStage).status = '通过'
                const appr: CoderApproval = { id: 'ap-' + Date.now().toString(36), entityType, entityId, submittedBy: p.owner, decision: '批准', reason, attachments: Array.isArray(body.attachments) ? body.attachments.map((a: unknown) => ({ name: String((a as { name?: unknown })?.name ?? ''), path: String((a as { path?: unknown })?.path ?? '') })) : [], decidedBy: 'human', decidedAt: new Date().toISOString(), version: task?.reworkVersion ?? p.contract.version }
                p.approvals.push(appr)
                createEvent(p, 'human', 'ok', `批准${entityType === 'stage' ? '阶段' : '任务'} ${entityId}${reason ? '：' + reason : ''}`, entityType, entityId)
                audit(p, '等待确认', '通过', '批准', 'ok', reason || '人批准')
                if (p.pendingConfirms > 0) p.pendingConfirms -= 1
              }
              // 拒绝：必须填理由；连续拒绝达阈值停止自动重提升级人工
              else if (decision === '拒绝') {
                if (reason.trim() === '') { json(res, 400, { ok: false, error: '拒绝必须填写理由' }); return }
                if (task !== null) {
                  task.status = '不通过'
                  task.rejectionCount += 1
                  task.reworkVersion += 1
                  if (task.rejectionCount >= MAX_REJECTIONS) {
                    p.status = p.status === '已完成' ? p.status : '暂停'
                    p.riskBlocks = [...p.riskBlocks.filter(x => !x.includes(task.id)), `任务 ${task.id} 连续拒绝 ${task.rejectionCount} 次，已停止自动重提，需人工直接介入`]
                  } else {
                    // 允许重提：Agent 收到理由后处理并重提，生成新版本
                    task.status = '待执行'
                  }
                } else {
                  (target as CoderStage).status = '不通过'
                  if (p.pendingConfirms > 0) p.pendingConfirms -= 1
                }
                p.approvals.push({ id: 'ap-' + Date.now().toString(36), entityType, entityId, submittedBy: p.owner, decision: '拒绝', reason, attachments: [], decidedBy: 'human', decidedAt: null, version: task?.reworkVersion ?? p.contract.version })
                createEvent(p, 'human', 'fail', `拒绝${entityType === 'stage' ? '阶段' : '任务'} ${entityId}：${reason}`, entityType, entityId)
                audit(p, '等待确认', '拒绝', '拒绝', 'fail', reason)
              } else {
                json(res, 400, { ok: false, error: 'decision 必须为 批准/拒绝' })
                return
              }
              save(p)
              json(res, 200, { ok: true, project: {
                status: p.status, health: p.health, approvals: p.approvals.slice(-5), tasks: p.tasks, riskBlocks: p.riskBlocks,
              } })
              return
            }
            json(res, 405, { ok: false, error: 'method not allowed' })
            return
          }

          // 质量门（C03）：lint/typecheck/测试/构建 状态可由前端提交真实结果
          if (sub === 'quality-gates') {
            if (method === 'POST') {
              const body = await readBody(req)
              const name = String(body.name ?? '')
              const state = String(body.state ?? '')
              const detail = typeof body.detail === 'string' ? body.detail : undefined
              const gate = p.qualityGates.find(g => g.name === name)
              if (gate === undefined) { json(res, 404, { ok: false, error: '质量门不存在' }); return }
              if (['未运行', '运行中', '通过', '失败', '跳过'].includes(state)) {
                gate.state = state as CoderProjectRecord['qualityGates'][number]['state']
                gate.detail = detail
                createEvent(p, 'system', state === '通过' ? 'ok' : state === '失败' ? 'fail' : 'info', `质量门 ${name} ${state}${detail ? '：' + detail : ''}`, 'task', null)
                audit(p, '', name, `质量门 ${name} 报告`, state, detail || '')
                save(p)
                json(res, 200, { ok: true, qualityGates: p.qualityGates })
                return
              }
              json(res, 400, { ok: false, error: '无效质量门状态' })
              return
            }
          }

          json(res, 404, { ok: false, error: 'unknown coder endpoint' })
          return
        }

        json(res, 404, { ok: false, error: 'unknown coder route' })
      })()
    },
  })
}

function labelOf(p: CoderProjectRecord, key: TalkKey): string {
  return p.contract.decisions.find(d => d.key === key)?.label ?? TALK_LABELS[key]
}
