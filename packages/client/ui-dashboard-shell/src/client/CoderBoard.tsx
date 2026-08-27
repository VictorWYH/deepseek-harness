/**
 * CoderBoard — true migration of the 6995 coder task board into the DSH shell.
 *
 * Data flows through the same-origin reverse proxy installed by the web-app
 * bundle's `dashboard-proxy` host plugin: the browser fetches
 * `/dashboard/api/tasks` and `/dashboard/api/task/live`, the DSH webserver
 * relays them to the real 6995 backend (`/api/tasks`, `/api/task/live`), and
 * cookies/CSRF/auth decisions stay entirely with the upstream. Nothing here is
 * fake or sampled: every card, KPI, group, detail, and live log reflects the
 * real bridge inbox/outbox content served by the 6995 server.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import css from './CoderBoard.module.css'

/** One task row as served by 6995 /api/tasks. */
export interface CoderTask {
  id: string
  task_id?: string
  status?: string
  profile?: string
  from?: string
  project?: string
  priority?: string
  type?: string
  summary?: string
  prompt?: string
  prompt_full?: string
  output?: string
  error?: string
  usage?: { input_tokens?: number | string; output_tokens?: number | string; cache_tokens?: number | string; cost?: number | string }
  created_at?: string
  started_at?: string
  finished_at?: string
  updated_at?: string
}

/** Live log payload served by 6995 /api/task/live. */
export interface CoderLiveLog {
  ok?: boolean
  exists?: boolean
  content?: string
  size?: number
  truncated?: boolean
  usage?: { input_tokens?: number | string; output_tokens?: number | string; cache_tokens?: number | string; cost?: number | string }
}

const REFRESH_MS = 30_000
const LIVE_POLL_MS = 3_000

/** One status display mapping. */
export interface StatusMeta {
  label: string
  dot: string
  pill: string
}

const STATUS_META: Record<string, StatusMeta> = {
  running: { label: '执行中', dot: (css.statusDotRunning ?? ''), pill: (css.pillUp ?? '') },
  queued: { label: '排队中', dot: (css.statusDotQueued ?? ''), pill: (css.pillWarn ?? '') },
  done: { label: '已完成', dot: (css.statusDotDone ?? ''), pill: (css.pillInfo ?? '') },
  failed: { label: '失败', dot: (css.statusDotFailed ?? ''), pill: (css.pillDown ?? '') },
  cancelled: { label: '已作废', dot: (css.statusDotFailed ?? ''), pill: (css.pillDown ?? '') },
}

/** Fallback status meta, guaranteed present so lookups never yield undefined. */
const DEFAULT_META: StatusMeta = STATUS_META.queued ?? { label: '排队中', dot: (css.statusDotQueued ?? ''), pill: (css.pillWarn ?? '') }

const GROUPS = [
  { key: 'running', title: '执行中', empty: '暂无执行中的任务' },
  { key: 'queued', title: '排队中', empty: '暂无排队的任务' },
  { key: 'done', title: '已完成', empty: '暂无已完成的任务' },
  { key: 'failed', title: '⚠️ 失败', empty: '暂无失败的任务' },
  { key: 'cancelled', title: '🚫 已作废', empty: '暂无已作废的任务' },
]

const FILTERS = [
  { key: 'all', label: '全部', color: '#a78bfa' },
  { key: 'running', label: '执行中', color: '#22c55e' },
  { key: 'queued', label: '排队中', color: '#f59e0b' },
  { key: 'done', label: '已完成', color: '#38bdf8' },
  { key: 'failed', label: '失败', color: '#ef4444' },
]

const AGENT_ICON: Record<string, string> = {
  '戌狗神': '🐕', '虎先锋': '🐅', '马天霸': '🐎', '朱悟能': '🐷',
  '蛛四妹': '🕷', '孙悟空': '🐒', '旺财': '🐶', '来福': '🐱',
}
const AGENT_NAMES: Record<string, string> = {
  xugoushen: '戌狗神', huxianfeng: '虎先锋', matianba: '马天霸', zhuwuneng: '朱悟能',
  zhusimei: '蛛四妹', sunwukong: '孙悟空', wangcai: '旺财', laifu: '来福',
}

