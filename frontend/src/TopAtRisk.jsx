import { useEffect, useState } from 'react'

const API_BASE = 'http://localhost:8000/api'

const TIER_COLOR = {
  high: '#c0392b',
  medium: '#d9b830',
  low: '#3f8f5f',
}

function photoUrl(name, width = 300) {
  return `${API_BASE}/businesses/photo?name=${encodeURIComponent(name)}&width=${width}`
}

// A standalone, shareable artifact — not the exploratory map. Built to be
// screenshotted, printed, or handed to a reporter/council member: the
// businesses actually most at risk, right now, in one glance.
export default function TopAtRisk() {
  const [data, setData] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/top-at-risk?limit=10`)
      .then(r => r.json())
      .then(setData)
  }, [])

  if (!data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)' }}>
        Loading…
      </div>
    )
  }

  return (
    <div className="paper-scroll" style={{ height: '100vh', overflowY: 'auto', background: 'var(--paper)', padding: '48px 24px' }}>
      <div className="fade-in" style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="font-display" style={{ fontSize: 34, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.15 }}>
              Fremont's Most At-Risk Restaurants
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 8 }}>
              Handoff · Succession Risk Atlas · {data.generated_at}
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="no-print ghost-btn"
            style={{
              background: 'var(--ink)', color: 'var(--paper)', fontWeight: 700,
              fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '9px 14px', borderRadius: 2, flexShrink: 0,
            }}
          >
            Print / Save
          </button>
        </div>

        <p style={{ fontSize: 14, color: 'var(--ink-soft)', marginTop: 18, lineHeight: 1.6, maxWidth: '58ch' }}>
          These businesses are likely to disappear without a buyer in the next several years —
          not from failure, but because no one outside the family knows a transition is needed.
          Ranked by a succession risk score built from license age, review trends, and digital presence.
        </p>

        <div style={{ marginTop: 32 }}>
          {data.businesses.map((b, i) => (
            <div
              key={b.name}
              className="top-at-risk-row"
              style={{
                display: 'flex', gap: 16, alignItems: 'center',
                padding: '16px 12px', margin: '0 -12px', borderRadius: 3,
                borderTop: i === 0 ? '2px solid var(--ink)' : '1px solid var(--rule)',
                transition: 'background 0.15s ease',
              }}
            >
              <div className="font-display" style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink-soft)', width: 28, flexShrink: 0, textAlign: 'right' }}>
                {i + 1}
              </div>
              <img
                src={photoUrl(b.name)}
                alt=""
                onError={e => { e.target.style.visibility = 'hidden' }}
                style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 2, flexShrink: 0, background: 'var(--paper-dim)' }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{b.name}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: TIER_COLOR[b.risk_tier], flexShrink: 0 }}>
                    {Math.round(b.risk_score)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{b.address}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink)', marginTop: 4, fontStyle: 'italic' }}>
                  {b.reason}{b.years_in_operation ? ` · ${Math.round(b.years_in_operation)} years in operation` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 32, fontSize: 11, color: 'var(--ink-soft)', opacity: 0.7 }}>
          handoff-fremont.org · A field survey of businesses likely to disappear without a buyer, not from failure, but from silence.
        </div>
      </div>
    </div>
  )
}
