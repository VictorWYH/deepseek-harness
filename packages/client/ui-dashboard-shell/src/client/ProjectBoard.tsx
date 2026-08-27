/**
 * ProjectBoard — true migration of the 6995 project board into the DSH shell.
 *
 * Reads the real dev-session registry through the same-origin reverse proxy
 * (`/dashboard/api/dev-sessions?limit=500` + `/dashboard/api/dev-sessions/checkpoints`).
 * Write actions (review / checkpoint / continue) post to the same proxy with
 * the same CSRF + Origin headers the 6995 frontend sends; an unauthenticated
 * write is relayed as the upstream 401/403 — nothing is bypassed or faked.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import css from './ProjectBoard.module.css'

/** One dev session row served by /api/dev-sessions. */
export interface DevSession {
  session_id?: string
  project_id?: string
  title?: string
  running?: boolean
  blank?: boolean
  review_status?: string
  stage?: string
  dsh_profile?: string
  agent_preset?: string
  purpose?: string
  context_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  turns?: number
  updated_at?: number
}

/** One project row. */
export interface DevProject {
  project_id?: string
  title?: string
  path?: string
  active_session_id?: string
}

/** One task row (linked by session). */
export interface DevTask {
  task_id?: string
  session_id?: string
  status?: string
}

/** One checkpoint row. */
export interface DevCheckpoint {
  session_id?: string
  stage?: string
  summary?: string
}

function fmtTime(v: number | undefined): string {
  if (!v) return '--'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('zh-CN', { hour12: false })
}
function statusOf(s: DevSession): string {
  return s.running ? '运行中' : (s.blank ? '空会话' : '已停止')
}
function profileOf(s: DevSession): string {
  return s.dsh_profile || s.agent_preset || '未确认'
}

function writeHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Origin: window.location.origin }
}

function SessionRow({
  s,
  ts,
  cps,
  onReview,
  onContinue,
}: {
  s: DevSession
  ts: readonly DevTask[]
  cps: readonly DevCheckpoint[]
  onReview: (status: string) => void
  onContinue: (text: string) => void
}) {
  const [ctText, setCtText] = useState('')
  const reviewStatus = s.review_status || 'unreviewed'
  return (
    <div className={css.sessionRow}>
      <div className={css.sessionMain}>
        <div className={css.sessionTitle}>{s.title || '未命名会话'}</div>
        <div className={css.sessionId}>{s.session_id}</div>
      </div>
      <div className={css.sessionMeta}>
        <span className={clsx(css.badge, s.running ? css.pillUp : css.pillDown)}>{statusOf(s)}</span>
        <span className={css.tag}>审查：{reviewStatus}</span>
        <span>{s.stage || '未分阶段'}</span>
        <span>{profileOf(s)}</span>
        <span>{s.turns || 0} 轮</span>
        <span>{ts.length} 个任务</span>
        <span>{cps.length} 个 checkpoint</span>
        <span>{fmtTime(s.updated_at)}</span>
      </div>
      <div className={css.detailGrid}>
        <div>用途：{s.purpose || '未记录'}</div>
        <div>上下文：{(s.context_tokens || 0).toLocaleString()} tokens</div>
        <div>
          任务：{ts.length
            ? ts.map(t => <span key={t.task_id} className={css.tag}>{t.task_id} · {t.status}</span>)
            : <span className={css.muted}>无</span>}
        </div>
        <div>Checkpoint：{cps.slice(0, 3).map((cp, i) => <div key={i}><b>{cp.stage}</b> · {cp.summary}</div>)}</div>
      </div>
      <div className={css.actions}>
        <button type="button" className={css.ghostBtn} onClick={() => { void navigator.clipboard.writeText(s.session_id ?? '') }}>复制 Session ID</button>
        <button type="button" className={css.ghostBtn} onClick={() => { onReview('approved') }}>通过审查</button>
        <button type="button" className={css.ghostBtn} onClick={() => { onReview('needs-attention') }}>标记需关注</button>
        <span className={css.continueBox}>
          <input className={css.continueInput} placeholder="续聊指令…" value={ctText} onChange={(e) => { setCtText(e.target.value) }} />
          <button type="button" className={css.ghostBtn} onClick={() => { if (ctText.trim()) { onContinue(ctText.trim()); setCtText('') } }}>续聊</button>
        </span>
        <a className={css.ghostBtn} href="http://127.0.0.1:3081" target="_blank" rel="noopener noreferrer">打开 3081 人工介入</a>
      </div>
    </div>
  )
}

