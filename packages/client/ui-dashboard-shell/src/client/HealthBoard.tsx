/**
 * HealthBoard — true migration of the 6995 家庭健康看板 into the DSH shell.
 *
 * Data source: http://127.0.0.1:6996/api/v1/health/* (family-doctor API).
 * Falls back to seed data when the API is unreachable — same behaviour as the
 * 6995 original. Write operations (addMetric, completeFollowup) POST to the
 * same API; if the backend is offline they fail gracefully.
 */
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import css from './HealthBoard.module.css'

const HEALTH_API = 'http://127.0.0.1:6996'
const METRIC_LABELS: Record<string, string> = { weight: '体重', waist: '腰围', hba1c: 'HbA1c', fbg: '空腹血糖', pbg: '餐后血糖', pbg1h: '餐后1h血糖', pbg2h: '餐后2h血糖', bp_sys: '收缩压', bp_dia: '舒张压', potassium: '血钾' }
const CATEGORY_LABELS: Record<string, string> = { review: '复查', medication: '用药核对', checkup: '检查', other: '其他' }

interface Member {
  id: number
  name: string
  relation: string
  gender?: string
  age?: number
  height_cm?: number
  weight_kg?: number
  waist_cm?: number
  conditions?: string[]
  allergy?: string
  notes?: string
  medications?: { name: string; spec?: string; dosage?: string; purpose?: string; note?: string }[]
  followups?: string[]
}
interface Metric {
  member_id: number
  metric_type?: string
  type?: string
  value: number
  unit?: string
  measured_at?: string
  note?: string
}
interface Followup { id: number; member_id: number; item: string; category: string; due_date?: string; status: string; note?: string }
interface Evidence { topic?: string; evidence_type?: string; date?: string; title?: string; url?: string }

