/**
 * BriefBoard — true migration of the 6995 情报简报 board into the DSH shell.
 *
 * Reads the real brief dataset through the same-origin reverse proxy
 * (`/dashboard/data/brief.json` → 6995 `/assets/data/brief.json`). Renders
 * intelligence directions, per-direction items, collection status, and history.
 */
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import css from './BriefBoard.module.css'

interface BriefItem { title?: string; summary?: string; time?: string; source?: string }
interface Direction { topic_id?: string; name?: string; status?: string; items?: BriefItem[] }
interface CollectionStatus { source?: string; ok?: boolean; count?: number }
interface BriefHistory { date?: string; direction?: string; count?: number }

interface BriefData { updatedAt?: string; directions?: Direction[]; collection_status?: CollectionStatus[]; brief_history?: BriefHistory[] }

export function BriefBoard() {
  const [data, setData] = useState<BriefData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch('/dashboard/data/brief.json', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((d) => { setData(d as BriefData); setLoading(false) })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  const directions = data.directions ?? []
  const todayItems = directions.reduce((n, d) => n + (d.items?.length ?? 0), 0)
  const okSources = (data.collection_status ?? []).filter(s => s.ok).length
  const history = data.brief_history ?? []

  return (
    <div className={css.board}>
      <div className={css.pageHead}>
        <div><h1 className={css.pageTitle}>情报简报</h1><p className={css.pageDesc}>信息方向 · 采集状态 · 简报历史</p></div>
        <div className={css.rangeRow}>
          <span className={css.muted}>更新于 {data.updatedAt ?? '—'}</span>
          <button type="button" className={css.refreshBtn} onClick={load}>刷新</button>
        </div>
      </div>

      {loading ? <div className={css.emptyState}>加载中…</div> : null}
      {error && <div className={css.errorState}>简报加载失败：{error}</div>}

      <div className={css.kpis}>
        <div className={css.kpi}><div className={css.kpiLabel}>信息方向</div><div className={css.kpiValue}>{directions.length}</div></div>
        <div className={css.kpi}><div className={css.kpiLabel}>今日条目</div><div className={css.kpiValue}>{todayItems}</div></div>
        <div className={css.kpi}>
          <div className={css.kpiLabel}>采集源</div><div className={css.kpiValue}>{okSources}/{data.collection_status?.length ?? 0}</div>
        </div>
        <div className={css.kpi}><div className={css.kpiLabel}>历史记录</div><div className={css.kpiValue}>{history.length}</div></div>
      </div>

      <div className={css.grid}>
        {directions.map(d => (
          <div key={d.topic_id ?? d.name} className={css.directionCard}>
            <div className={css.directionHead}>
              <strong className={css.directionName}>{d.name ?? d.topic_id}</strong>
              <span className={clsx(css.badge, d.status === 'ok' ? css.badgeOk : d.status === 'degraded' ? css.badgeWarn : css.badgeErr)}>{d.status ?? 'unknown'}</span>
            </div>
            <div className={css.directionItems}>
              {(d.items ?? []).map((it, i) => (
                <div key={i} className={css.itemRow}>
                  <div className={css.itemTitle}>{it.title}</div>
                  {it.summary ? <div className={css.itemSummary}>{it.summary}</div> : null}
                  {it.time ? <div className={css.itemTime}>{it.time}{it.source ? ` · ${it.source}` : ''}</div> : null}
                </div>
              ))}
              {(d.items ?? []).length === 0 ? <div className={css.muted}>暂无条目</div> : null}
            </div>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <div className={css.card}>
          <div className={css.cardHead}><div className={css.cardTitle}>简报历史</div></div>
          <div className={css.tableWrap}>
            <table className={css.table}><thead><tr><th>日期</th><th>方向</th><th>条目</th></tr></thead>
              <tbody>{history.map((h, i) => <tr key={i}><td>{h.date ?? '—'}</td><td>{h.direction ?? '—'}</td><td>{h.count ?? 0}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
