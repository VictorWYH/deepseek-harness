/**
 * BtenderBoard — true migration of the 6995 商机雷达 (btender) board into the
 * DSH shell.
 *
 * Data flows through the same-origin reverse proxy (`/dashboard/api/tender/v1/*`)
 * to the real 6995 backend (`/api/tender/v1/*`, which reads tender.db / proxies
 * 6940). Reads are public; shortlist writes post to the same proxy. Nothing is
 * faked, sampled, or permission-bypassing.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import css from './BtenderBoard.module.css'

const API = '/dashboard/api/tender/v1'
const PAGE_SIZE = 20

/** One tender project row. */
export interface TenderProject {
  id?: number
  source_name?: string
  title?: string
  url?: string
  region?: string
  industry?: string
  group_id?: number
  announce_date?: string
  created_at?: string
  deadline?: string
  bid_time?: string
  keywords?: string
  detail?: string
  shortlisted?: boolean
}

interface Stats {
  projects?: number
  todayNew?: number
  ditou?: number
  industrial?: number
  sources?: number
  sources_enabled?: number
  lastCrawlDate?: string
  keywords?: number
  remote?: number
}

function fmtDate(s: string | undefined): string {
  return (s ?? '').slice(0, 10)
}
function esc(v: unknown): string {
  const s = typeof v === 'string' ? v : String(v)
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return s.replace(/[&<>"']/g, c => map[c] ?? c)
}

function groupOf(p: TenderProject): { label: string; color: string } {
  if (p.group_id === 1 || p.group_id === 2) return { label: '迪拓组', color: '#38bdf8' }
  if (p.group_id === 3) return { label: '工业组', color: '#f59e0b' }
  return { label: '未分组', color: '#64748b' }
}

export function BtenderBoard() {
  const [stats, setStats] = useState<Stats>({})
  const [items, setItems] = useState<readonly TenderProject[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<TenderProject | null>(null)
  const [shortlistOnly, setShortlistOnly] = useState(false)

  const loadStats = useCallback(() => {
    fetch(`${API}/stats`, { cache: 'no-store' })
      .then(r => r.json())
      .then((d) => { setStats(d as Stats) })
      .catch(() => { /* keep last */ })
  }, [])

  const loadProjects = useCallback((query: string, onlyShortlist: boolean) => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), order: 'announce_date,desc' })
    if (onlyShortlist) params.set('shortlist', '1')
    const url = query.trim()
      ? `${API}/search?limit=${PAGE_SIZE}&q=${encodeURIComponent(query.trim())}`
      : `${API}/projects?${params.toString()}`
    fetch(url, { cache: 'no-store' })
      .then(r => r.json())
      .then((d) => {
        const payload = d as { items?: TenderProject[]; total?: number }
        setItems(payload.items ?? [])
        setTotal(payload.total ?? 0)
        setLoading(false)
      })
      .catch(() => { setError('加载失败'); setLoading(false) })
  }, [])

  useEffect(() => {
    loadStats()
    loadProjects('', false)
  }, [loadStats, loadProjects])

  const toggleShortlist = (p: TenderProject) => {
    const id = p.id
    if (!id) return
    const method = p.shortlisted ? 'DELETE' : 'POST'
    fetch(`${API}/shortlist`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: id }) })
      .then(() => { loadProjects(q, shortlistOnly) })
      .catch(() => { /* keep */ })
  }

  const statsCards = useMemo(() => [
    { label: '商机总数', value: stats.projects ?? 0, color: '#38bdf8' },
    { label: '今日新增', value: stats.todayNew ?? 0, color: '#22c55e' },
    { label: '迪拓组', value: stats.ditou ?? 0, color: '#38bdf8' },
    { label: '工业组', value: stats.industrial ?? 0, color: '#f59e0b' },
    { label: '数据源', value: `${stats.sources_enabled ?? 0}/${stats.sources ?? 0}`, color: '#a78bfa' },
    { label: '关键词', value: stats.keywords ?? 0, color: '#64748b' },
  ], [stats])

  return (
    <div className={css.board}>
      <div className={css.pageHead}>
        <div>
          <h1 className={css.pageTitle}>商机雷达</h1>
          <p className={css.pageDesc}>商机工作台 · 数据来自 Tender 真实系统 · 上次爬取 {stats.lastCrawlDate ?? '—'}</p>
        </div>
        <div className={css.rangeRow}>
          <button type="button" className={css.refreshBtn} onClick={() => { loadStats(); loadProjects(q, shortlistOnly) }}>刷新</button>
        </div>
      </div>

      <div className={css.kpis}>
        {statsCards.map(s => (
          <div key={s.label} className={css.kpi}>
            <div className={css.kpiLabel}>{s.label}</div>
            <div className={css.kpiValue} style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className={css.toolbar}>
        <input className={css.search} type="search" placeholder="搜索标题/详情/关键词…" value={q}
          onChange={(e) => { setQ(e.target.value) }}
          onKeyDown={(e) => { if (e.key === 'Enter') loadProjects(q, shortlistOnly) }} />
        <button type="button" className={clsx(css.filterBtn, shortlistOnly ? css.filterActive : null)} onClick={() => { const nv = !shortlistOnly; setShortlistOnly(nv); loadProjects(q, nv) }}>
          ⭐ 仅看备选库
        </button>
        <span className={css.muted}>{total} 条商机</span>
      </div>

      {error && <div className={css.errorState}>{error}</div>}

      <div className={css.list}>
        {loading && items.length === 0 ? <div className={css.emptyState}>加载中…</div> : null}
        {!loading && items.length === 0 ? <div className={css.emptyState}>暂无商机</div> : null}
        {items.map((p) => {
          const g = groupOf(p)
          return (
            <div key={p.id} className={css.item} onClick={() => { setSelected(p) }}>
              <div className={css.itemTop}>
                <span className={css.itemTitle}>{p.title || '未命名商机'}</span>
                <span className={css.groupBadge} style={{ color: g.color, borderColor: g.color }}>{g.label}</span>
                {p.shortlisted ? <span className={css.shortBadge}>⭐ 已备选</span> : null}
              </div>
              <div className={css.itemMeta}>
                <span className={css.muted}>{p.source_name}</span>
                <span className={css.muted}>{p.region}</span>
                <span className={css.muted}>{p.industry}</span>
                <span className={css.muted}>公告 {fmtDate(p.announce_date)}</span>
                <span className={css.muted}>入库 {fmtDate(p.created_at)}</span>
                {p.deadline ? <span className={css.muted}>截止 {fmtDate(p.deadline)}</span> : null}
              </div>
              <div className={css.itemActions}>
                <button type="button" className={css.ghostBtn} onClick={(e) => { e.stopPropagation(); toggleShortlist(p) }}>
                  {p.shortlisted ? '取消备选' : '⭐ 备选'}
                </button>
                {p.url ? <a className={css.ghostBtn} href={p.url} target="_blank" rel="noopener noreferrer">原文</a> : null}
              </div>
            </div>
          )
        })}
      </div>

      {selected && (
        <div className={css.modal}>
          <div className={css.modalBackdrop} onClick={() => { setSelected(null) }} />
          <div className={css.modalPanel}>
            <div className={css.modalHead}>
              <span className={css.modalTitle}>{selected.title}</span>
              <button type="button" className={css.modalClose} aria-label="关闭" onClick={() => { setSelected(null) }}>✕</button>
            </div>
            <div className={css.modalBody}>
              <div className={css.modalMeta}>
                <div><b>来源：</b>{selected.source_name}</div>
                <div><b>地区：</b>{selected.region}</div>
                <div><b>行业：</b>{selected.industry}</div>
                <div><b>公告日期：</b>{fmtDate(selected.announce_date)}</div>
                <div><b>入库时间：</b>{fmtDate(selected.created_at)}</div>
                <div><b>截止时间：</b>{selected.deadline ? fmtDate(selected.deadline) : '未提供'}</div>
              </div>
              {selected.detail ? <div className={css.detail} dangerouslySetInnerHTML={{ __html: esc(selected.detail) }} /> : null}
              {selected.url ? <a className={css.link} href={selected.url} target="_blank" rel="noopener noreferrer">查看原文 ↗</a> : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
