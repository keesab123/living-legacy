import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

const API_BASE = 'http://localhost:8000/api'
const SIDEBAR_WIDTH = 400

const TIER_COLOR = {
  high: '#c0392b',
  medium: '#d9b830',
  low: '#3f8f5f',
}

const TIER_LABEL = { high: 'High', medium: 'Medium', low: 'Low' }

const label = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
}

function photoUrl(name, width = 480) {
  return `${API_BASE}/businesses/photo?name=${encodeURIComponent(name)}&width=${width}`
}

// thin, data-journalism-style meter — a hairline track with a tier-colored fill
function SignalBar({ name, value }) {
  const color = value >= 0.66 ? '#c0392b' : value >= 0.33 ? '#d9b830' : '#3f8f5f'
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
        <span>{name}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ink-soft)' }}>{Math.round(value * 100)}</span>
      </div>
      <div style={{ height: 3, background: 'var(--paper-dim)' }}>
        <div style={{ height: '100%', width: `${value * 100}%`, background: color }} />
      </div>
    </div>
  )
}

export default function App() {
  const mapEl = useRef(null)
  const map = useRef(null)
  const mapSlotRef = useRef(null)
  const [mapRect, setMapRect] = useState({ top: 0, left: 0, width: 0, height: 0 })
  const [selected, setSelected] = useState(null)
  const [brief, setBrief] = useState(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [businesses, setBusinesses] = useState([])
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/businesses?limit=1000`)
      .then(r => r.json())
      .then(setBusinesses)
    fetch(`${API_BASE}/stats`)
      .then(r => r.json())
      .then(setStats)
  }, [])

  const selectBusiness = (props) => {
    setSelected(props)
    setBrief(null)
    setBriefLoading(true)
    fetch(`${API_BASE}/businesses/brief?name=${encodeURIComponent(props.name)}`)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json() })
      .then(setBrief)
      .catch(() => setBrief({ error: true }))
      .finally(() => setBriefLoading(false))
    if (map.current && props.lat && props.lng) {
      map.current.flyTo({ center: [props.lng, props.lat], zoom: 15, duration: 900 })
    }
  }

  // the map lives in one fixed spot (the main stage); measure it once it
  // mounts and again on window resize — it no longer moves when a business
  // is selected, it's just covered by the dossier panel on top of it
  const updateMapRect = () => {
    if (!mapSlotRef.current) return
    const r = mapSlotRef.current.getBoundingClientRect()
    setMapRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }

  useLayoutEffect(() => {
    updateMapRect()
  }, [])

  useEffect(() => {
    window.addEventListener('resize', updateMapRect)
    return () => window.removeEventListener('resize', updateMapRect)
  }, [])

  useEffect(() => {
    if (map.current || !businesses.length) return

    map.current = new mapboxgl.Map({
      container: mapEl.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-121.9886, 37.5485],
      zoom: 12,
      minZoom: 8,
      maxBounds: [
        [-123.3, 36.9], // SW — past the coast, south of Gilroy
        [-121.2, 38.9], // NE — past Vallejo/Sacramento delta, north of Napa
      ],
    })

    map.current.on('style.load', () => {
      // dim POI/transit labels so they recede behind the risk markers
      const style = map.current.getStyle()
      for (const layer of style.layers) {
        if (/poi|transit/.test(layer.id) && layer.type === 'symbol') {
          map.current.setLayoutProperty(layer.id, 'visibility', 'none')
        }
      }
    })

    map.current.on('load', () => {
      updateMapRect()

      const geojson = {
        type: 'FeatureCollection',
        features: businesses
          .filter(b => b.lat && b.lng)
          .map(b => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
            properties: b,
          })),
      }

      map.current.addSource('businesses', { type: 'geojson', data: geojson })

      // crisp, solid plot points — sized by tier and by zoom, so dense
      // clusters (central Fremont, Irvington) don't obscure the roads
      map.current.addLayer({
        id: 'businesses-circles',
        type: 'circle',
        source: 'businesses',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            9, ['match', ['get', 'risk_tier'], 'high', 3.5, 'medium', 2.75, 2.25],
            13, ['match', ['get', 'risk_tier'], 'high', 8, 'medium', 5.5, 4],
            16, ['match', ['get', 'risk_tier'], 'high', 12, 'medium', 8, 6],
          ],
          'circle-color': [
            'match', ['get', 'risk_tier'],
            'high', TIER_COLOR.high,
            'medium', TIER_COLOR.medium,
            'low', TIER_COLOR.low,
            '#8a8578'
          ],
          'circle-opacity': 0.95,
          'circle-stroke-width': 1.25,
          'circle-stroke-color': '#1a1a1a',
        },
      })

      map.current.on('click', 'businesses-circles', e => {
        selectBusiness(e.features[0].properties)
      })

      map.current.on('mouseenter', 'businesses-circles', () => {
        map.current.getCanvas().style.cursor = 'pointer'
      })
      map.current.on('mouseleave', 'businesses-circles', () => {
        map.current.getCanvas().style.cursor = ''
      })
    })
  }, [businesses])

  return (
    <div className="app-shell" style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', padding: 10, gap: 10, background: 'var(--bg)' }}>
      {/* Sidebar — the primary surface: title, business list, legend */}
      <div className="no-print" style={{
        width: SIDEBAR_WIDTH, flexShrink: 0, height: '100%',
        background: 'var(--sidebar)', color: 'var(--cream)',
        borderRadius: 3, boxShadow: '0 10px 34px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', zIndex: 2, overflow: 'hidden',
      }}>
        <div style={{ padding: '26px 22px 20px', borderBottom: `2px solid var(--lavender)` }}>
          <div className="font-display" style={{ fontSize: 27, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--cream)' }}>
            Handoff
          </div>
          <div style={{ ...label, marginTop: 8, color: 'var(--cream-soft)' }}>Fremont · Succession Risk Atlas</div>
          <div style={{ fontSize: 12.5, color: 'var(--cream-soft)', marginTop: 10, lineHeight: 1.55 }}>
            A field survey of businesses likely to disappear without a buyer — not from failure, but from silence.
          </div>

          {stats && (
            <div style={{ marginTop: 18, padding: '12px 14px', background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.35)', borderRadius: 3 }}>
              <div className="font-display" style={{ fontSize: 15, fontWeight: 600, color: 'var(--cream)', lineHeight: 1.4 }}>
                {stats.high_risk_count} Fremont restaurants at high succession risk
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--cream-soft)', marginTop: 4, lineHeight: 1.5 }}>
                An estimated {stats.estimated_jobs_at_risk.toLocaleString()} jobs and ${(stats.estimated_annual_revenue_at_risk / 1_000_000).toFixed(0)}M
                in annual revenue could disappear without intervention.
              </div>
              <div style={{ fontSize: 9.5, color: 'var(--cream-soft)', opacity: 0.7, marginTop: 6, fontStyle: 'italic' }}>
                Estimate based on national small-restaurant averages, not per-business figures.
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {businesses.map(b => {
            const isSelected = selected && selected.name === b.name
            return (
              <button
                key={b.name}
                onClick={() => selectBusiness(b)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                  background: isSelected ? 'rgba(155,140,214,0.14)' : 'transparent',
                  color: 'var(--cream)', font: 'inherit',
                  border: 'none', borderBottom: '1px solid var(--sidebar-rule)',
                  cursor: 'pointer', padding: '10px 22px',
                  opacity: selected && !isSelected ? 0.42 : 1,
                  transition: 'opacity 0.2s ease, background 0.2s ease',
                }}
              >
                <img
                  src={photoUrl(b.name, 96)}
                  alt=""
                  loading="lazy"
                  onError={e => { e.target.style.visibility = 'hidden' }}
                  style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 2, flexShrink: 0, background: 'var(--paper-dim)' }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                    <span style={{
                      fontSize: 13, fontWeight: 600, color: '#fbf9f4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{b.name}</span>
                    <span style={{
                      display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
                      background: 'rgba(255,255,255,0.06)', borderRadius: 999,
                      padding: '3px 8px 3px 6px',
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: TIER_COLOR[b.risk_tier], flexShrink: 0 }} />
                      <span style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--cream)' }}>{Math.round(b.risk_score)}</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--cream-soft)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.address}</div>
                </div>
              </button>
            )
          })}
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--sidebar-rule)' }}>
          <div style={{ ...label, color: 'var(--cream-soft)' }}>Succession Risk</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 16 }}>
            {['high', 'medium', 'low'].map(tier => (
              <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: TIER_COLOR[tier] }} />
                <span style={{ fontSize: 12 }}>{TIER_LABEL[tier]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main stage — the map when nothing is selected, the dossier once it is */}
      <div className="app-stage" style={{
        position: 'relative', flex: 1, height: '100%', background: 'var(--paper)',
        borderRadius: 3, boxShadow: '0 10px 34px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}>
        <div ref={mapSlotRef} className="no-print" style={{ position: 'absolute', inset: 0 }} />

        {selected && (
          <div className="app-dossier-overlay" style={{ position: 'absolute', inset: 0, overflowY: 'auto', zIndex: 3, background: 'var(--paper)' }}>
            {selected.name && (
              <div className="no-print" style={{ position: 'relative', height: 220, background: 'var(--paper-dim)' }}>
                <img
                  src={photoUrl(selected.name, 900)}
                  alt=""
                  onError={e => { e.target.style.display = 'none' }}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(to top, rgba(10,9,13,0.88), rgba(10,9,13,0.15) 60%, rgba(10,9,13,0) 85%)',
                }} />
                <div style={{ position: 'absolute', top: 20, right: 20, display: 'flex', gap: 8 }}>
                  {brief && !brief.error && (
                    <button
                      onClick={() => window.print()}
                      className="ghost-btn"
                      style={{
                        background: 'rgba(255,255,255,0.1)', color: 'var(--cream)',
                        fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                        padding: '7px 12px', borderRadius: 2,
                      }}
                    >
                      Print Brief
                    </button>
                  )}
                  <button
                    onClick={() => { setSelected(null); setBrief(null) }}
                    style={{
                      background: 'var(--lavender)', border: 'none', cursor: 'pointer',
                      color: '#1c1a22', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                      padding: '7px 12px', borderRadius: 2,
                    }}
                  >
                    Close
                  </button>
                </div>
                <div style={{ position: 'absolute', left: 48, bottom: 20, right: 48 }}>
                  <div style={{ ...label, color: 'var(--lavender)' }}>
                    {selected.account_id ? `No. ${selected.account_id}` : 'Dossier'}
                  </div>
                  <div className="font-display" style={{ fontSize: 34, fontWeight: 600, color: 'var(--cream)', lineHeight: 1.15, marginTop: 6 }}>
                    {selected.name}
                  </div>
                </div>
              </div>
            )}

            <div id="dossier-print-root" style={{ maxWidth: 680, margin: '0 auto', padding: '32px 48px 64px' }}>
              <div className="print-only" style={{ display: 'none' }}>
                <div className="font-display" style={{ fontSize: 26, fontWeight: 600, color: 'var(--ink)' }}>{selected.name}</div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{selected.address}</div>

              <div style={{
                marginTop: 24, paddingBottom: 22, borderBottom: `2px solid ${TIER_COLOR[selected.risk_tier]}`,
                display: 'flex', alignItems: 'baseline', gap: 12,
              }}>
                <span className="font-display" style={{ fontSize: 56, fontWeight: 600, color: TIER_COLOR[selected.risk_tier], lineHeight: 1 }}>
                  {Math.round(selected.risk_score)}
                </span>
                <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>/ 100</span>
                <span style={{
                  marginLeft: 'auto', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase',
                  color: TIER_COLOR[selected.risk_tier], fontWeight: 700,
                }}>
                  {selected.risk_tier} risk
                </span>
              </div>

              {briefLoading && (
                <div style={{ marginTop: 24, fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft)' }}>
                  Compiling dossier…
                </div>
              )}

              {brief && !brief.error && (
                <>
                  <p className="font-display" style={{ fontSize: 18, lineHeight: 1.65, marginTop: 26, color: 'var(--ink)', maxWidth: '60ch' }}>
                    {brief.summary}
                  </p>

                  {brief.next_steps && Object.keys(brief.next_steps).length > 0 && (
                    <div style={{ marginTop: 32 }}>
                      <div style={label}>Tailored Next Steps</div>
                      <div style={{ marginTop: 14 }}>
                        {Object.entries(brief.next_steps).map(([audience, text]) => (
                          <div key={audience} style={{ padding: '11px 0', borderTop: '1px solid var(--rule)' }}>
                            <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--lavender)', fontWeight: 700 }}>
                              {audience}
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 4, lineHeight: 1.5 }}>{text}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 34, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 44 }}>
                    <div>
                      <div style={label}>Signals</div>
                      <div style={{ marginTop: 14 }}>
                        {Object.entries(brief.signals).map(([name, value]) => (
                          <SignalBar key={name} name={name} value={value} />
                        ))}
                      </div>
                    </div>

                    <div>
                      <div style={label}>Resources</div>
                      <div style={{ marginTop: 14 }}>
                        {brief.resources.map(r => (
                          <a
                            key={r.name}
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              display: 'block', textDecoration: 'none', color: 'inherit',
                              padding: '10px 0', borderTop: '1px solid var(--rule)',
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{r.name}</div>
                            <div style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--ink-soft)', marginTop: 2 }}>{r.org}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4, lineHeight: 1.4 }}>{r.description}</div>
                            <div style={{ fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 5, color: 'var(--lavender)', fontWeight: 700 }}>Visit →</div>
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {brief && brief.error && (
                <div style={{ marginTop: 24, fontSize: 13, color: 'var(--ink-soft)' }}>
                  Dossier unavailable for this record.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* The single persistent Mapbox instance, positioned over the main stage */}
      <div
        ref={mapEl}
        style={{
          position: 'fixed',
          top: mapRect.top, left: mapRect.left, width: mapRect.width, height: mapRect.height,
          overflow: 'hidden', borderRadius: 3,
          zIndex: 1,
        }}
      />
    </div>
  )
}
