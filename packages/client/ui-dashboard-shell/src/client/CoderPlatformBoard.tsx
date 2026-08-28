/**
 * CoderPlatformBoard — Coder Agent 最小闭环的第 1 个可运行界面。
 *
 * 数据全部来自同源 `/dashboard/coder/*`（host 插件 JSON 存储），不硬编码假
 * 数据；后端能力缺失时显示明确「未接入/失败」状态。视图：
 *  1) 项目列表 + 新建项目（A1）
 *  2) 项目详情：启动共创对谈（A2）、契约页（A3/A4）、Loop 控制面 + 健康度
 *     （C1/C2/C3）、任务（R21）、审批闭环（D1-D4）、质量门（C03）、审计（R84）
 */
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import css from './CoderPlatformBoard.module.css'
import { CoderBoard } from './CoderBoard.tsx'
import {
  api, TALK_KEYS, TALK_LABELS, type CoderProjectRecord, type ProjectRow,
  type CoderTask, type CoderStage, type QualityGate,
} from './coder-platform.ts'

function fmtTs(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const p = (n: number): string => (n < 10 ? '0' + String(n) : String(n))
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 列表项：项目行卡片。 */
function ProjectRowCard({ row, onOpen }: { row: ProjectRow; onOpen: () => void }) {
  const healthCls = row.health === '正常' ? css.healthOk : row.health === '已完成' ? css.healthOk : row.health === '关注' ? css.healthWarn : row.health === '警告' || row.health === '暂停' ? css.healthWarn : css.healthErr
  return (
    <button type="button" className={css.projectRow} onClick={onOpen}>
      <div className={css.projectRowMain}>
        <strong>{row.name}</strong>
        <span className={css.muted}>{row.summary || '（无摘要）'}</span>
      </div>
      <div className={css.projectRowMeta}>
        <span className={css.statusChip}>{row.status}</span>
        <span className={clsx(css.healthChip, healthCls)}>{row.health}</span>
        <span className={css.muted}>Loop v{row.loopNo}</span>
        <span className={css.muted}>待确认 {row.pendingConfirms}</span>
        <span className={css.muted}>{fmtTs(row.updatedAt)}</span>
      </div>
    </button>
  )
}

/** 细节行：K/V（审计、契约元信息通用）。 */
function Kv({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className={css.kv}>
      <span className={css.kvK}>{k}</span>
      <span className={clsx(css.kvV, mono ? css.mono : null)}>{v}</span>
    </div>
  )
}

function GateChip({ g }: { g: QualityGate }) {
  const cls = g.state === '通过' ? css.badgeOk : g.state === '失败' ? css.badgeErr : g.state === '运行中' ? css.badgeInfo : css.badgeMuted
  return <span className={clsx(css.badge, cls)} title={g.detail ?? ''}>{g.name}: {g.state}</span>
}

/** 任务详情：审批入口（D）。 */
function TaskRow({ task, onApprove, onReject }: {
  task: CoderTask
  onApprove: () => void
  onReject: () => void
}) {
  const stCls = task.status === '通过' ? css.badgeOk : task.status === '不通过' ? css.badgeErr : task.status === '执行中' ? css.badgeInfo : task.status === '等待确认' ? css.badgeWarn : css.badgeMuted
  return (
    <div className={css.taskRow}>
      <div className={css.taskMain}>
        <span className={css.taskId}>{task.id}</span>
        <span className={clsx(css.badge, stCls)}>{task.status}</span>
        {task.rejectionCount > 0 ? <span className={css.rejectChip}>拒绝 ×{task.rejectionCount}</span> : null}
        <span className={css.muted}>v{task.reworkVersion}</span>
      </div>
      <div className={css.taskBody}>
        <div className={css.muted}>来源：{task.sourceReason}</div>
        <div>预期产物：{task.expectedOutput}</div>
        <div className={css.muted}>完成条件：{task.doneCondition}</div>
      </div>
      {task.status === '等待确认' || task.status === '执行中' ? (
        <div className={css.taskActions}>
          <button type="button" className={css.primaryBtn} onClick={onApprove}>批准</button>
          <button type="button" className={css.ghostBtn} onClick={onReject}>拒绝</button>
        </div>
      ) : null}
    </div>
  )
}

/** 阶段卡：展示阶段验收（R33）。 */
function StageCard({ stage, onApprove, onReject }: {
  stage: CoderStage
  onApprove: () => void
  onReject: () => void
}) {
  const stCls = stage.status === '通过' ? css.badgeOk : stage.status === '不通过' ? css.badgeErr : stage.status === '执行中' ? css.badgeInfo : stage.status === '等待验收' ? css.badgeWarn : css.badgeMuted
  return (
    <div className={css.stageCard}>
      <div className={css.taskMain}>
        <strong>{stage.title}</strong>
        <span className={clsx(css.badge, stCls)}>{stage.status}</span>
      </div>
      <div className={css.muted}>目标：{stage.goal}</div>
      <div className={css.muted}>验收：{stage.acceptance}</div>
      <div className={css.muted}>产物：{stage.artifacts.length === 0 ? '暂无' : stage.artifacts.map(a => a.name).join('、')}</div>
      {stage.status === '等待验收' ? (
        <div className={css.taskActions}>
          <button type="button" className={css.primaryBtn} onClick={onApprove}>验收通过</button>
          <button type="button" className={css.ghostBtn} onClick={onReject}>退回</button>
        </div>
      ) : null}
    </div>
  )
}

/** 项目详情视图。 */
function ProjectDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [project, setProject] = useState<CoderProjectRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [talkText, setTalkText] = useState('')
  const [talkValue, setTalkValue] = useState('')
  const [talkKey, setTalkKey] = useState<string>(TALK_KEYS[0] ?? '')
  const [rejectReason, setRejectReason] = useState('')
  const [rejectTarget, setRejectTarget] = useState<{ type: 'task' | 'stage'; id: string } | null>(null)
  const [gateName, setGateName] = useState('lint')
  const [gateState, setGateState] = useState('通过')
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(() => {
    api.getProject(id).then(d => setProject(d.project)).catch((e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
  }, [id])

  useEffect(() => { load() }, [load])

  if (project === null) {
    return <div className={css.board}><button type="button" className={css.ghostBtn} onClick={onBack}>← 返回项目列表</button>{message ? <div className={css.errorState}>{message}</div> : <div className={css.muted}>加载中…</div>}</div>
  }
  const decided = new Set(project.contract.decisions.map(d => d.key))

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setMessage(null)
    try { await fn(); load() } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const approve = (entityType: 'task' | 'stage', entityId: string) => run(() => api.decideApproval(id, { entityType, entityId, decision: '批准', reason: '人验收通过' }))
  const reject = () => {
    if (rejectTarget === null || rejectReason.trim() === '') { setMessage('拒绝必须填写理由'); return }
    void run(() => api.decideApproval(id, { entityType: rejectTarget.type, entityId: rejectTarget.id, decision: '拒绝', reason: rejectReason.trim() }).then(() => { setRejectTarget(null); setRejectReason('') }))
  }
  const reportGate = () => run(() => api.reportGate(id, { name: gateName, state: gateState, detail: `人工报告 ${fmtTs(new Date().toISOString())}` }))

  return (
    <div className={css.board}>
      <div className={css.pageHead}>
        <div className={css.titleBlock}>
          <button type="button" className={css.ghostBtn} onClick={onBack}>← 返回</button>
          <h1 className={css.pageTitle}>{project.name}</h1>
          <span className={css.statusChip}>{project.status}</span>
        </div>
        <div className={css.rangeRow}><span className={css.muted}>更新 {fmtTs(project.updatedAt)}</span><button type="button" className={css.refreshBtn} onClick={load} disabled={busy}>刷新</button></div>
      </div>
      {message && <div className={css.errorState} role="alert">{message}</div>}

      {/* Loop 控制面 + 健康度（C1/C2/C3） */}
      <div className={css.card}>
        <div className={css.cardHead}>
          <div className={css.cardTitle}>Loop 控制面</div>
          <button type="button" className={css.primaryBtn} disabled={busy} onClick={() => run(() => api.advanceLoop(id))}>发起下一轮 Loop</button>
        </div>
        <div className={css.kpiRow}>
          <div className={css.kpi}>
            <span className={css.kpiLabel}>Loop 编号</span>
            <span className={css.kpiValue}>v{project.loopNo}</span>
          </div>
          <div className={css.kpi}>
            <span className={css.kpiLabel}>健康度</span>
            <span className={clsx(css.kpiValue,
              project.health === '正常' ? css.healthOk : project.health === '关注' || project.health === '警告' ? css.healthWarn : css.healthErr,
            )}>{project.health}</span>
          </div>
          <div className={css.kpi}>
            <span className={css.kpiLabel}>最近运行</span>
            <span className={css.kpiValue} style={{ fontSize: 12 }}>{fmtTs(project.lastLoopAt)}</span>
          </div>
          <div className={css.kpi}>
            <span className={css.kpiLabel}>进行中/待处理</span>
            <span className={css.kpiValue}>{project.tasks.filter(t => t.status === '执行中' || t.status === '待执行').length}</span>
          </div>
          <div className={css.kpi}>
            <span className={css.kpiLabel}>待确认</span>
            <span className={css.kpiValue}>{project.pendingConfirms}</span>
          </div>
        </div>
        {project.riskBlocks.length > 0 && (
          <div className={css.riskList}>
            <strong>风险/阻塞：</strong>
            {project.riskBlocks.map((r, i) => <div key={i} className={css.riskItem}>⚠ {r}</div>)}
          </div>
        )}
        <div className={css.gateRow}>{project.qualityGates.map(g => <GateChip key={g.name} g={g} />)}</div>
        <div className={css.inlineForm}>
          <select className={css.select} value={gateName} onChange={(e) => { setGateName(e.target.value) }}>
            {['lint', 'typecheck', '测试', '构建'].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <select className={css.select} value={gateState} onChange={(e) => { setGateState(e.target.value) }}>
            {['未运行', '运行中', '通过', '失败', '跳过'].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button type="button" className={css.ghostBtn} onClick={reportGate} disabled={busy}>报告质量门结果</button>
        </div>
      </div>

      {/* 启动共创（A2）：决策项逐项确认 */}
      <div className={css.card}>
        <div className={css.cardTitle}>目标共创对谈</div>
        <div className={css.contractGrid}>
          {TALK_KEYS.map(k => (
            <div key={k} className={clsx(css.talkItem, decided.has(k) ? css.talkDone : null)}>
              <strong>{TALK_LABELS[k]}</strong>
              <span className={css.muted}>{decided.has(k) ? project.contract.decisions.find(d => d.key === k)?.value ?? '—' : '（待确认）'}</span>
            </div>
          ))}
        </div>
        <div className={css.inlineForm}>
          <select className={css.select} value={talkKey} onChange={(e) => { setTalkKey(e.target.value) }}>
            {TALK_KEYS.map(k => <option key={k} value={k}>{TALK_LABELS[k]}</option>)}
          </select>
          <input className={css.input} placeholder="确认值（例如：React + Vite，部署到 3082）" value={talkValue} onChange={(e) => { setTalkValue(e.target.value) }} />
          <button type="button" className={css.primaryBtn} disabled={busy || talkValue.trim() === ''} onClick={() => { const k = talkKey; run(() => api.postTalk(id, { key: k, value: talkValue.trim() })); setTalkValue('') }}>确认该决策项</button>
        </div>
        <div className={css.inlineForm}>
          <input className={css.input} placeholder="补充/纠正（人类可随时插入）" value={talkText} onChange={(e) => { setTalkText(e.target.value) }} />
          <button type="button" className={css.ghostBtn} disabled={busy || talkText.trim() === ''} onClick={() => { const t = talkText.trim(); run(() => api.postTalk(id, { text: t })); setTalkText('') }}>补充说明</button>
        </div>
      </div>

      {/* 契约（A3/A4） */}
      <div className={css.card}>
        <div className={css.cardHead}><div className={css.cardTitle}>项目契约 v{project.contract.version}</div></div>
        <Kv k="原始需求" v={project.contract.rawBrief || '（未填写）'} />
        <Kv k="验收方式" v={project.contract.acceptanceBasis} />
        <div className={css.sectionTitle}>待确认项</div>
        {project.contract.pendingItems.length === 0
          ? <span className={css.muted}>无</span>
          : project.contract.pendingItems.map(x => <div key={x} className={css.muted}>• {x}</div>)}
        <div className={css.sectionTitle}>约束</div>
        {project.contract.constraints.length === 0
          ? <span className={css.muted}>无</span>
          : project.contract.constraints.map(x => <div key={x} className={css.muted}>• {x}</div>)}
        <div className={css.sectionTitle}>目标演化</div>
        {project.contract.goalEvolution.length === 0
          ? <span className={css.muted}>无</span>
          : project.contract.goalEvolution.map((g, i) => (
            <div key={i} className={css.muted}>{fmtTs(g.ts)}：{g.from} → {g.to}（{g.by}）</div>
          ))}
      </div>

      {/* 阶段（R26/R33） */}
      <div className={css.card}>
        <div className={css.cardTitle}>阶段</div>
        {project.stages.length === 0 ? <span className={css.muted}>暂无阶段（完成共创后由 AI 自动设计）</span> : project.stages.map(s => (
          <StageCard key={s.id} stage={s} onApprove={() => approve('stage', s.id)} onReject={() => { setRejectReason(''); setRejectTarget({ type: 'stage', id: s.id }) }} />
        ))}
      </div>

      {/* 任务（R21）+ 审批闭环（D） */}
      <div className={css.card}>
        <div className={css.cardHead}><div className={css.cardTitle}>任务</div></div>
        {project.tasks.length === 0 ? <span className={css.muted}>暂无任务（发起 Loop 自动创建，或人工追加）</span> : project.tasks.map(t => (
          <TaskRow key={t.id} task={t} onApprove={() => approve('task', t.id)} onReject={() => { setRejectReason(''); setRejectTarget({ type: 'task', id: t.id }) }} />
        ))}
      </div>

      {/* 拒绝弹层 */}
      {rejectTarget !== null && (
        <div className={css.modal}>
          <div className={css.modalBackdrop} onClick={() => { setRejectTarget(null) }} />
          <div className={css.modalPanel}>
            <div className={css.modalHead}><span>拒绝 {rejectTarget.type} {rejectTarget.id}</span><button type="button" className={css.modalClose} onClick={() => { setRejectTarget(null) }}>✕</button></div>
            <div className={css.modalBody}>
              <textarea className={css.textarea} placeholder="必须填写拒绝理由（可附说明；附件能力待接入）" value={rejectReason} onChange={(e) => { setRejectReason(e.target.value) }} />
              <button type="button" className={css.primaryBtn} onClick={reject} disabled={busy}>提交拒绝</button>
            </div>
          </div>
        </div>
      )}

      {/* 事件流（R67 摘要） */}
      <div className={css.card}>
        <div className={css.cardTitle}>事件流（最近）</div>
        <div className={css.eventList}>
          {[...project.events].reverse().slice(0, 12).map(ev => (
            <div key={ev.eventId} className={clsx(css.eventRow, ev.status === 'fail' ? css.eventFail : null)}>
              <span className={css.mono}>#{ev.seq}</span>
              <span className={css.muted}>{fmtTs(ev.ts)}</span>
              <span>{ev.detail}</span>
            </div>
          ))}
          {project.events.length === 0 ? <span className={css.muted}>暂无事件</span> : null}
        </div>
      </div>

      {/* 审计（R84） */}
      <div className={css.card}>
        <div className={css.cardTitle}>审计记录</div>
        <div className={css.tableWrap}>
          <table className={css.table}><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>原→新</th><th>决定/理由</th></tr></thead>
            <tbody>{project.audits.map(a => <tr key={a.id}><td>{fmtTs(a.ts)}</td><td>{a.operator}</td><td>{a.action}</td><td>{a.from} → {a.to}</td><td>{a.decision}{a.reason ? '：' + a.reason : ''}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/** 主视图：项目列表 + 新建项目（A1），可切换回 6995 任务看板。 */
export function CoderPlatformBoard() {
  const [view, setView] = useState<'platform' | 'board'>('platform')
  const [rows, setRows] = useState<readonly ProjectRow[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.listProjects()
      .then(d => setRows(d.projects ?? []))
      .catch((e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
  }, [])

  useEffect(() => { load() }, [load])

  const create = () => {
    if (name.trim() === '') { setMessage('项目名称不能为空'); return }
    setBusy(true); setMessage(null)
    api.createProject({ name: name.trim(), type: 'coder', owner: owner.trim() || '未指定', initialGoal: goal.trim() })
      .then((d) => { setShowNew(false); setName(''); setOwner(''); setGoal(''); load(); setOpenId(d.project.id) })
      .catch((e: unknown) => setMessage(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }

  if (view === 'board') return <CoderBoard />

  if (openId !== null) return <ProjectDetail id={openId} onBack={() => { setOpenId(null); load() }} />

  return (
    <div className={css.board}>
      <div className={css.pageHead}>
        <div>
          <h1 className={css.pageTitle}>Coder 项目平台</h1>
          <p className={css.pageDesc}>项目创建 · 启动共创 · Loop 控制面 · 健康度 · 分层验收与审批（阶段一最小闭环）</p>
        </div>
        <div className={css.rangeRow}>
          <button type="button" className={css.ghostBtn} onClick={() => { setView('board') }}>任务看板</button>
          <button type="button" className={css.refreshBtn} onClick={load}>刷新</button>
          <button type="button" className={css.primaryBtn} onClick={() => { setShowNew(v => !v) }}>新建项目</button>
        </div>
      </div>
      {message && <div className={css.errorState} role="alert">{message}</div>}

      {showNew && (
        <div className={css.card}>
          <div className={css.cardTitle}>新建项目（A1·先进入目标共创，不直接启动）</div>
          <div className={css.formCol}>
            <input className={css.input} placeholder="项目名称 *" value={name} onChange={(e) => { setName(e.target.value) }} />
            <input className={css.input} placeholder="负责人（默认：未指定）" value={owner} onChange={(e) => { setOwner(e.target.value) }} />
            <textarea className={css.textarea} placeholder="初始目标（原始需求）" value={goal} onChange={(e) => { setGoal(e.target.value) }} />
            <button type="button" className={css.primaryBtn} disabled={busy} onClick={create}>创建并进入共创</button>
          </div>
        </div>
      )}

      <div className={css.list}>
        {rows.length === 0
          ? <div className={css.emptyState}>暂无项目 —— 点击「新建项目」创建第一个 Coder 项目</div>
          : rows.map(r => <ProjectRowCard key={r.id} row={r} onOpen={() => { setOpenId(r.id) }} />)}
      </div>
    </div>
  )
}