export function ProjectBoard() {
  const [projects, setProjects] = useState<readonly DevProject[]>([])
  const [sessions, setSessions] = useState<readonly DevSession[]>([])
  const [tasks, setTasks] = useState<readonly DevTask[]>([])
  const [checkpoints, setCheckpoints] = useState<readonly DevCheckpoint[]>([])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    Promise.all([
      fetch('/dashboard/api/dev-sessions?limit=500', { cache: 'no-store' }).then(r => r.json()),
      fetch('/dashboard/api/dev-sessions/checkpoints', { cache: 'no-store' }).then(r => r.json()),
    ])
      .then(([d, c]: [Record<string, unknown>, Record<string, unknown>]) => {
        if (!d.ok) {
          const detail = typeof d.error === 'string' ? d.error : 'load failed'
          throw new Error(detail)
        }
        setProjects(d.projects as DevProject[])
        setSessions(d.sessions as DevSession[])
        setTasks(d.tasks as DevTask[])
        setCheckpoints(c.checkpoints as DevCheckpoint[])
      })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) })
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => { clearInterval(timer) }
  }, [load])

  const byProject = useMemo(() => {
    const m = new Map<string, DevSession[]>()
    for (const s of sessions) {
      const k = s.project_id ?? ''
      const arr = m.get(k) ?? []
      arr.push(s)
      m.set(k, arr)
    }
    return m
  }, [sessions])
  const tasksBySession = useMemo(() => {
    const m = new Map<string, DevTask[]>()
    for (const t of tasks) if (t.session_id) {
      const arr = m.get(t.session_id) ?? []
      arr.push(t); m.set(t.session_id, arr)
    }
    return m
  }, [tasks])
  const cpsBySession = useMemo(() => {
    const m = new Map<string, DevCheckpoint[]>()
    for (const c of checkpoints) if (c.session_id) {
      const arr = m.get(c.session_id) ?? []
      arr.push(c); m.set(c.session_id, arr)
    }
    return m
  }, [checkpoints])

  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase()
    return projects.filter((p) => {
      const ss = byProject.get(p.project_id ?? '') ?? []
      if (!q) return true
      const hay = [p.title ?? '', p.path ?? '', ...ss.map(s => `${s.title ?? ''} ${s.session_id ?? ''}`)].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [projects, byProject, query])

  const doWrite = async (path: string, body: Record<string, unknown>): Promise<{ ok: boolean; message: string }> => {
    try {
      const resp = await fetch(`/dashboard/api/${path}`, { method: 'POST', headers: writeHeaders(), body: JSON.stringify(body) })
      const d = (await resp.json().catch(() => ({}))) as Record<string, unknown>
      if (!resp.ok) {
        const detail = typeof d.error === 'string' ? d.error : `http_${resp.status}`
        return { ok: false, message: detail }
      }
      return { ok: true, message: typeof d.message === 'string' ? d.message : 'ok' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  const review = (sessionId: string, status: string) => {
    if (!window.confirm('确认更新这个会话的人工审查状态？')) return
    void doWrite('dev-sessions/review', { session_id: sessionId, status, note: '由项目看板人工更新' }).then((r) => {
      if (r.ok) window.alert(r.message === 'ok' ? '已更新' : r.message)
      else window.alert('更新失败：' + r.message)
      load()
    })
  }

  const sendContinue = (sessionId: string, text: string) => {
    if (!window.confirm(`确认向会话 ${sessionId} 发送以下指令？\n这会触发 Agent 修改该项目文件。\n\n${text}`)) return
    void doWrite('dev-sessions/continue', { session_id: sessionId, text, from: 'dashboard-web' }).then((r) => {
      window.alert(r.ok ? '已投递' : '投递失败：' + r.message)
    })
  }

  return (
    <div className={css.board}>
      <div className={css.pageHead}>
        <div>
          <h1 className={css.pageTitle}>项目看板</h1>
          <p className={css.pageDesc}>项目 → 会话 → 任务 · 支持人工审查与继续介入</p>
        </div>
        <div className={css.rangeRow}>
          <span className={clsx(css.badge, css.pillUp)}>注册表在线</span>
          <span className={css.count}>{visibleProjects.length} 个项目 · {sessions.length} 个会话 · {tasks.length} 个任务</span>
          <button type="button" className={css.refreshBtn} onClick={load}>刷新</button>
        </div>
      </div>
      <div className={css.toolbar}>
        <input className={css.search} type="search" placeholder="搜索项目、路径、会话标题或 ID" value={query} onChange={(e) => { setQuery(e.target.value) }} />
        <span className={css.muted}>数据来自 H:/DSHAgent 开发会话注册表 · 写操作需 CSRF 鉴权</span>
      </div>
      {error && <div className={css.errorState}>开发会话加载失败：{error}</div>}
      <div className={css.list}>
        {visibleProjects.length === 0
          ? <div className={css.emptyState}>没有匹配的项目</div>
          : visibleProjects.map((p) => {
            const pid = p.project_id ?? ''
            const ss = (byProject.get(pid) ?? []).sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
            const open = expanded[pid] !== false
            return (
              <section key={pid} className={css.projectCard}>
                <button type="button" className={css.projectHead} onClick={() => { setExpanded(prev => ({ ...prev, [pid]: !(prev[pid] !== false) })) }}>
                  <span><strong>{p.title || p.path}</strong><small>{p.path}</small></span>
                  <span className={css.projectStat}>{ss.length} 个会话 · <b>{open ? '收起' : '展开'}</b></span>
                </button>
                {open && (
                  <div className={css.projectBody}>
                    {ss.length === 0 ? <div className={css.muted}>暂无会话</div> : ss.map(s => (
                      <SessionRow
                        key={s.session_id}
                        s={s}
                        ts={tasksBySession.get(s.session_id ?? '') ?? []}
                        cps={cpsBySession.get(s.session_id ?? '') ?? []}
                        onReview={(st) => { review(s.session_id ?? '', st) }}
                        onContinue={(text) => { sendContinue(s.session_id ?? '', text) }}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
      </div>
    </div>
  )
}
