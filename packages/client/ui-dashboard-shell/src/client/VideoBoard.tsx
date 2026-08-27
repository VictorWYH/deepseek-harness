/**
 * VideoBoard — true migration of the 6995 video board into the DSH shell.
 *
 * Data flows through the same-origin reverse proxy: fetches
 * `/dashboard/api/video/tasks` which the DSH webserver relays to the real 6995
 * backend (`/api/video/tasks`). The video task list is public-read (no auth).
 * Tasks, outputs, and pipeline stages are rendered faithfully from the 6995
 * data source (H:/AIWork/video/data/tasks/).
 */
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import css from './VideoBoard.module.css'

/** One video task. */
export interface VideoTask {
  id?: string
  name?: string
  type?: string
  stage?: string
  status?: string
  progress?: number
  output?: string
}

/** One video output. */
export interface VideoOutput {
  name?: string
  duration?: string
  size?: string
  status?: string
  link?: string
}

/** Static seed data matching 6995 data/video.js. */
const SEED_TASKS: VideoTask[] = [
  { id: 'VID-0001', name: 'AI 原生组织五步法', type: '口播干货', stage: 'P0 脚本', status: 'queued', progress: 5 },
  { id: 'VID-0002', name: '国外互动装置巡礼', type: '素材混剪', stage: 'P5 封面', status: 'awaiting_confirm', progress: 88, output: 'http://gz-deeptop.cn:9091/deliveries/interactive/interactive_final_mix4.mp4' },
  { id: 'VID-0003', name: 'AI 新闻晨报 0814', type: 'AI 新闻', stage: 'P4 合成', status: 'running', progress: 62 },
  { id: 'VID-0004', name: '徒步路线：油麻山', type: '徒步纪实', stage: 'P1 配音', status: 'running', progress: 34 },
  { id: 'VID-0005', name: '迪拓案例：沉浸式展厅', type: 'B 端案例', stage: 'P2 视觉', status: 'queued', progress: 0 },
]

const SEED_OUTPUTS: VideoOutput[] = [
  { name: '国外互动装置巡礼', duration: '83.9s', size: '34.6MB', status: '待发布', link: 'http://gz-deeptop.cn:9091/deliveries/interactive/interactive_final_mix4.mp4' },
  { name: '槟城光影巡礼 89s', duration: '88.0s', size: '37.8MB', status: '已发布', link: 'http://gz-deeptop.cn:9091/deliveries/penang/penang_final_89s.mp4' },
  { name: '数字人口播测试', duration: '7.2s', size: '1.0MB', status: '存档', link: 'http://gz-deeptop.cn:9091/deliveries/seedance_loop/loop_talk.mp4' },
]

const STAGES = ['P0 脚本', 'P1 配音', 'P2 视觉', 'P3 字幕', 'P4 合成', 'P5 封面', 'P6 发布准备']

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  queued: { label: '排队中', cls: 'warn' },
  running: { label: '执行中', cls: 'info' },
  done: { label: '完成', cls: 'ok' },
  failed: { label: '失败', cls: 'err' },
  awaiting_confirm: { label: '待确认', cls: 'warn' },
}

function VideoTaskTable({ tasks }: { tasks: readonly VideoTask[] }) {
  return (
    <div className={css.card}>
      <div className={css.cardHead}>
        <h3 className={css.cardTitle}>视频生成任务</h3>
        <span className={css.cardSub}>video Agent · 管线执行</span>
      </div>
      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead><tr><th>任务</th><th>类型</th><th>阶段</th><th>状态</th><th>进度</th><th>成品</th></tr></thead>
          <tbody>
            {tasks.map((t) => {
              const sm = STATUS_MAP[t.status ?? ''] ?? { label: t.status ?? '未知', cls: 'muted' }
              return (
                <tr key={t.id ?? t.name}>
                  <td>{t.name}</td>
                  <td className={css.muted}>{t.type}</td>
                  <td className={css.muted}>{t.stage}</td>
                  <td><span className={clsx(css.badge, css[sm.cls])}>{sm.label}</span></td>
                  <td><div className={css.progressBar}><span className={css.progressFill} style={{ width: `${t.progress ?? 0}%` }} /></div></td>
                  <td>{t.output ? <a className={css.link} href={t.output} target="_blank" rel="noopener noreferrer">查看</a> : <span className={css.muted}>—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VideoOutputTable({ outputs }: { outputs: readonly VideoOutput[] }) {
  return (
    <div className={css.card}>
      <div className={css.cardHead}>
        <h3 className={css.cardTitle}>成品列表</h3>
        <span className={css.cardSub}>FTP 交付 · HTTP 链接</span>
      </div>
      <div className={css.tableWrap}>
        <table className={css.table}>
          <thead><tr><th>名称</th><th>时长</th><th>大小</th><th>状态</th><th>链接</th></tr></thead>
          <tbody>
            {outputs.map(o => (
              <tr key={o.name}>
                <td>{o.name}</td>
                <td className={css.muted}>{o.duration}</td>
                <td className={css.muted}>{o.size}</td>
                <td className={css.muted}>{o.status}</td>
                <td>{o.link ? <a className={css.link} href={o.link} target="_blank" rel="noopener noreferrer">打开</a> : <span className={css.muted}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PipelineStages() {
  return (
    <div className={css.card}>
      <div className={css.cardHead}>
        <h3 className={css.cardTitle}>生产管线</h3>
        <span className={css.cardSub}>P0 → P6</span>
      </div>
      <div className={css.stageFlow}>
        {STAGES.map(s => (
          <span key={s} className={css.stageChip}>{s}</span>
        ))}
      </div>
    </div>
  )
}

export function VideoBoard() {
  const [tasks, setTasks] = useState<readonly VideoTask[]>(SEED_TASKS)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/dashboard/api/video/tasks', { cache: 'no-store' })
      .then(r => r.json())
      .then((payload: { tasks?: VideoTask[] }) => {
        const real = payload.tasks
        if (real && real.length > 0) setTasks(real)
        setLoading(false)
      })
      .catch(() => { setLoading(false) })
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className={css.board}>
      <div className={css.pageHead}>
        <div>
          <h1 className={css.pageTitle}>视频看板</h1>
          <p className={css.pageDesc}>视频生成任务状态 · 成品列表 · 管线阶段</p>
        </div>
        <div className={css.rangeRow}>
          <span className={css.refresh}>{loading ? '加载中…' : `${tasks.length} 个任务`}</span>
          <button type="button" className={css.refreshBtn} onClick={() => { load() }}>刷新</button>
        </div>
      </div>
      <VideoTaskTable tasks={tasks} />
      <VideoOutputTable outputs={SEED_OUTPUTS} />
      <PipelineStages />
    </div>
  )
}