const SEED_MEMBERS: Member[] = [
  { id: 1, name: '本人', relation: '本人', gender: '男', age: 44, height_cm: 173, weight_kg: 76, waist_cm: 105, conditions: ['2型糖尿病（HbA1c约6.4%）', '左肾结石术后（2025-05）', '脂肪肝（轻度）', '睡眠呼吸暂停（用呼吸机）', '胸腰椎间歇疼痛'], allergy: '暂无', notes: '目标：降低腰围、避免体重反弹' },
  { id: 2, name: '父亲', relation: '父亲', gender: '男', age: 73, conditions: ['2型糖尿病', '血压偶偏高', '腰椎间盘突出术后', '多年手抖（未查明）', '夜间小腿抽筋'], allergy: '无已知' },
  { id: 3, name: '母亲', relation: '母亲', gender: '女', age: 71, conditions: ['2型糖尿病约30年', '类风湿性关节炎（甲氨蝶呤+乌帕替尼）', '脑梗塞', '卵圆孔未闭术后', '泌尿道感染（2026-08-03）', '乏力/下肢水肿/手指麻木'], allergy: '病历记载未发现', medications: [{ name: '乌帕替尼缓释片', spec: '15mg×28片', dosage: '每日1次口服', purpose: '类风湿性关节炎', note: '28天疗程' }, { name: '甲氨蝶呤片', spec: '2.5mg×16片', dosage: '每周1次（12.5mg）', purpose: '类风湿性关节炎' }, { name: '叶酸片', spec: '5mg×100片', dosage: '每周1次', purpose: '减轻甲氨蝶呤副作用' }, { name: '阿司匹林肠溶片', spec: '100mg×36片', dosage: '每日1次口服', purpose: '抗血小板' }, { name: '甲钴胺片', spec: '0.5mg×48片', dosage: '每日3次', purpose: '营养神经' }, { name: '门冬胰岛素注射液（特充）', spec: '3ml:300U', dosage: '每日1次皮下', purpose: '降血糖', note: '需核对' }, { name: '利伐沙班片', spec: '10mg×30片', dosage: '每日1次口服', purpose: '抗凝' }, { name: '地奥司明片', spec: '0.45g×48片', dosage: '每日2次', purpose: '改善水肿' }, { name: '替普瑞酮胶囊', spec: '50mg×80粒', dosage: '每日3次', purpose: '胃黏膜保护' }, { name: '雷贝拉唑钠肠溶片', spec: '10mg×28片', dosage: '每日2次', purpose: '抑制胃酸' }, { name: '阿莫西林克拉维酸钾', spec: '0.375g×16片', dosage: '每日3次', purpose: '泌尿道感染' }], followups: ['阿司匹林+利伐沙班是否同服', '胰岛素实际注射方案核对', '血钾3.38复查', '尿常规/尿培养'] },
  { id: 4, name: '妻子', relation: '妻子', gender: '女', age: 44, conditions: ['桥本甲状腺炎'], medications: [{ name: '优甲乐（左甲状腺素）', dosage: '待补充', purpose: '桥本甲状腺炎' }] },
  { id: 5, name: '大儿子', relation: '大儿子', gender: '男', age: 15, conditions: ['特应性皮炎（关节/头部瘙痒）', '青春期痤疮'] },
  { id: 6, name: '小儿子', relation: '小儿子', gender: '男', age: 9, conditions: ['中度自闭症谱系障碍', '康复训练中'] },
]
const SEED_METRICS: Metric[] = [{ member_id: 1, type: 'hba1c', value: 6.4, unit: '%', measured_at: '2026-01', note: '近一次' }, { member_id: 1, type: 'fbg', value: 6.0, unit: 'mmol/L', measured_at: '2026-06', note: '空腹' }, { member_id: 1, type: 'pbg2h', value: 10.0, unit: 'mmol/L', measured_at: '2026-06' }, { member_id: 1, type: 'weight', value: 76, unit: 'kg', measured_at: '2026-07' }, { member_id: 1, type: 'waist', value: 105, unit: 'cm', measured_at: '2026-07' }, { member_id: 3, type: 'potassium', value: 3.38, unit: 'mmol/L', measured_at: '2026-08-03', note: '偏低' }]
const SEED_FOLLOWUPS: Followup[] = [{ id: 1, member_id: 1, item: 'HbA1c 复查', category: 'checkup', due_date: '2026-08-31', status: 'pending' }, { id: 2, member_id: 1, item: '糖尿病眼底筛查', category: 'checkup', due_date: '2026-09-30', status: 'pending' }, { id: 3, member_id: 1, item: '睡眠呼吸暂停复查', category: 'review', due_date: '2026-09-30', status: 'pending' }, { id: 4, member_id: 2, item: '神经内科评估手抖', category: 'review', due_date: '2026-08-31', status: 'pending' }, { id: 5, member_id: 3, item: '确认阿司匹林+利伐沙班是否同服', category: 'medication', due_date: '2026-08-15', status: 'pending' }, { id: 6, member_id: 3, item: '核对门冬胰岛素注射方案', category: 'medication', due_date: '2026-08-15', status: 'pending' }, { id: 7, member_id: 3, item: '血钾复查', category: 'checkup', due_date: '2026-08-31', status: 'pending' }, { id: 8, member_id: 4, item: '甲状腺功能复查', category: 'checkup', due_date: '2026-09-30', status: 'pending' }, { id: 9, member_id: 5, item: '皮肤科复诊', category: 'review', due_date: '2026-09-15', status: 'pending' }, { id: 10, member_id: 6, item: '睡眠记录（连续7天）', category: 'other', due_date: '2026-08-20', status: 'pending' }]
const SEED_EVIDENCE: Evidence[] = []

async function fetchJson(path: string, fallback: unknown): Promise<unknown> {
  try { const r = await fetch(HEALTH_API + path, { cache: 'no-store' }); if (!r.ok) throw new Error(String(r.status)); return await r.json() } catch { return fallback }
}

function MemberCard({ m }: { m: Member }) {
  return (
    <div className={css.memberCard}>
      <div className={css.memberHead}><strong>{m.name}</strong><span className={css.badgeMuted}>{m.relation}</span><span className={css.muted}>{m.age ?? '-'}岁 · {m.gender ?? '-'}</span></div>
      <div className={css.memberInfo}>
        {(m.height_cm || m.weight_kg) && <div className={css.muted}>身高 {m.height_cm ?? '-'}cm · 体重 {m.weight_kg ?? '-'}kg{m.waist_cm ? ` · 腰围 ${m.waist_cm}cm` : ''}</div>}
        {m.conditions && m.conditions.length > 0 && <div className={css.condRow}><span className={css.muted}>疾病：</span>{m.conditions.join('；')}</div>}
        {m.allergy && <div className={css.muted}>过敏：{m.allergy}</div>}
        {m.notes && <div className={css.muted}>备注：{m.notes}</div>}
      </div>
      {m.medications && m.medications.length > 0 && (
        <div className={css.medsBox}>
          <div className={css.muted}>用药（{m.medications.length}）</div>
          {m.medications.map(med => (
            <div key={med.name} className={css.medRow}><strong>{med.name}</strong> <span className={css.muted}>{med.spec ?? ''}</span><br /><span className={css.muted}>{med.dosage ?? ''} · {med.purpose ?? ''}</span>{med.note ? <><br /><span className={css.warn}>{med.note}</span></> : null}</div>
          ))}
        </div>
      )}
      {m.followups && m.followups.length > 0 && <div className={css.warn}>待核实：{m.followups.join('；')}</div>}
    </div>
  )
}

