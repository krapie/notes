import { useState } from 'react'
import NoteLayout from '../components/NoteLayout'

type HopKind = 'normal' | 'deprio' | 'loss-start' | 'loss-cont'
type Scenario = 'deprio' | 'real-loss'

interface Hop {
  num: number
  host: string
  loss: number
  snt: number
  last: number | null
  avg: number
  best: number
  wrst: number
  stdev: number
  kind: HopKind
}

interface ScenarioDef {
  label: string
  hops: Hop[]
  verdict: string
  verdictKind: 'warn' | 'bad'
}

const SCENARIOS: Record<Scenario, ScenarioDef> = {
  deprio: {
    label: 'Case A — ICMP Deprioritization',
    verdict: 'Not real loss — hop 3 is rate-limiting its own ICMP TTL-exceeded replies',
    verdictKind: 'warn',
    hops: [
      { num: 1, host: '192.168.1.1   (gateway)',         loss: 0,  snt: 50, last: 1.2,  avg: 1.1,  best: 0.8,  wrst: 2.1,  stdev: 0.3, kind: 'normal' },
      { num: 2, host: '10.0.0.1      (isp-edge)',        loss: 0,  snt: 50, last: 8.3,  avg: 8.5,  best: 7.9,  wrst: 11.2, stdev: 0.5, kind: 'normal' },
      { num: 3, host: '72.14.221.4   (isp-backbone)',    loss: 20, snt: 50, last: null,  avg: 15.2, best: 14.1, wrst: 18.3, stdev: 0.8, kind: 'deprio' },
      { num: 4, host: '142.251.45.33 (transit-core)',    loss: 0,  snt: 50, last: 14.8, avg: 14.9, best: 14.1, wrst: 18.0, stdev: 0.6, kind: 'normal' },
      { num: 5, host: '108.170.246.3 (pop-edge)',        loss: 0,  snt: 50, last: 15.1, avg: 15.0, best: 14.5, wrst: 16.2, stdev: 0.4, kind: 'normal' },
      { num: 6, host: '8.8.8.8       (destination)',     loss: 0,  snt: 50, last: 15.3, avg: 15.2, best: 14.8, wrst: 16.5, stdev: 0.3, kind: 'normal' },
    ],
  },
  'real-loss': {
    label: 'Case B — Real Packet Loss',
    verdict: 'Real loss — starts at hop 4 and persists to the destination',
    verdictKind: 'bad',
    hops: [
      { num: 1, host: '192.168.1.1   (gateway)',         loss: 0,  snt: 50, last: 1.2,  avg: 1.1,  best: 0.8,  wrst: 2.1,  stdev: 0.3, kind: 'normal' },
      { num: 2, host: '10.0.0.1      (isp-edge)',        loss: 0,  snt: 50, last: 8.3,  avg: 8.5,  best: 7.9,  wrst: 11.2, stdev: 0.5, kind: 'normal' },
      { num: 3, host: '72.14.221.4   (isp-backbone)',    loss: 0,  snt: 50, last: 13.2, avg: 13.4, best: 12.9, wrst: 15.1, stdev: 0.5, kind: 'normal' },
      { num: 4, host: '142.251.45.33 (congested-link)',  loss: 20, snt: 50, last: 45.1, avg: 44.8, best: 42.3, wrst: 89.2, stdev: 8.1, kind: 'loss-start' },
      { num: 5, host: '108.170.246.3 (downstream)',      loss: 20, snt: 50, last: 46.3, avg: 46.1, best: 43.1, wrst: 90.1, stdev: 8.3, kind: 'loss-cont' },
      { num: 6, host: '8.8.8.8       (destination)',     loss: 20, snt: 50, last: 46.8, avg: 46.5, best: 44.0, wrst: 91.0, stdev: 8.5, kind: 'loss-cont' },
    ],
  },
}

