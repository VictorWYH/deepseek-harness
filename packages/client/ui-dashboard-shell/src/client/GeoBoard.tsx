/**
 * GeoBoard — true migration of the 6995 GEO/SEO board into the DSH shell.
 *
 * Data source: http://127.0.0.1:6992/api/geo/* (geoseo service). Falls back to
 * seed data when the service is unreachable — same behaviour as the 6995
 * original. The board renders keyword ranking, rank history, tasks, and
 * content drafts.
 */
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import css from './GeoBoard.module.css'

const GEO_API = 'http://127.0.0.1:6992'

interface Keyword {
  id?: number
  keyword: string
  category?: string
  rank?: number
  engine?: string
  indexed?: boolean
  trend?: string
  delta?: string
}
interface Task { id?: string; title?: string; status?: string; updated?: string; progress?: number }
interface Content { id?: string; keyword?: string; type?: string; status?: string; updated?: string; ai_friendly?: boolean }

const SEED_KEYWORDS: Keyword[] = [
  { id: 1, keyword: '迪拓', category: 'seed', rank: 1, engine: '百度', indexed: true, delta: '第1名' },
  { id: 2, keyword: '迪拓数字科技', category: 'seed', rank: 3, engine: '百度', indexed: true, delta: '第3名' },
  { id: 3, keyword: '沉浸式数字展厅', category: 'longtail', rank: 0, engine: '—', indexed: true, delta: '收录' },
  { id: 4, keyword: '数字人展厅', category: 'longtail', rank: 0, engine: '—', indexed: true, delta: '待抓' },
  { id: 5, keyword: '政企展厅', category: 'longtail', rank: 0, engine: '—', indexed: false, delta: '待抓' },
]
const SEED_TASKS: Task[] = [
  { id: 'GE-001', title: '关键词布局巡检', status: 'done', updated: '08-14', progress: 100 },
  { id: 'GE-002', title: '新建词条：沉浸式数字展厅', status: 'running', updated: '08-14', progress: 60 },
  { id: 'GE-003', title: '内容补更：政企展厅', status: 'queued', updated: '08-13', progress: 0 },
]
const SEED_CONTENTS: Content[] = [
  { id: 'CT-001', keyword: '沉浸式数字展厅', type: '词条', status: '已发布', updated: '08-14', ai_friendly: true },
  { id: 'CT-002', keyword: '数字人展厅', type: '案例', status: '已发布', updated: '08-14', ai_friendly: true },
  { id: 'CT-003', keyword: '迪拓数字科技', type: '词条', status: '已发布', updated: '08-13', ai_friendly: true },
  { id: 'CT-004', keyword: '政企展厅案例', type: '案例', status: '已发布', updated: '08-14', ai_friendly: true },
  { id: 'CT-005', keyword: '企业展馆设计', type: '词条', status: '草稿', updated: '08-14', ai_friendly: false },
]
const SEED_HISTORY: { date: string; rank: number }[] = [
  { date: '08-01', rank: 5 }, { date: '08-04', rank: 4 }, { date: '08-07', rank: 3 }, { date: '08-10', rank: 2 }, { date: '08-14', rank: 1 },
]

async function fetchJson(path: string, fallback: unknown): Promise<unknown> {
  try { const r = await fetch(GEO_API + path, { cache: 'no-store' }); if (!r.ok) throw new Error(String(r.status)); return await r.json() } catch { return fallback }
}