function pad(n: number): string { return n < 10 ? `0${n}` : String(n) }
function fmtDT(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fmtFull(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function fmtTokens(n: number | string | undefined): string {
  if (n === undefined || n === null || n === '') return '—'
  const num = Number(n)
  if (Number.isNaN(num)) return '—'
  return num >= 10000 ? `${(num / 10000).toFixed(1).replace(/\.0$/, '')}万` : String(num)
}
function fmtCost(c: number | string | undefined): string {
  if (c === undefined || c === null || c === '') return ''
  const n = Number(c)
  if (Number.isNaN(n) || n <= 0) return typeof c === 'number' && c <= 0 ? '¥0' : ''
  if (n < 0.01) return '¥<0.01'
  let s = n.toFixed(n < 0.1 ? 4 : 2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  if (!s.includes('.')) s += '.00'
  else if (s.split('.')[1]?.length === 1) s += '0'
  return `¥${s}`
}
function agentName(from: string | undefined): string {
  const f = String(from ?? '').toLowerCase()
  if (AGENT_NAMES[f]) return AGENT_NAMES[f] ?? ''
  for (const key of Object.keys(AGENT_NAMES)) if (f.includes(key)) return AGENT_NAMES[key] ?? ''
  return from || '未知'
}

function stateOf(t: CoderTask): string {
  const s = String(t.status ?? '').toLowerCase()
  return ['running', 'queued', 'done', 'failed', 'cancelled'].includes(s) ? s : 'queued'
}
function computeStats(tasks: readonly CoderTask[]) {
  const s = { total: tasks.length, running: 0, queued: 0, done: 0, failed: 0, cancelled: 0 }
  for (const t of tasks) {
    const k = stateOf(t)
    if (k === 'running') s.running++
    else if (k === 'queued') s.queued++
    else if (k === 'done') s.done++
    else if (k === 'failed') s.failed++
    else if (k === 'cancelled') s.cancelled++
  }
  return s
}

function TaskCard({ task, onOpen, onLive }: { task: CoderTask; onOpen: () => void; onLive: () => void }) {
  const st = STATUS_META[stateOf(task)] ?? DEFAULT_META
  const fromName = agentName(task.from)
  const icon = AGENT_ICON[fromName] ?? '🤖'
  const updated = task.updated_at && task.updated_at !== task.created_at ? ` → ${fmtDT(task.updated_at)}` : ''
  const u = task.usage
  const hasUsage = !!u && (u.input_tokens != null || u.output_tokens != null || u.cache_tokens != null || u.cost != null)
  const live = task.status === 'running' || task.status === 'queued'
  return (
    <div className={css.taskItem} data-task-id={task.id}>
      <div className={css.taskTop}>
        <span className={css.taskId}>{task.id}</span>
        <span className={clsx(css.badge, st.pill)}><span className={css.dot} />{st.label}</span>
        <span className={css.execBadge}>{task.profile || '未知'}</span>
        {task.priority ? <span className={css.tag}>{task.priority}</span> : null}
        {task.type ? <span className={css.tag}>{task.type}</span> : null}
      </div>
      <div className={css.taskMeta}>
        <span className={css.taskAgent} title={`投递人: ${task.from ?? ''}`}>{icon} {fromName}</span>
        {task.project ? <span className={css.taskProject}>{task.project}</span> : null}
        <span className={css.taskTime}>{fmtDT(task.created_at)}{updated}</span>
      </div>
      {task.summary ? (
        <div className={css.taskPrompt} onClick={onOpen}><span>{task.summary}</span><span className={css.taskMore}>查看完整 ▸</span></div>
      ) : null}
      {hasUsage ? (
        <div className={css.taskUsage}>
          <span>📥 输入 {fmtTokens(u.input_tokens)}</span><span>·</span>
          <span>📤 输出 {fmtTokens(u.output_tokens)}</span><span>·</span>
          <span>💾 缓存 {fmtTokens(u.cache_tokens)}</span><span>·</span>
          <span>💰 {fmtCost(u.cost)}</span>
        </div>
      ) : null}
      {task.status === 'done' || task.status === 'failed'
        ? (
          <>
            {task.output ? <div className={css.taskOutput}>{task.output}</div> : null}
            {task.status === 'failed' && task.error ? <div className={css.taskError}>⚠ {task.error}</div> : null}
          </>
        )
        : null}
      <button type="button" className={clsx(css.liveButton, live ? css.liveButtonLive : null)} onClick={onLive}>
        {live ? <span className={css.livePulse} /> : null}{live ? '▶ 实时输出' : '📄 执行日志'}
      </button>
    </div>
  )
}

function TaskDetailModal({ task, onClose }: { task: CoderTask; onClose: () => void }) {
  const st = STATUS_META[stateOf(task)] ?? DEFAULT_META
  const fromName = agentName(task.from)
  const icon = AGENT_ICON[fromName] ?? '🤖'
  const profile = task.profile || '未知'
  const meta = [
    ['状态', st.label], ['执行者', profile],
    ['投递人', `${icon} ${fromName}`], ['from', task.from],
    ['项目', task.project], ['优先级', task.priority], ['类型', task.type],
    ['创建', fmtFull(task.created_at)], ['开始', fmtFull(task.started_at)], ['完成', fmtFull(task.finished_at)],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '')
  return (
    <div className={css.modal} role="dialog" aria-modal="true" aria-label="任务详情">
      <div className={css.modalBackdrop} onClick={onClose} />
      <div className={css.modalPanel}>
        <div className={css.modalHead}>
          <span className={css.modalId}>{task.id}</span>
          <button type="button" className={css.modalClose} aria-label="关闭" onClick={onClose}>✕</button>
        </div>
        <div className={css.modalBody}>
          <div className={css.modalMeta}>
            {meta.map(([k, v]) => (
              <div className={css.modalMetaRow} key={k}>
                <span className={css.modalMetaLabel}>{k}</span>
                <span className={css.modalMetaValue}>{v}</span>
              </div>
            ))}
          </div>
          <div className={css.modalSection}>
            <div className={css.modalSectionTitle}>完整提示词</div>
            <pre className={css.modalPre}>{task.prompt_full || task.prompt || '（无提示词）'}</pre>
          </div>
          {task.status === 'done' || task.status === 'failed'
            ? (
              <>
                {task.output ? (
                  <div className={css.modalSection}>
                    <div className={css.modalSectionTitle}>输出</div>
                    <pre className={css.modalPre}>{task.output}</pre>
                  </div>
                ) : null}
                {task.status === 'failed' && task.error ? (
                  <div className={css.modalSection}>
                    <div className={css.modalSectionTitle}>错误</div>
                    <pre className={clsx(css.modalPre, css.modalPreError)}>{task.error}</pre>
                  </div>
                ) : null}
              </>
            )
            : null}
        </div>
      </div>
    </div>
  )
}

function colorizeLog(content: string): string {
  const lines = content.split('\n')
  const out: string[] = []
  for (const raw of lines) {
    const m = /^(\[[0-9:.]+\])\s?/.exec(raw)
    const time = m ? `<span class="${css.logTime}">${m[1]}</span> ` : ''
    const body = m ? raw.slice(m[0].length) : raw
    let cls = css.logDefault
    if (/^⏳|仍在执行|心跳|heartbeat/i.test(body)) cls = css.logHeartbeat
    else if (/^💭|思考/.test(body)) cls = css.logThink
    else if (/^🔧|工具|tool/i.test(body)) cls = css.logTool
    else if (/^📦|结果|result/i.test(body)) cls = css.logResult
    else if (/^💬|回答|回复/.test(body)) cls = css.logMsg
    else if (/❌|✗|ERROR|Traceback|Exception|失败|错误/.test(body)) cls = css.logError
    out.push(`<div class="${cls}">${time}${escapeHtml(body)}</div>`)
  }
  return out.join('')
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return String(value).replace(/[&<>"']/g, c => map[c] ?? c)
}

/**
 * CoderBoard — the real task board. Polls /dashboard/api/tasks every 30 s,
 * renders KPI filters, status groups, task cards, details, and live logs.
 */
export function CoderBoard() {
  const [tasks, setTasks] = useState<readonly CoderTask[]>([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [refreshAt, setRefreshAt] = useState<string>('--:--:--')
  const [filter, setFilter] = useState<string | null>(null)
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({ running: true })
  const [detailId, setDetailId] = useState<string | null>(null)
  const [liveTask, setLiveTask] = useState<CoderTask | null>(null)
  const [liveLog, setLiveLog] = useState<CoderLiveLog>({})
  const [livePaused, setLivePaused] = useState(false)
  const liveTaskRef = useRef<CoderTask | null>(null)
  liveTaskRef.current = liveTask

  const load = useCallback(() => {
    fetch('/dashboard/api/tasks', { cache: 'no-store' })
      .then(r => r.json())
      .then((payload: { tasks?: CoderTask[] }) => {
        const list = payload.tasks ?? []
        setTasks(list.map(t => ({ ...t, id: t.id ?? t.task_id ?? String(Math.random()) })))
        setConnected(true)
        setLoading(false)
        setRefreshAt(clock())
      })
      .catch(() => {
        setConnected(false)
        setLoading(false)
        setRefreshAt(clock())
      })
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  // 实时输出轮询
  useEffect(() => {
    if (!liveTask) return
    let cancelled = false
    const fetchLog = () => {
      fetch(`/dashboard/api/task/live?id=${encodeURIComponent(liveTaskRef.current?.id ?? '')}`, { cache: 'no-store' })
        .then(r => r.json())
        .then((payload: CoderLiveLog) => { if (!cancelled) setLiveLog(payload) })
        .catch(() => { /* 瞬时失败保留上次内容 */ })
    }
    fetchLog()
    if (livePaused) return
    const timer = setInterval(fetchLog, LIVE_POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [liveTask, livePaused])

  useEffect(() => {
    if (!liveTask) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLiveTask(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [liveTask])

  const stats = useMemo(() => computeStats(tasks), [tasks])
  const visibleTasks = useMemo(() => {
    if (!filter || filter === 'all') return tasks
    return tasks.filter(t => stateOf(t) === filter)
  }, [tasks, filter])

  const toggleGroup = (key: string) => {
    setFilter(null)
    setOpenKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }
  const applyFilter = (key: string) => {
    setFilter(key)
    const next: Record<string, boolean> = {}
    for (const g of GROUPS) next[g.key] = key === 'all' || g.key === key
    setOpenKeys(next)
  }

  const activeLive = liveTask ? STATUS_META[stateOf(liveTask)] ?? DEFAULT_META : null
  const liveContent = liveTask
    ? (liveLog.exists
      ? colorizeLog(liveLog.content ?? '')
      : (liveTask.status === 'running' || liveTask.status === 'queued'
        ? '<div class="' + css.logHeartbeat + '">（实时日志尚未生成，等待 dsh 输出…）</div>'
        : '<div class="' + css.logHeartbeat + '">（该任务没有保留执行日志）</div>'))
    : ''
  const liveUsage = liveLog.usage
  const liveHasUsage = !!liveUsage
    && (liveUsage.input_tokens != null || liveUsage.output_tokens != null || liveUsage.cache_tokens != null || liveUsage.cost != null)

  const detailTask = detailId ? tasks.find(t => t.id === detailId) ?? null : null

  return (
    <div className={css.board}>
      <div className={css.pageHead}>
        <div>
          <h1 className={css.pageTitle}>任务看板</h1>
          <p className={css.pageDesc}>全部 dsh 任务 · H:/DSHAgent/bridge · 每 30 秒自动刷新</p>
        </div>
        <div className={css.rangeRow}>
          <span className={clsx(css.badge, connected ? (css.pillUp ?? '') : (css.pillDown ?? ''))}>
            <span className={css.dot} />{connected ? '已连接' : '连接失败'}
          </span>
          <span className={css.refresh}>最后刷新 {refreshAt}</span>
          <button type="button" className={css.refreshBtn} onClick={load}>刷新</button>
        </div>
      </div>

      <div className={css.kpis}>
        {FILTERS.map((f) => {
          const on = filter === f.key
          const value = f.key === 'all' ? stats.total : (stats[f.key as keyof typeof stats] ?? 0)
          return (
            <button key={f.key} type="button" className={clsx(css.kpi, on ? css.kpiActive : null)} data-filter={f.key} aria-pressed={on} onClick={() => applyFilter(f.key)}>
              <div className={css.kpiLabel}><span className={css.kpiDot} style={{ background: f.color }} /><span>{f.label}</span></div>
              <div className={css.kpiValue} style={{ color: f.color }}>{value}</div>
              <div className={css.kpiHint}>{f.key === 'all' ? (on ? '已全部展开' : '全部展开') : (on ? '已聚焦' : '点击聚焦')}</div>
            </button>
          )
        })}
      </div>

      {!loading && visibleTasks.length === 0 && filter !== null && (
        <p className={css.empty}>当前筛选下没有任务</p>
      )}

      <div className={css.groups}>
        {GROUPS.map((g) => {
          const groupTasks = filter && filter !== 'all' ? visibleTasks.filter(t => stateOf(t) === g.key) : tasks.filter(t => stateOf(t) === g.key)
          const open = !!openKeys[g.key]
          const st = STATUS_META[g.key] ?? DEFAULT_META
          let shown = groupTasks
          let moreNote: string | null = null
          if (g.key === 'done' && groupTasks.length > 10) {
            shown = groupTasks.slice(0, 10)
            moreNote = `仅显示最近 10 条（共 ${groupTasks.length} 条）`
          }
          return (
            <div key={g.key} className={clsx(css.group, open ? css.groupOpen : null)}>
              <button type="button" className={css.groupHead} data-group={g.key} aria-expanded={open} onClick={() => toggleGroup(g.key)}>
                <span className={css.groupArrow} aria-hidden="true">▸</span>
                <span className={clsx(css.statusDot, st.dot)} />
                <span className={css.groupName}>{g.title}</span>
                <span className={clsx(css.badge, st.pill, css.groupCount)}>{groupTasks.length}</span>
              </button>
              {open && (
                <div className={css.groupBody}>
                  {shown.length === 0
                    ? <div className={css.empty}>{g.empty}</div>
                    : (
                      <>
                        <div className={css.taskList}>
                          {shown.map(t => (
                            <TaskCard
                              key={t.id}
                              task={t}
                              onOpen={() => setDetailId(t.id)}
                              onLive={() => { setLiveLog({}); setLivePaused(false); setLiveTask(t) }}
                            />
                          ))}
                        </div>
                        {moreNote ? <div className={css.moreNote}>{moreNote}</div> : null}
                      </>
                    )
                  }
                </div>
              )}
            </div>
          )
        })}
      </div>

      {detailTask && <TaskDetailModal task={detailTask} onClose={() => setDetailId(null)} />}

      {liveTask && (
        <div className={clsx(css.modal, css.liveModal)}>
          <div className={css.modalBackdrop} onClick={() => setLiveTask(null)} />
          <div className={clsx(css.modalPanel, css.livePanel)}>
            <div className={css.modalHead}>
              <div className={css.liveHead}>
                {activeLive && (
                  <span className={clsx(css.badge, activeLive.pill)}><span className={css.dot} />{activeLive.label}</span>
                )}
                <span className={css.execBadge}>{liveTask.profile || '未知'}</span>
                <span className={css.modalId}>{liveTask.id}</span>
              </div>
              <div className={css.liveHeadRight}>
                <span className={css.liveHint}>每 {LIVE_POLL_MS / 1000} 秒自动刷新</span>
                <button type="button" className={css.liveButtonSmall} onClick={() => setLivePaused(p => !p)}>{livePaused ? '继续' : '暂停'}</button>
                <button type="button" className={css.modalClose} aria-label="关闭" onClick={() => setLiveTask(null)}>✕</button>
              </div>
            </div>
            {liveHasUsage ? (
              <div className={css.liveUsage}>
                <span>📥 输入 {fmtTokens(liveUsage.input_tokens)}</span><span>·</span>
                <span>📤 输出 {fmtTokens(liveUsage.output_tokens)}</span><span>·</span>
                <span>💾 缓存 {fmtTokens(liveUsage.cache_tokens)}</span><span>·</span>
                <span>💰 {fmtCost(liveUsage.cost)}</span>
              </div>
            ) : null}
            <div className={css.liveBody}>
              <div className={css.liveContent} dangerouslySetInnerHTML={{ __html: liveContent }} />
            </div>
            <div className={css.liveFoot}>
              <span>
                {liveLog.exists
                  ? `日志 ${liveLog.size != null ? `${(liveLog.size / 1024).toFixed(1)} KB` : '0 B'}${liveLog.truncated ? ' · 仅显示尾部' : ''} · 更新于 ${clock()}`
                  : '暂无日志文件 · 更新于 ' + clock()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function clock(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