const COL_DESC: Record<string, string> = {
  'Loss%': 'Percentage of probes that received no reply. The primary signal — check this column first.',
  'Snt':   'Total probes sent to this hop. More samples = more reliable statistics.',
  'Last':  'RTT (ms) of the most recent probe. Noisy single sample — prefer Avg for trend analysis.',
  'Avg':   'Mean round-trip time across all received probes. The primary latency signal.',
  'Best':  'Lowest RTT observed. Approximates the theoretical minimum latency for this path segment.',
  'Wrst':  'Highest RTT observed. A large Best↔Wrst gap indicates congestion or route flapping.',
  'StDev': 'Standard deviation of RTT. High StDev = jitter. Combine with Loss% — high StDev alone is jitter, not drops.',
}

const KIND_NOTE: Record<HopKind, (hop: Hop) => string> = {
  normal: (h) =>
    `Hop ${h.num} responded cleanly. Loss% is 0% and latency is stable. No action needed.`,
  deprio: (h) =>
    `Hop ${h.num} shows ${h.loss}% loss, but all downstream hops are at 0%. ` +
    `This router is deprioritizing ICMP TTL-exceeded responses — the probes MTR uses to measure each hop. ` +
    `This is deliberate CPU-protection behavior and is very common on backbone and transit routers. ` +
    `Forwarded traffic passes through unaffected. Treat this as 0% loss.`,
  'loss-start': (h) =>
    `Hop ${h.num} is where loss originates. The ${h.loss}% persists through every downstream hop to the destination — ` +
    `a clear sign of real packet loss. Packets are being dropped at this hop or on the link feeding it. ` +
    `Downstream hops are not independently dropping; they simply never receive those packets.`,
  'loss-cont': (h) =>
    `Hop ${h.num} shows ${h.loss}% loss, but it is inherited from upstream. ` +
    `Packets were already dropped before reaching this hop, so this is not an independent failure. ` +
    `Trace back to the first hop where loss appeared — that is where to investigate.`,
}

const CHEAT: Array<{ pattern: string; verdict: string; cls: string }> = [
  {
    pattern: 'Loss at hop N, all hops N+1… at 0%',
    verdict: 'ICMP deprioritization — not real loss, ignore',
    cls: 'mtr-cv-warn',
  },
  {
    pattern: 'Loss starts at hop N, continues to destination',
    verdict: 'Real loss — investigate hop N or its upstream link',
    cls: 'mtr-cv-bad',
  },
  {
    pattern: 'Only the final destination hop has loss',
    verdict: 'Destination rate-limits ICMP — confirm with TCP probe (curl, nc)',
    cls: 'mtr-cv-warn',
  },
  {
    pattern: 'High Wrst / StDev, Loss% = 0%',
    verdict: 'Jitter or transient congestion, not packet loss',
    cls: 'mtr-cv-ok',
  },
]

function fmt(n: number | null) {
  return n === null ? '—' : n.toFixed(1)
}

const STAT_COLS = ['Loss%', 'Snt', 'Last', 'Avg', 'Best', 'Wrst', 'StDev']