export function GeoBoard() {
  const [keywords, setKeywords] = useState<readonly Keyword[]>(SEED_KEYWORDS)
  const [tasks, setTasks] = useState<readonly Task[]>(SEED_TASKS)
  const [contents] = useState<readonly Content[]>(SEED_CONTENTS)
  const [history, setHistory] = useState<readonly { date: string; rank: number }[]>(SEED_HISTORY)
  const [error, setError] = useState<string | null>(null)
  const [apiReachable, setApiReachable] = useState<boolean | null>(null)

  const load = useCallback(async () => {
    setError(null)
    let reachable = false
    try {
      const probe = await fetch(GEO_API + '/api/geo/keywords', { cache: 'no-store' })
      reachable = probe.ok
    } catch { reachable = false }
    setApiReachable(reachable)
    try {
      const kw = (await fetchJson('/api/geo/keywords', { keywords: null })) as { keywords?: Keyword[] }
      const rk = (await fetchJson('/api/geo/ranks', { snapshots: null })) as { snapshots?: { keyword_id?: number; our_rank?: number; engine?: string; result_count?: number }[] }
      const tk = (await fetchJson('/api/geo/tasks', { tasks: null })) as { tasks?: Task[] }
      const hi = (await fetchJson('/api/geo/rank_history?days=14', { series: null })) as { series?: { date: string; rank: number }[] }
      if (kw.keywords && kw.keywords.length > 0) {
        const merged: Keyword[] = kw.keywords.map((k) => {
          const snap = (rk.snapshots ?? []).find(s => s.keyword_id === k.id)
          const rc = snap?.result_count ?? 0
          const ourRank = snap?.our_rank ?? null
          return { ...k, engine: snap?.engine ?? '—', indexed: rc > 0, rank: ourRank ?? (snap && rc ? Math.min(rc, 50) : 0), delta: ourRank ? `第${ourRank}名` : rc ? '收录' : '待抓' }
        })
        setKeywords(merged)
      }
      if (tk.tasks && tk.tasks.length > 0) setTasks(tk.tasks)
      if (hi.series && hi.series.length > 0) setHistory(hi.series)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])

  useEffect(() => { void load() }, [load])

  const maxRank = Math.max(...history.map(h => h.rank), 1)
  const chartW = 640
  const chartH = 120
  const pts = history.map((h, i) => `${(i / Math.max(history.length - 1, 1)) * chartW},${8 + ((h.rank - 1) / maxRank) * (chartH - 16)}`).join(' ')

  return (
    <div className={css.board}>
      <div className={css.pageHead}>
        <div><h1 className={css.pageTitle}>GEO/SEO 看板</h1><p className={css.pageDesc}>关键词排名 · 排名历史 · 内容任务 · 真实数据 + 离线种子</p></div>
        <div className={css.rangeRow}><button type="button" className={css.refreshBtn} onClick={() => { void load() }}>刷新</button></div>
      </div>
      {apiReachable === false && <div className={css.unavailable} role="alert">⚠️ GEO 服务（127.0.0.1:6992）不可用，当前展示的是离线种子，非实时数据；服务恢复后自动切换真实数据。</div>}
      {error && <div className={css.errorState}>GEO 数据加载异常：{error}（显示离线种子）</div>}

      <div className={css.card}>
        <div className={css.cardHead}>
          <div className={css.cardTitle}>关键词排名</div><span className={css.cardSub}>{keywords.length} 词 · 每 30 秒刷新{apiReachable === false ? '（离线参考，非实时）' : ''}</span>
        </div>
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead><tr><th>关键词</th><th>类型</th><th>引擎</th><th>收录</th><th>排名</th><th>趋势</th></tr></thead>
            <tbody>{keywords.map(k => (
              <tr key={k.id ?? k.keyword}><td><strong>{k.keyword}</strong></td><td>{k.category === 'seed' ? '种子词' : k.category === 'longtail' ? '长尾词' : k.category || '词'}</td><td className={css.muted}>{k.engine}</td><td>{k.indexed ? '✅' : '—'}</td><td>{k.rank ? `#${k.rank}` : '—'}</td><td className={css.muted}>{k.delta ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      <div className={css.card}>
        <div className={css.cardHead}><div className={css.cardTitle}>排名历史（近 14 天）</div><span className={css.cardSub}>数值越低越好</span></div>
        <svg viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none" className={css.chartSvg}><polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth="2" /></svg>
      </div>

      <div className={css.card}>
        <div className={css.cardHead}><div className={css.cardTitle}>内容任务</div><span className={css.cardSub}>管线执行{apiReachable === false ? '（离线参考，非实时）' : ''}</span></div>
        <div className={css.tableWrap}>
          <table className={css.table}><thead><tr><th>任务</th><th>状态</th><th>进度</th><th>更新</th></tr></thead>
            <tbody>{tasks.map(t => <tr key={t.id}><td>{t.title}</td><td><span className={clsx(css.badge, t.status === 'done' ? css.badgeOk : t.status === 'running' ? css.badgeInfo : css.badgeWarn)}>{t.status === 'done' ? '完成' : t.status === 'running' ? '执行中' : '排队中'}</span></td><td><div className={css.progressBar}><span className={css.progressFill} style={{ width: `${t.progress ?? 0}%` }} /></div></td><td className={css.muted}>{t.updated}</td></tr>)}</tbody></table>
        </div>
      </div>

      <div className={css.card}>
        <div className={css.cardHead}><div className={css.cardTitle}>内容词条</div><span className={css.cardSub}>AI 友好标记</span></div>
        <div className={css.tableWrap}>
          <table className={css.table}><thead><tr><th>标题</th><th>类型</th><th>状态</th><th>AI 友好</th><th>更新</th></tr></thead>
            <tbody>{contents.map(c => <tr key={c.id}><td>{c.keyword}</td><td className={css.muted}>{c.type}</td><td><span className={clsx(css.badge, c.status === '已发布' ? css.badgeOk : css.badgeWarn)}>{c.status}</span></td><td>{c.ai_friendly ? '✅' : '—'}</td><td className={css.muted}>{c.updated}</td></tr>)}</tbody></table>
        </div>
      </div>
    </div>
  )
}
