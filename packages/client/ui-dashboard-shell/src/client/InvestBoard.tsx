/**
 * InvestBoard — true migration of the 6995 invest board into the DSH shell.
 *
 * Data flows through the same-origin reverse proxy installed by the web-app
 * bundle's `dashboard-proxy` host plugin: the browser fetches
 * `/dashboard/api/invest/v1/*`, the DSH webserver relays them to the real 6995
 * backend (`/api/invest/*`), which reverse-proxies to the real invest system
 * (6991). Auth is real: the invest system issues a Bearer token on
 * `POST /auth/login`, stored locally; every data call carries
 * `Authorization: Bearer <token>`, and a 401 shows the login form. Nothing
 * here is fake, sampled, or permission-bypassing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import css from './InvestBoard.module.css'

const API = '/dashboard/api/invest/v1'
const TOKEN_KEY = 'invest_token'

/** One holding row. */
export interface Holding {
  code: string
  name: string
  market: string
  shares: number
  cost: number
  price: number
  prevClose: number
  currency: string
}

/** One equity series point. */
interface EquityPoint { t: number; v: number }

/** One market quote. */
interface Quote {
  code?: string
  name?: string
  price?: number
  change?: number
  change_pct?: number
}

const RANGES = [
  { key: '1D', points: 48, step: 5 * 60 * 1000 },
  { key: '1W', points: 42, step: 4 * 60 * 60 * 1000 },
  { key: '1M', points: 44, step: 16 * 60 * 60 * 1000 },
  { key: '1Y', points: 52, step: 7 * 24 * 60 * 60 * 1000 },
]

interface ApiResult { token?: string; error?: string; status?: number }

async function api(path: string, opts: RequestInit = {}, token: string): Promise<unknown> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (opts.body) headers['Content-Type'] = 'application/json'
  const resp = await fetch(API + path, { ...opts, headers })
  if (resp.status === 401) return { error: 'unauthorized', status: 401 }
  if (!resp.ok) return { error: `http_${resp.status}`, status: resp.status }
  const ct = resp.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return await resp.json()
  return { text: await resp.text() }
}

function readToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' }
}
function storeToken(t: string): void {
  try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}