export function HealthBoard() {
  const [members, setMembers] = useState<readonly Member[]>([])
  const [metrics, setMetrics] = useState<readonly Metric[]>([])
  const [followups, setFollowups] = useState<readonly Followup[]>([])
  const [evidence, setEvidence] = useState<readonly Evidence[]>([])
  const [filter, setFilter] = useState('')
  const [formMember, setFormMember] = useState('')
  const [formType, setFormType] = useState('')
  const [formValue, setFormValue] = useState('')
  const [formUnit, setFormUnit] = useState('mmol/L')
  const [formDate, setFormDate] = useState('')
  const [formNote, setFormNote] = useState('')
  const [writing, setWriting] = useState(false)
  const [apiReachable, setApiReachable] = useState<boolean | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Probe the real API. Only when it responds do we treat its data as live;
    // otherwise we keep the offline seed clearly labelled as non-real-time.
    let reachable = false
    try {
      const probe = await fetch(HEALTH_API + '/api/v1/health/members', { cache: 'no-store' })
      reachable = probe.ok
    } catch { reachable = false }
    const [mems, mets, follows, ev] = await Promise.all([
      fetchJson('/api/v1/health/members', SEED_MEMBERS),
      fetchJson('/api/v1/health/metrics', SEED_METRICS),
      fetchJson('/api/v1/health/followups', SEED_FOLLOWUPS),
      fetchJson('/api/v1/health/evidence', SEED_EVIDENCE),
    ])
    setMembers(mems as Member[])
    setMetrics(mets as Metric[])
    setFollowups(follows as Followup[])
    setEvidence(ev as Evidence[])
    setApiReachable(reachable)
  }, [])

  useEffect(() => { void load() }, [load])

  const addMetric = async () => {
    if (!formValue && formValue !== '0') return
    setWriting(true)
    setWriteError(null)
    try {
      const resp = await fetch(HEALTH_API + '/api/v1/health/metrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ member_id: Number(formMember), metric_type: formType, value: Number(formValue), unit: formUnit, measured_at: formDate || new Date().toISOString().slice(0, 10), note: formNote }) })
      if (!resp.ok) { setWriteError(`保存失败：HTTP ${resp.status}`); return }
      setFormValue(''); setFormNote('')
      void load()
    } catch { setWriteError('保存失败：健康服务(6996)不可用') }
    finally { setWriting(false) }
  }

  const completeFollowup = async (id: number) => {
    setWriteError(null)
    try {
      const resp = await fetch(HEALTH_API + '/api/v1/health/followups/' + String(id), { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      if (!resp.ok) { setWriteError(`操作失败：HTTP ${resp.status}`); return }
      void load()
    } catch { setWriteError('操作失败：健康服务(6996)不可用') }
  }

  const filteredMetrics = filter ? metrics.filter(m => String(m.member_id) === filter) : metrics
  const memberName = (id: number) => members.find(m => m.id === id)?.name ?? `成员${id}`
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className={css.board}>
      <div className={css.pageHead}><div><h1 className={css.pageTitle}>家庭健康看板</h1><p className={css.pageDesc}>整理与提醒 · 不替代医生诊断</p></div><div className={css.rangeRow}><button type="button" className={css.refreshBtn} onClick={() => { void load() }}>刷新</button></div></div>
      {apiReachable === false && <div className={css.unavailable} role="alert">⚠️ 健康服务（127.0.0.1:6996）不可用，当前展示的是离线档案副本，非实时数据；服务恢复后自动切换真实数据。</div>}
      {writeError && <div className={css.unavailable} role="alert">{writeError}</div>}

      <div className={css.card}>
        <div className={css.cardHead}><div className={css.cardTitle}>家庭成员档案</div><span className={css.cardSub}>六人 · 家庭健康记录</span></div>
        <div className={css.memberGrid}>{members.map(m => <MemberCard key={m.id} m={m} />)}</div>
      </div>

      <div className={css.card}>
        <div className={css.cardHead}><div className={css.cardTitle}>健康指标</div><span className={css.cardSub}>趋势与记录</span></div>
        <div className={css.toolbar}>
          <select className={css.select} value={filter} onChange={(e) => { setFilter(e.target.value) }}><option value="">全部成员</option>{members.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}</select>
        </div>
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead><tr><th>成员</th><th>指标</th><th>数值</th><th>测量时间</th><th>备注</th></tr></thead>
            <tbody>{filteredMetrics.map((mt, i) => {
              const typeKey = mt.metric_type ?? mt.type ?? ''
              return <tr key={i}><td>{memberName(mt.member_id)}</td><td>{(METRIC_LABELS[typeKey] ?? typeKey) || '—'}</td><td><strong>{mt.value}</strong> <span className={css.muted}>{mt.unit ?? ''}</span></td><td>{mt.measured_at ?? ''}</td><td>{mt.note ?? ''}</td></tr>
            })}</tbody>
          </table>
        </div>
        <div className={css.form}>
          <div className={css.cardTitle}>新增指标记录</div>
          <div className={css.formRow}>
            <select className={css.select} value={formMember} onChange={(e) => { setFormMember(e.target.value) }}><option value="">成员</option>{members.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}</select>
            <select className={css.select} value={formType} onChange={(e) => { setFormType(e.target.value) }}><option value="">指标</option>{Object.entries(METRIC_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input className={css.input} type="number" step="0.01" placeholder="数值" value={formValue} onChange={(e) => { setFormValue(e.target.value) }} />
            <input className={css.input} placeholder="单位" value={formUnit} onChange={(e) => { setFormUnit(e.target.value) }} />
            <input className={css.input} type="date" value={formDate} onChange={(e) => { setFormDate(e.target.value) }} />
            <input className={css.input} placeholder="备注" value={formNote} onChange={(e) => { setFormNote(e.target.value) }} />
            <button type="button" className={css.primaryBtn} disabled={writing || !formValue} onClick={() => { void addMetric() }}>添加</button>
          </div>
        </div>
      </div>

      <div className={css.card}>
        <div className={css.cardHead}><div className={css.cardTitle}>随访提醒</div><span className={css.cardSub}>复查 · 用药核对 · 检查</span></div>
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead><tr><th>成员</th><th>事项</th><th>类别</th><th>到期</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{[...followups].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')).map((f) => {
              const overdue = f.status === 'pending' && f.due_date != null && f.due_date < today
              const badgeCls = f.status === 'done' ? css.badgeOk : overdue ? css.badgeErr : css.badgeWarn
              const badgeText = f.status === 'done' ? '完成' : overdue ? '逾期' : '待办'
              return <tr key={f.id}><td>{memberName(f.member_id)}</td><td><strong>{f.item}</strong>{f.note ? <br /> : null}{f.note ? <span className={css.muted}>{f.note}</span> : null}</td><td>{CATEGORY_LABELS[f.category] ?? f.category}</td><td>{f.due_date ?? '—'}</td><td><span className={clsx(css.badge, badgeCls)}>{badgeText}</span></td><td>{f.status === 'done' ? <span className={css.muted}>—</span> : <button type="button" className={css.ghostBtn} onClick={() => { void completeFollowup(f.id) }}>完成</button>}</td></tr>
            })}</tbody>
          </table>
        </div>
      </div>

      <div className={css.card}>
        <div className={css.cardHead}>
          <div className={css.cardTitle}>最新健康证据</div><span className={css.cardSub}>PubMed 检索 · 不构成医疗建议</span>
        </div>
        {evidence.length === 0 ? <p className={css.muted}>暂无证据记录</p> : (
          <div className={css.tableWrap}>
            <table className={css.table}><thead><tr><th>主题</th><th>类型</th><th>日期</th><th>标题/链接</th></tr></thead>
              <tbody>{evidence.map((e, i) => {
                const TYPE_LABELS: Record<string, string> = { randomized_controlled_trial: '随机试验', meta_analysis: 'Meta分析', systematic_review: '系统综述', guideline_or_consensus: '指南/共识', review: '综述' }
                return <tr key={i}><td>{e.topic ?? '—'}</td><td>{TYPE_LABELS[e.evidence_type ?? ''] ?? e.evidence_type ?? '—'}</td><td>{e.date ?? '—'}</td><td>{e.url ? <a className={css.link} href={e.url} target="_blank" rel="noopener noreferrer">{e.title ? (e.title.length > 60 ? e.title.slice(0, 60) + '…' : e.title) : e.title}</a> : <span>{e.title}</span>}</td></tr>
              })}</tbody>
            </table>
          </div>
        )}
        <p className={css.muted}>证据来自共享技能采集，标注类型/日期/来源；仅作一般健康信息，不替代医生诊疗。</p>
      </div>
    </div>
  )
}
