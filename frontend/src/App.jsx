import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

const API_BASE = 'http://localhost:8000/api'
const SIDEBAR_WIDTH = 380
const DRAWER_WIDTH = 480

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

// plain-language explanation of each signal the backend computes
// (routes/businesses.py get_business_brief) — shown on click so the score
// isn't just a number, it's auditable
const SIGNAL_INFO = {
  'Years in operation': "Newer businesses have had less time to build the community roots, staff, and institutional knowledge that make a smooth handoff easier.",
  'Lease expiry risk': "A lease nearing its end without a filed renewal raises the chance the business could be displaced before a successor is found.",
  'Review decline': "A downward trend in review volume or rating is often the earliest public sign of reduced owner engagement or succession stress.",
  'Website staleness': "An outdated or unmaintained web presence suggests the business isn't actively planning for its next chapter.",
  'No SBA enrollment': "Businesses that haven't tapped SBA loan or mentorship programs may be missing support that eases ownership transitions.",
  'Renting (not owner-occupied)': "Owners who rent rather than own their space have less control over long-term continuity, raising succession risk.",
}

// thin, data-journalism-style meter — a hairline track with a tier-colored
// fill; hover (or focus/tap) to reveal what it measures, in a small tooltip
// that floats over the content instead of pushing the rest of the brief down
function SignalBar({ name, value }) {
  const [open, setOpen] = useState(false)
  const color = value >= 0.66 ? '#c0392b' : value >= 0.33 ? '#d9b830' : '#3f8f5f'
  const description = SIGNAL_INFO[name] || 'One of several structural and behavioral indicators used to compute this succession risk score.'
  return (
    <div
      className="signal-row"
      style={{ marginBottom: 12, position: 'relative' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen(v => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'help', padding: 0, font: 'inherit' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--ink)' }}>
            {name}
            <span className="signal-hint">ⓘ</span>
          </span>
          <span className="font-mono" style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>{Math.round(value * 100)}</span>
        </div>
        <div style={{ height: 3, background: 'var(--paper-dim)' }}>
          <div style={{ height: '100%', width: `${value * 100}%`, background: color, transition: 'width 0.5s ease' }} />
        </div>
      </button>
      <div className={`signal-tooltip${open ? ' visible' : ''}`} role="tooltip">
        {description}
      </div>
    </div>
  )
}

export default function App() {
  const mapEl = useRef(null)
  const map = useRef(null)
  const [selected, setSelected] = useState(null)
  const [brief, setBrief] = useState(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [businesses, setBusinesses] = useState([])
  const [stats, setStats] = useState(null)
  const [clusters, setClusters] = useState([])
  const [hotspotsOn, setHotspotsOn] = useState(false)
  const [selectedCluster, setSelectedCluster] = useState(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/businesses?limit=1000`)
      .then(r => r.json())
      .then(setBusinesses)
    fetch(`${API_BASE}/stats`)
      .then(r => r.json())
      .then(setStats)
    fetch(`${API_BASE}/risk-clusters?tier=high`)
      .then(r => r.json())
      .then(d => setClusters(d.clusters))
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

      // Risk hotspots — real DBSCAN clusters computed server-side, not a
      // decorative heatmap gradient. Populated once /api/risk-clusters
      // resolves; starts empty and hidden until the sidebar toggle is on.
      map.current.addSource('risk-clusters', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.current.addLayer({
        id: 'risk-clusters-circles',
        type: 'circle',
        source: 'risk-clusters',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'business_count'], 3, 22, 21, 60],
          'circle-color': '#9b8cd6',
          'circle-opacity': 0.22,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#9b8cd6',
          'circle-stroke-opacity': 0.7,
        },
      })
      map.current.addLayer({
        id: 'risk-clusters-label',
        type: 'symbol',
        source: 'risk-clusters',
        layout: {
          visibility: 'none',
          'text-field': ['get', 'business_count'],
          'text-size': 14,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        },
        paint: { 'text-color': '#fbf9f4' },
      })

      map.current.on('click', 'risk-clusters-circles', e => {
        // Mapbox GL stringifies nested object/array properties on GeoJSON
        // sources (businesses is a list of {name, address, risk_score}) — parse it back.
        const props = e.features[0].properties
        setSelectedCluster({
          ...props,
          businesses: typeof props.businesses === 'string' ? JSON.parse(props.businesses) : props.businesses,
        })
      })
      map.current.on('mouseenter', 'risk-clusters-circles', () => {
        map.current.getCanvas().style.cursor = 'pointer'
      })
      map.current.on('mouseleave', 'risk-clusters-circles', () => {
        map.current.getCanvas().style.cursor = ''
      })
    })
  }, [businesses])

  // Feed the risk-clusters source once both the map and the fetched
  // clusters are ready — they resolve independently and in either order.
  useEffect(() => {
    if (!map.current || !clusters.length) return
    const setData = () => {
      map.current.getSource('risk-clusters')?.setData({
        type: 'FeatureCollection',
        features: clusters.map(c => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.centroid_lng, c.centroid_lat] },
          properties: c,
        })),
      })
    }
    if (map.current.isStyleLoaded()) setData()
    else map.current.once('load', setData)
  }, [clusters])

  useEffect(() => {
    if (!map.current) return
    const visibility = hotspotsOn ? 'visible' : 'none'
    const apply = () => {
      map.current.setLayoutProperty('risk-clusters-circles', 'visibility', visibility)
      map.current.setLayoutProperty('risk-clusters-label', 'visibility', visibility)
    }
    if (map.current.getLayer('risk-clusters-circles')) apply()
    else map.current.once('load', apply)
  }, [hotspotsOn])

  return (
    <div className="app-shell" style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--map-bg)' }}>
      {/* Full-bleed persistent Mapbox instance — the canvas the whole app sits on */}
      <div ref={mapEl} className="no-print" style={{ position: 'fixed', inset: 0, zIndex: 0 }} />

      {/* Sidebar — a bento stack of independent floating glass cards, not one monolithic panel */}
      <div className={`no-print bento-stack${sidebarCollapsed ? ' collapsed' : ''}`} style={{
        position: 'absolute', top: 16, left: 16, bottom: 16, width: SIDEBAR_WIDTH,
        display: 'flex', flexDirection: 'column', gap: 12, zIndex: 2,
        transition: 'transform 0.3s cubic-bezier(.2,.8,.2,1)',
        transform: sidebarCollapsed ? `translateX(calc(-100% - 16px + 44px))` : 'translateX(0)',
      }}>
        <div className="glass-card" style={{ padding: '22px 22px 20px', color: 'var(--cream)', position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            className="ghost-btn collapse-btn"
            style={{
              position: 'absolute', top: 18, right: 16, width: 28, height: 28, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
              color: 'var(--cream)', padding: 0,
            }}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
          <div className="sidebar-fade">
            <div className="font-display gradient-text" style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Handoff
            </div>
            <div style={{ ...label, marginTop: 8, color: 'var(--cream-soft)' }}>Fremont · Succession Risk Atlas</div>

            {stats && (
              <div className="stat-tile" style={{ marginTop: 16 }}>
                <div className="font-mono gradient-text-warm" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>
                  {stats.high_risk_count}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--cream)', marginTop: 6, fontWeight: 600, lineHeight: 1.4 }}>
                  Fremont restaurants at high succession risk
                </div>
                <div style={{ fontSize: 11, color: 'var(--cream-soft)', marginTop: 8, lineHeight: 1.5 }}>
                  ~{stats.estimated_jobs_at_risk.toLocaleString()} jobs · ${(stats.estimated_annual_revenue_at_risk / 1_000_000).toFixed(0)}M/yr could disappear without intervention.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="glass-card sidebar-scroll sidebar-fade" style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {businesses.length === 0 && Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px' }}>
              <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton" style={{ height: 12, width: `${60 + (i % 3) * 10}%`, borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 10, width: '40%', borderRadius: 4, marginTop: 6 }} />
              </div>
            </div>
          ))}
          {businesses.map(b => {
            const isSelected = selected && selected.name === b.name
            return (
              <button
                key={`${b.name}-${b.address}`}
                onClick={() => selectBusiness(b)}
                className="biz-row"
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: 'calc(100% - 16px)', textAlign: 'left',
                  margin: '2px 8px',
                  background: isSelected ? 'rgba(155,140,214,0.18)' : 'transparent',
                  color: 'var(--cream)', font: 'inherit',
                  border: 'none', borderRadius: 12,
                  cursor: 'pointer', padding: '9px 10px',
                  opacity: selected && !isSelected ? 0.42 : 1,
                  transition: 'opacity 0.2s ease, background 0.15s ease, transform 0.15s ease',
                }}
              >
                <img
                  src={photoUrl(b.name, 96)}
                  alt=""
                  loading="lazy"
                  onError={e => { e.target.style.visibility = 'hidden' }}
                  onLoad={e => { e.target.style.opacity = 1 }}
                  style={{ width: 42, height: 42, objectFit: 'cover', borderRadius: 10, flexShrink: 0, background: 'var(--paper-dim)', opacity: 0 }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                    <span style={{
                      fontSize: 13, fontWeight: 600, color: '#fbf9f4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{b.name}</span>
                    <span className={`tier-badge tier-badge-${b.risk_tier}`}>
                      <span className="font-mono">{Math.round(b.risk_score)}</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--cream-soft)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.address}</div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="glass-card sidebar-fade" style={{ padding: '16px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            {['high', 'medium', 'low'].map(tier => (
              <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: TIER_COLOR[tier] }} />
                <span style={{ fontSize: 12, color: 'var(--cream-soft)' }}>{TIER_LABEL[tier]}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setHotspotsOn(v => !v)}
            className="ghost-btn hotspot-toggle"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 14,
              background: hotspotsOn ? 'rgba(155,140,214,0.2)' : 'rgba(255,255,255,0.04)',
              borderColor: hotspotsOn ? 'var(--lavender)' : 'rgba(255,255,255,0.08)',
              color: 'var(--cream)', fontSize: 12, fontWeight: 600,
              padding: '10px 12px', borderRadius: 10,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#9b8cd6', flexShrink: 0 }} />
            {hotspotsOn ? 'Hide' : 'Show'} risk hotspot corridors
            {clusters.length > 0 && (
              <span className="font-mono" style={{ marginLeft: 'auto', color: 'var(--cream-soft)', fontWeight: 500 }}>{clusters.length}</span>
            )}
          </button>
          <a
            href="/top-at-risk"
            target="_blank"
            rel="noreferrer"
            className="top-link"
            style={{
              display: 'block', marginTop: 12, fontSize: 11.5, fontWeight: 600,
              color: 'var(--lavender)', textDecoration: 'none', letterSpacing: '0.02em',
            }}
          >
            View shareable Top 10 <span className="top-link-arrow">→</span>
          </a>
        </div>
      </div>

      {/* Dossier — slides in from the right as a floating drawer, leaving the map visible underneath */}
      <div className={`dossier-drawer paper-scroll${selected ? ' open' : ''}`} style={{
        position: 'absolute', top: 16, right: 16, bottom: 16, width: DRAWER_WIDTH,
        background: 'var(--paper)', overflowY: 'auto',
        borderRadius: 22, boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
        zIndex: 3,
        transform: selected ? 'translateX(0)' : `translateX(calc(100% + 32px))`,
        transition: 'transform 0.4s cubic-bezier(.2,.8,.2,1)',
      }}>
        {selected && (
          <>
            {selected.name && (
              <div className="no-print" style={{ position: 'relative', height: 200, background: 'var(--paper-dim)' }}>
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
                <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
                  {brief && !brief.error && (
                    <button
                      onClick={() => window.print()}
                      className="ghost-btn"
                      style={{
                        background: 'rgba(255,255,255,0.1)', color: 'var(--cream)',
                        fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                        padding: '7px 12px', borderRadius: 6,
                      }}
                    >
                      Print Brief
                    </button>
                  )}
                  <button
                    onClick={() => { setSelected(null); setBrief(null) }}
                    className="solid-btn"
                    style={{
                      background: 'var(--lavender)', border: 'none', cursor: 'pointer',
                      color: '#1c1a22', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                      padding: '7px 12px', borderRadius: 6,
                    }}
                  >
                    Close
                  </button>
                </div>
                <div style={{ position: 'absolute', left: 28, bottom: 18, right: 28 }}>
                  <div style={{ ...label, color: 'var(--lavender)' }}>
                    {selected.account_id ? `No. ${selected.account_id}` : 'Dossier'}
                  </div>
                  <div className="font-display" style={{ fontSize: 26, fontWeight: 600, color: 'var(--cream)', lineHeight: 1.15, marginTop: 6 }}>
                    {selected.name}
                  </div>
                </div>
              </div>
            )}

            <div id="dossier-print-root" style={{ padding: '28px 32px 48px' }}>
              <div className="print-only" style={{ display: 'none' }}>
                <div className="font-display" style={{ fontSize: 26, fontWeight: 600, color: 'var(--ink)' }}>{selected.name}</div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{selected.address}</div>

              <div style={{
                marginTop: 20, paddingBottom: 18, borderBottom: `2px solid ${TIER_COLOR[selected.risk_tier]}`,
                display: 'flex', alignItems: 'baseline', gap: 12, position: 'relative',
              }}>
                <span
                  className="font-display score-glow"
                  style={{
                    fontSize: 48, fontWeight: 700, color: TIER_COLOR[selected.risk_tier], lineHeight: 1,
                    '--glow-color': TIER_COLOR[selected.risk_tier],
                  }}
                >
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
                <div style={{ marginTop: 22, fontSize: 13, fontStyle: 'italic', color: 'var(--ink-soft)' }}>
                  Compiling dossier…
                </div>
              )}

              {brief && !brief.error && (
                <>
                  <p className="font-display" style={{ fontSize: 17, lineHeight: 1.6, marginTop: 22, color: 'var(--ink)' }}>
                    {brief.summary}
                  </p>

                  {brief.next_steps && Object.keys(brief.next_steps).length > 0 && (
                    <div style={{ marginTop: 28 }}>
                      <div style={label}>Tailored Next Steps</div>
                      <div style={{ marginTop: 12 }}>
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

                  <div style={{ marginTop: 30 }}>
                    <div style={label}>Signals</div>
                    <div style={{ marginTop: 12 }}>
                      {Object.entries(brief.signals).map(([name, value]) => (
                        <SignalBar key={name} name={name} value={value} />
                      ))}
                    </div>
                  </div>

                  <div style={{ marginTop: 30 }}>
                    <div style={label}>Resources</div>
                    <div style={{ marginTop: 12 }}>
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
                </>
              )}

              {brief && brief.error && (
                <div style={{ marginTop: 22, fontSize: 13, color: 'var(--ink-soft)' }}>
                  Dossier unavailable for this record.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Risk hotspot cluster popup — floats bottom-right, clear of the sidebar */}
      {!selected && selectedCluster && (
        <div className="no-print fade-up" style={{
          position: 'absolute', right: 16, bottom: 16, width: 340, maxHeight: '60%',
          background: 'var(--paper)', borderRadius: 20, boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
          zIndex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          <div style={{ padding: '16px 18px', borderBottom: '2px solid var(--lavender)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={label}>Risk Hotspot Corridor</div>
                <div className="font-display" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>
                  {selectedCluster.business_count} businesses
                </div>
              </div>
              <button
                onClick={() => setSelectedCluster(null)}
                className="ghost-btn"
                style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '5px 9px', borderRadius: 6 }}
              >
                Close
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, lineHeight: 1.5 }}>
              Avg risk score {selectedCluster.avg_risk_score} · an estimated {selectedCluster.estimated_jobs_at_risk} jobs
              and ${(selectedCluster.estimated_annual_revenue_at_risk / 1_000_000).toFixed(1)}M/yr concentrated within a short walk.
            </div>
          </div>
          <div className="paper-scroll" style={{ overflowY: 'auto', padding: '4px 18px' }}>
            {selectedCluster.businesses.map(b => (
              <div key={`${b.name}-${b.address}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderTop: '1px solid var(--rule)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.address}</div>
                </div>
                <div className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: TIER_COLOR.high, flexShrink: 0 }}>{Math.round(b.risk_score)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