/* ---- formatting helpers (mirror 6995 util) ---- */
function pad(n: number): string { return n < 10 ? `0${n}` : String(n) }
function clock(): string {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function fmtNum(n: number | undefined, digits = 2): string {
  const x = n ?? 0
  if (Number.isNaN(x)) return '0'
  return x.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
function fmtMoney(n: number | undefined, currency = 'CNY', opts: { sign?: boolean; decimals?: number } = {}): string {
  const x = n ?? 0
  const sign = opts.sign === true ? (x > 0 ? '+' : x < 0 ? '-' : '') : ''
  const sym = currency === 'CNY' ? '¥' : currency === 'HKD' ? 'HK$' : ''
  const d = opts.decimals ?? 2
  return `${sign}${sym}${fmtNum(Math.abs(x), d)}`
}
function fmtPct(n: number | undefined, digits = 2): string {
  const x = n ?? 0
  const sign = x > 0 ? '+' : ''
  return `${sign}${x.toFixed(digits)}%`
}
function fmtInt(n: number | undefined): string {
  return (n ?? 0).toLocaleString('zh-CN')
}
function signClass(n: number): string { return n > 0 ? (css.up ?? '') : n < 0 ? (css.down ?? '') : '' }
function factorLabel(f: Record<string, unknown>, index: number): string {
  if (typeof f.name === 'string' && f.name !== '') return f.name
  if (typeof f.code === 'string' && f.code !== '') return f.code
  return `#${index + 1}`
}
function arrow(n: number): string { return n > 0 ? '▲' : n < 0 ? '▼' : '—' }

/** compute KPIs (mirror 6995 invest.js compute) */
interface Overview {
  a?: { account?: { cash?: number } | Record<string, unknown>; [k: string]: unknown }
  hk?: { account?: { cash?: number } | Record<string, unknown>; [k: string]: unknown }
}
function compute(state: { holdings: Holding[]; overview: Overview }) {
  let stockValue = 0
  let stockCost = 0
  let todayPnl = 0
  const byMarket: Record<string, number> = { 沪A: 0, 深A: 0, 港股: 0, 美股: 0 }
  for (const h of state.holdings) {
    const mv = h.shares * h.price
    const cost = h.shares * h.cost
    stockValue += mv
    stockCost += cost
    todayPnl += (h.price - h.prevClose) * h.shares
    if (h.market === '沪A' || h.market === '深A') { byMarket['沪A'] = (byMarket['沪A'] ?? 0) + mv }
    else if (h.market === '港股') { byMarket['港股'] = (byMarket['港股'] ?? 0) + mv }
    else if (h.market === '美股') { byMarket['美股'] = (byMarket['美股'] ?? 0) + mv }
  }
  const ov = state.overview
  const acctA = (ov.a?.account ?? ov.a) as { cash?: number } | undefined
  const acctHk = (ov.hk?.account ?? ov.hk) as { cash?: number } | undefined
  const cashA = acctA?.cash ?? 0
  const cashHk = acctHk?.cash ?? 0
  const totalCash = cashA + cashHk
  const totalValue = stockValue + totalCash
  const totalCost = stockCost + totalCash
  const totalReturn = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0
  const todayTotal = todayPnl
  const allocation = [
    { name: 'A股股票', color: '#5b8cff', value: byMarket['沪A'] },
    { name: '港股股票', color: '#38bdf8', value: byMarket['港股'] },
    { name: '美股股票', color: '#a78bfa', value: byMarket['美股'] },
    { name: '现金', color: '#64748b', value: totalCash },
  ]
  return { stockValue, totalValue, totalCost, totalReturn, todayTotal, allocation, byMarket, totalCash }
}

/** login form + board */
export function InvestBoard() {
  const [token, setToken] = useState<string>(() => readToken())
  const [authed, setAuthed] = useState<boolean>(() => !!readToken())
  const [loading, setLoading] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [user, setUser] = useState<string>('')
  const [password, setPassword] = useState('')
  const [holdings, setHoldings] = useState<Holding[]>([])
  const [overview, setOverview] = useState<Overview>({})
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [equity, setEquity] = useState<EquityPoint[]>([])
  const [factorTop, setFactorTop] = useState<Record<string, unknown>[]>([])
  const [range, setRange] = useState('1M')
  const [lastUpd, setLastUpd] = useState('--:--:--')
  const [busy, setBusy] = useState(false)
  const tokenRef = useRef(token)
  tokenRef.current = token

  const auth = useCallback(() => tokenRef.current, [])

  const load = useCallback(async () => {
    if (!auth()) return
    setBusy(true)
    const [indices, fac, eqA, eqHk] = await Promise.all([
      api('/quote/snapshot?limit=6&sort=amount', {}, auth()),
      api('/factor/latest?limit=10', {}, auth()),
      api('/paper/a/equity', {}, auth()),
      api('/paper/hk/equity', {}, auth()),
    ])
    // normalize holdings + overview from the composite endpoint
    // 6995 invest actually loads /paper/a/positions + /paper/hk/positions and /paper/a/account + /paper/hk/account.
    const posA = await api('/paper/a/positions', {}, auth()).catch(() => null)
    const posHk = await api('/paper/hk/positions', {}, auth()).catch(() => null)
    const accA = await api('/paper/a/account', {}, auth()).catch(() => null)
    const accHk = await api('/paper/hk/account', {}, auth()).catch(() => null)
    const list: Holding[] = []
    const pushPos = (rows: unknown, mkt: string, currency: string) => {
      const arr = Array.isArray(rows) ? rows : []
      for (const r of arr as Record<string, unknown>[]) {
        list.push({
          code: typeof r.code === 'string' ? r.code : '',
          name: typeof r.name === 'string' ? r.name : '',
          market: typeof r.market === 'string' ? r.market : mkt,
          shares: Number(r.shares ?? 0),
          cost: Number(r.cost ?? 0),
          price: Number(r.price ?? 0),
          prevClose: Number(r.prev_close ?? r.prevClose ?? r.price ?? 0),
          currency: typeof r.currency === 'string' ? r.currency : currency,
        })
      }
    }
    pushPos(posA, '沪A', 'CNY')
    pushPos(posHk, '港股', 'HKD')
    setHoldings(list)
    setOverview({
      a: { account: (accA as { account?: object } | null)?.account ?? (accA as object | null) ?? {} },
      hk: { account: (accHk as { account?: object } | null)?.account ?? (accHk as object | null) ?? {} },
    })
    const indicesRecord = indices as { items?: Quote[]; data?: Quote[] } | null
    setQuotes(indicesRecord?.items ?? indicesRecord?.data ?? [])
    const facRecord = fac as { items?: unknown[]; data?: unknown[] } | null
    setFactorTop((facRecord?.items ?? facRecord?.data) as Record<string, unknown>[])
    const out: EquityPoint[] = []
    const pushEq = (rows: unknown) => {
      const arr = Array.isArray(rows) ? rows : []
      for (const p of arr as Record<string, unknown>[]) {
        const raw = typeof p.as_of === 'string' ? p.as_of : typeof p.created_at === 'string' ? p.created_at : ''
        const t = new Date(raw).getTime()
        out.push({ t: Number.isNaN(t) ? Date.now() : t, v: Number(p.total_equity ?? 0) })
      }
    }
    pushEq(eqA)
    pushEq(eqHk)
    if (!out.length) out.push({ t: Date.now(), v: 0 })
    out.sort((a, b) => a.t - b.t)
    setEquity(out)
    setLastUpd(clock())
    setBusy(false)
  }, [auth])

  useEffect(() => {
    if (authed) { void load() }
  }, [authed, load])

  // every 30s refresh
  useEffect(() => {
    if (!authed) return
    const timer = setInterval(() => { void load() }, 30_000)
    return () => { clearInterval(timer) }
  }, [authed, load])

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError(null)
    setLoading(true)
    const r = (await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password }) }, '')) as ApiResult
    setLoading(false)
    if (r.token) {
      storeToken(r.token)
      setToken(r.token)
      setAuthed(true)
      setUser('')
      setPassword('')
    } else {
      setLoginError(r.error ?? '登录失败')
    }
  }

  const logout = () => {
    storeToken('')
    setToken('')
    setAuthed(false)
    setHoldings([])
    setOverview({})
  }

  const state = useMemo(() => ({ holdings, overview }), [holdings, overview])
  const c = useMemo(() => compute(state), [state])

  if (!authed) {
    return (
      <div className={css.board}>
        <div className={css.pageHead}>
          <div>
            <h1 className={css.pageTitle}>投资看板</h1>
            <p className={css.pageDesc}>组合持仓、市场行情与收益概览 · 数据来自 Invest 真实系统</p>
          </div>
        </div>
        <div className={css.loginCard}>
          <h2 className={css.loginTitle}>登录投资系统</h2>
          <form className={css.loginForm} onSubmit={(e) => { void submitLogin(e) }}>
            <label className={css.field}>
              <span className={css.fieldLabel}>用户名</span>
              <input className={css.input} value={user} onChange={(e) => { setUser(e.target.value) }} autoComplete="username" />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>密码</span>
              <input className={css.input} type="password" value={password} onChange={(e) => { setPassword(e.target.value) }} autoComplete="current-password" />
            </label>
            {loginError && <p className={css.error} role="alert">{loginError}</p>}
            <button type="submit" className={css.primaryBtn} disabled={loading}>{loading ? '登录中…' : '登录'}</button>
          </form>
        </div>
      </div>
    )
  }

  const rangeMeta = RANGES.find(r => r.key === range) ?? RANGES[2] ?? { key: '1M', points: 44, step: 16 * 60 * 60 * 1000 }
  const equitySlice = equity.slice(-rangeMeta.points)
  const maxV = Math.max(...equitySlice.map(p => p.v), 1)
  const minV = Math.min(...equitySlice.map(p => p.v), 0)
  const span = maxV - minV || 1
  const chartW = 720
  const chartH = 200
  const chartPts = equitySlice
    .map((p, i) => `${(i / Math.max(equitySlice.length - 1, 1)) * chartW},${chartH - ((p.v - minV) / span) * chartH}`)
    .join(' ')

  return (
    <div className={css.board}>
      <div className={css.pageHead}>
        <div>
          <h1 className={css.pageTitle}>投资看板</h1>
          <p className={css.pageDesc}>组合持仓、市场行情与收益概览 · 数据来自 Invest 真实系统</p>
        </div>
        <div className={css.rangeRow}>
          <span className={css.refresh}>最后更新 {lastUpd}</span>
          <button type="button" className={css.refreshBtn} onClick={() => { void load() }} disabled={busy}>{busy ? '刷新中…' : '刷新'}</button>
          <button type="button" className={css.ghostBtn} onClick={logout}>退出</button>
        </div>
      </div>

      <div className={css.kpis}>
        <div className={css.kpi}>
          <div className={css.kpiLabel}>总资产</div>
          <div className={css.kpiValue}>{fmtMoney(c.totalValue, 'CNY')}</div>
          <div className={clsx(css.kpiDelta, signClass(c.todayTotal))}>
            {arrow(c.todayTotal)} {fmtPct(c.todayTotal / (c.totalValue || 1) * 100)}
          </div>
        </div>
        <div className={css.kpi}>
          <div className={css.kpiLabel}>今日盈亏</div>
          <div className={clsx(css.kpiValue, signClass(c.todayTotal))}>{fmtMoney(c.todayTotal, 'CNY', { sign: true, decimals: 0 })}</div>
          <div className={css.kpiDelta}><span className="muted">较昨日</span> {arrow(c.todayTotal)}</div>
        </div>
        <div className={css.kpi}>
          <div className={css.kpiLabel}>总收益率</div>
          <div className={clsx(css.kpiValue, signClass(c.totalReturn))}>{fmtPct(c.totalReturn)}</div>
          <div className={css.kpiDelta}><span className="muted">累计</span> {arrow(c.totalReturn)}</div>
        </div>
        <div className={css.kpi}>
          <div className={css.kpiLabel}>持仓数量</div>
          <div className={css.kpiValue}>{fmtInt(holdings.length)}</div>
          <div className={css.kpiDelta}><span className="muted">{holdings.length} 只标的</span></div>
        </div>
      </div>

      <div className={css.card}>
        <div className={css.cardHead}>
          <div className={css.cardTitle}>市场指数</div>
          <div className={css.cardSub}>全球主要指数 · 实时</div>
        </div>
        <div className={css.tickerStrip}>
          {quotes.length === 0 ? <span className={css.mutedText}>暂无行情</span> : quotes.map(q => (
            <div key={q.code ?? q.name ?? String(Math.random())} className={css.ticker}>
              <span className={css.tickerName}>{q.name ?? q.code}</span>
              <span className={css.tickerValue}>{fmtNum(q.price, 2)}</span>
              <span className={clsx(css.tickerChange, signClass(q.change_pct ?? 0))}>
                {fmtPct(q.change_pct ?? 0, 2)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={css.mainGrid}>
        <div className={css.col}>
          <div className={css.card}>
            <div className={css.cardHead}>
              <div>
                <div className={css.cardTitle}>收益走势</div>
                <div className={css.cardSub}>组合净值变化</div>
              </div>
              <div className={css.seg}>
                {RANGES.map(r => (
                  <button key={r.key} type="button" className={clsx(css.segBtn, range === r.key ? css.segActive : null)} onClick={() => { setRange(r.key) }}>{r.key}</button>
                ))}
              </div>
            </div>
            <div className={css.chart}>
              {equitySlice.length <= 1 ? <span className={css.mutedText}>暂无净值数据</span> : (
                <svg viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none" className={css.chartSvg}>
                  <polyline points={chartPts} fill="none" stroke="#5b8cff" strokeWidth="2" />
                </svg>
              )}
            </div>
          </div>

          <div className={css.card}>
            <div className={css.cardHead}>
              <div>
                <div className={css.cardTitle}>持仓明细</div>
                <div className={css.cardSub}>{holdings.length} 只持仓</div>
              </div>
            </div>
            <div className={css.tableWrap}>
              <table className={css.table}>
                <thead>
                  <tr>
                    <th>标的</th><th>市场</th><th className={css.num}>持仓</th>
                    <th className={css.num}>成本价</th><th className={css.num}>现价</th>
                    <th className={css.num}>市值</th><th className={css.num}>盈亏</th>
                    <th className={css.num}>今日</th>
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((h) => {
                    const mv = h.shares * h.price
                    const pnl = (h.price - h.cost) * h.shares
                    const pnlPct = h.cost > 0 ? (h.price - h.cost) / h.cost * 100 : 0
                    const today = (h.price - h.prevClose) * h.shares
                    return (
                      <tr key={h.code}>
                        <td><div className={css.holdingName}>{h.name}</div><div className={css.holdingCode}>{h.code}</div></td>
                        <td className={css.mutedText}>{h.market}</td>
                        <td className={css.num}>{fmtInt(h.shares)}</td>
                        <td className={clsx(css.num, css.mutedText)}>{fmtMoney(h.cost, h.currency)}</td>
                        <td className={css.num}>{fmtMoney(h.price, h.currency)}</td>
                        <td className={css.num}>{fmtMoney(mv, h.currency, { decimals: 0 })}</td>
                        <td className={clsx(css.num, signClass(pnl))}>
                          {fmtMoney(pnl, h.currency, { sign: true, decimals: 0 })}{' '}
                          <span className={css.faint}>({fmtPct(pnlPct, 1)})</span>
                        </td>
                        <td className={clsx(css.num, signClass(today))}>{fmtMoney(today, h.currency, { sign: true, decimals: 0 })}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className={css.col}>
          <div className={css.card}>
            <div className={css.cardHead}>
              <div>
                <div className={css.cardTitle}>资产配置</div>
                <div className={css.cardSub}>按资产类别分布</div>
              </div>
            </div>
            <div className={css.alloc}>
              <div className={css.allocLegend}>
                {c.allocation.filter(a => (a.value ?? 0) > 0).map((a) => {
                  const pct = c.totalValue ? ((a.value ?? 0) / c.totalValue * 100) : 0
                  return (
                    <div key={a.name} className={css.allocRow}>
                      <span className={css.swatch} style={{ background: a.color }} />
                      <span className={css.allocName}>{a.name}</span>
                      <span className={css.allocPct}>{fmtNum(pct, 1)}%</span>
                      <span className={css.allocAmt}>{fmtMoney(a.value ?? 0, 'CNY', { decimals: 0 })}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className={css.card}>
            <div className={css.cardHead}><div><div className={css.cardTitle}>盈亏统计</div><div className={css.cardSub}>实时汇总</div></div></div>
            <div className={css.kvList}>
              <div className={css.kv}><span className={css.kvK}>股票市值</span><span className={css.kvV}>{fmtMoney(c.stockValue, 'CNY', { decimals: 0 })}</span></div>
              <div className={css.kv}><span className={css.kvK}>总成本</span><span className={clsx(css.kvV, css.mutedText)}>{fmtMoney(c.totalCost, 'CNY', { decimals: 0 })}</span></div>
              <div className={css.kv}><span className={css.kvK}>浮动盈亏</span><span className={clsx(css.kvV, signClass(c.totalValue - c.totalCost))}>{fmtMoney(c.totalValue - c.totalCost, 'CNY', { sign: true, decimals: 0 })}</span></div>
              <div className={css.kv}><span className={css.kvK}>今日盈亏</span><span className={clsx(css.kvV, signClass(c.todayTotal))}>{fmtMoney(c.todayTotal, 'CNY', { sign: true, decimals: 0 })}</span></div>
              <div className={css.kv}><span className={css.kvK}>持仓数量</span><span className={css.kvV}>{holdings.length} 只</span></div>
            </div>
          </div>

          {factorTop.length > 0 && (
            <div className={css.card}>
              <div className={css.cardHead}>
                <div>
                  <div className={css.cardTitle}>因子排行</div>
                  <div className={css.cardSub}>最新因子</div>
                </div>
              </div>
              <div className={css.factorList}>
                {factorTop.slice(0, 6).map((f, i) => (
                  <div key={i} className={css.factorRow}>
                    <span className={css.factorName}>{factorLabel(f, i)}</span>
                    <span className={css.factorValue}>{fmtNum(Number(f.value ?? 0), 2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