function MtrExplorer() {
  const [scenario, setScenario] = useState<Scenario>('deprio')
  const [activeHop, setActiveHop] = useState<number | null>(null)
  const [activeCol, setActiveCol] = useState<string | null>(null)

  const s = SCENARIOS[scenario]
  const hopDetail = activeHop !== null ? (s.hops.find(h => h.num === activeHop) ?? null) : null

  function switchScenario(sc: Scenario) {
    setScenario(sc)
    setActiveHop(null)
    setActiveCol(null)
  }

  function rowCls(kind: HopKind) {
    if (kind === 'deprio')     return 'mtr-row-deprio'
    if (kind === 'loss-start') return 'mtr-row-loss-start'
    if (kind === 'loss-cont')  return 'mtr-row-loss-cont'
    return ''
  }

  function lossCls(kind: HopKind) {
    if (kind === 'deprio')     return 'mtr-loss-warn'
    if (kind === 'loss-start') return 'mtr-loss-bad'
    if (kind === 'loss-cont')  return 'mtr-loss-dim'
    return 'mtr-loss-ok'
  }

  return (
    <div className="mtr-root">
      <div className="mtr-toggle">
        {(['deprio', 'real-loss'] as Scenario[]).map(sc => (
          <button
            key={sc}
            className={`mtr-toggle-btn${scenario === sc ? ' active' : ''}`}
            onClick={() => switchScenario(sc)}
          >
            {SCENARIOS[sc].label}
          </button>
        ))}
      </div>

      <div className={`mtr-verdict mtr-verdict-${s.verdictKind}`}>
        <span className="mtr-verdict-label">
          {s.verdictKind === 'bad' ? 'Real Loss' : 'False Alarm'}
        </span>
        <span className="mtr-verdict-text">{s.verdict}</span>
      </div>

      <div className="mtr-table-wrap">
        <div className="mtr-table">
          <div className="mtr-table-header">
            <span>#</span>
            <span>Host</span>
            {STAT_COLS.map(col => (
              <button
                key={col}
                className={`mtr-col-btn${activeCol === col ? ' active' : ''}`}
                onClick={() => {
                  setActiveCol(activeCol === col ? null : col)
                  setActiveHop(null)
                }}
              >
                {col}
              </button>
            ))}
          </div>
          {s.hops.map(hop => (
            <div
              key={hop.num}
              className={`mtr-table-row ${rowCls(hop.kind)}${activeHop === hop.num ? ' selected' : ''}`}
              onClick={() => {
                setActiveHop(activeHop === hop.num ? null : hop.num)
                setActiveCol(null)
              }}
            >
              <span className="mtr-col-num">{hop.num}</span>
              <span className="mtr-col-host">{hop.host}</span>
              <span className={`mtr-col-val ${lossCls(hop.kind)}`}>{hop.loss.toFixed(1)}%</span>
              <span className="mtr-col-val mtr-col-dim">{hop.snt}</span>
              <span className="mtr-col-val">{fmt(hop.last)}</span>
              <span className="mtr-col-val">{fmt(hop.avg)}</span>
              <span className="mtr-col-val mtr-col-dim">{fmt(hop.best)}</span>
              <span className="mtr-col-val mtr-col-dim">{fmt(hop.wrst)}</span>
              <span className="mtr-col-val mtr-col-dim">{fmt(hop.stdev)}</span>
            </div>
          ))}
        </div>
      </div>

      {activeCol ? (
        <div className="mtr-detail">
          <span className="mtr-detail-key">{activeCol}</span>
          <span className="mtr-detail-text">{COL_DESC[activeCol]}</span>
          <button className="mtr-detail-close" onClick={() => setActiveCol(null)}>×</button>
        </div>
      ) : hopDetail ? (
        <div className={`mtr-detail mtr-detail-${hopDetail.kind}`}>
          <span className="mtr-detail-key">hop {hopDetail.num}</span>
          <span className="mtr-detail-text">{KIND_NOTE[hopDetail.kind](hopDetail)}</span>
          <button className="mtr-detail-close" onClick={() => setActiveHop(null)}>×</button>
        </div>
      ) : (
        <div className="mtr-detail mtr-detail-hint">
          Click any row for an explanation · Click a column header to see what it measures
        </div>
      )}

      <div className="mtr-cheatsheet">
        <div className="mtr-cheat-title">Quick reference</div>
        {CHEAT.map((row, i) => (
          <div key={i} className="mtr-cheat-row">
            <div className="mtr-cheat-pattern">{row.pattern}</div>
            <div className={`mtr-cheat-verdict ${row.cls}`}>{row.verdict}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MtrPage() {
  return (
    <NoteLayout
      title="Reading MTR output"
      date="2026-06-13"
      readTime="3 min"
      tags={['networking', 'troubleshooting']}
      intro="MTR combines ping and traceroute into a continuous per-hop view of the path to a destination. The key skill is distinguishing ICMP deprioritization — a router rate-limiting its own probe replies — from real end-to-end packet loss."
    >
      <MtrExplorer />
    </NoteLayout>
  )
}
