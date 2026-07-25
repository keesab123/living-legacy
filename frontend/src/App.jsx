import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

const API_BASE = 'http://localhost:8000/api'
const SIDEBAR_WIDTH = 380
const DRAWER_WIDTH = 480

const TIER_COLOR = {
  high: '#a13328',
  medium: '#b8863a',
  low: '#4a6b48',
}

const TIER_LABEL = { high: 'High', medium: 'Medium', low: 'Low' }
const COHORT_ACCENT = '#c98f4f'
const WEIGHTS_ACCENT = '#7a9e5f'
const CLOSED_COLOR = '#241d14'

// Timelapse — a forward-looking scenario, not a forecast. Each business's
// current risk score becomes an annual closure hazard; a seeded per-business
// RNG (stable across reloads, so the demo tells the same story every time)
// draws whether/when it closes within the horizon. Purely illustrative: the
// hazard curve is invented to make the *shape* of concentrated risk visible,
// not a claim about any specific business's odds.
const TIMELAPSE_START_YEAR = new Date().getFullYear()
const TIMELAPSE_HORIZON_YEARS = 10
const TIMELAPSE_END_YEAR = TIMELAPSE_START_YEAR + TIMELAPSE_HORIZON_YEARS

function hashStringToInt(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function annualHazard(riskScore) {
  const s = riskScore / 100
  return Math.min(0.35, Math.max(0.01, s * s * 0.35))
}

// Sentinel rather than null for "survives the horizon" — keeps the mapbox-gl
// paint expression's inferred property type a plain number across every
// feature, since a null/number mix fails its expression type-checker.
const NEVER_CLOSES = 9999

function simulateClosureYear(key, riskScore) {
  const rng = mulberry32(hashStringToInt(key) ^ 0x9e3779b9)
  const hazard = annualHazard(riskScore)
  for (let offset = 1; offset <= TIMELAPSE_HORIZON_YEARS; offset++) {
    if (rng() < hazard) return TIMELAPSE_START_YEAR + offset
  }
  return NEVER_CLOSES
}

// Weight sandbox — mirrors backend/scoring/risk_scorer.py's Weights
// defaults and tier thresholds exactly, so "reset" reproduces the server's
// real score. Recomputed client-side from the raw signal_* values the
// /api/businesses list already ships, no extra round trip per slider drag.
const DEFAULT_WEIGHTS = {
  years_in_operation: 25,
  lease_expiry: 20,
  review_decline: 20,
  website_staleness: 15,
  no_sba_enrollment: 10,
  renting: 10,
}
const WEIGHT_META = [
  { key: 'years_in_operation', label: 'Years in operation', signalKey: 'signal_years_in_operation' },
  { key: 'lease_expiry', label: 'Lease expiry risk', signalKey: 'signal_lease_expiry' },
  { key: 'review_decline', label: 'Review decline', signalKey: 'signal_review_decline' },
  { key: 'website_staleness', label: 'Website staleness', signalKey: 'signal_website_staleness' },
  { key: 'no_sba_enrollment', label: 'No SBA enrollment', signalKey: 'signal_no_sba_enrollment' },
  { key: 'renting', label: 'Renting (not owner-occupied)', signalKey: 'signal_renting' },
]

function computeWeightedTier(business, weights) {
  const totalWeight = WEIGHT_META.reduce((sum, m) => sum + weights[m.key], 0) || 1
  const weighted = WEIGHT_META.reduce((sum, m) => sum + (business[m.signalKey] ?? 0) * weights[m.key], 0) / totalWeight
  const risk_score = Math.round(weighted * 1000) / 10
  const risk_tier = weighted >= 0.42 ? 'high' : weighted >= 0.32 ? 'medium' : 'low'
  return { risk_score, risk_tier }
}

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
  'Years in operation': "The longer a business has run under the same owner, the more likely that owner is nearing retirement without a succession plan lined up.",
  'Lease expiry risk': "If the lease is about to run out and there's no renewal on file, the business could get displaced before anyone finds a successor.",
  'Review decline': "A drop in reviews or ratings is usually the first public sign that the owner is checking out.",
  'Website staleness': "A site nobody's updated in years usually means the owner isn't planning for what comes next.",
  'No SBA enrollment': "Businesses that haven't used an SBA loan or mentorship program might be missing support that makes ownership transitions easier.",
  'Renting (not owner-occupied)': "Renting instead of owning the property means less control over what happens to the business long term.",
}

// thin, data-journalism-style meter — a hairline track with a tier-colored
// fill; hover (or focus/tap) to reveal what it measures, in a small tooltip
// that floats over the content instead of pushing the rest of the brief down
function SignalBar({ name, value }) {
  const [open, setOpen] = useState(false)
  const color = value >= 0.66 ? '#a13328' : value >= 0.33 ? '#b8863a' : '#4a6b48'
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

function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(isoString).toLocaleDateString()
}

// Local intel a scrape can't pick up — a regular mentioning the owner's
// retiring, a For Sale sign going up. Stored separately from the scored
// CSV (routes/comments.py) so it survives every pipeline re-run.
function CommentSection({ businessName }) {
  const [comments, setComments] = useState(null)
  const [author, setAuthor] = useState('')
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setComments(null)
    fetch(`${API_BASE}/businesses/comments?business_name=${encodeURIComponent(businessName)}`)
      .then(r => { if (!r.ok) throw new Error('failed'); return r.json() })
      .then(data => setComments(Array.isArray(data) ? data : []))
      .catch(() => setComments([]))
  }, [businessName])

  const submit = (e) => {
    e.preventDefault()
    if (!text.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    fetch(`${API_BASE}/businesses/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name: businessName, author: author.trim() || undefined, text: text.trim() }),
    })
      .then(r => { if (!r.ok) throw new Error('failed'); return r.json() })
      .then(created => {
        setComments(prev => [created, ...(prev || [])])
        setText('')
      })
      .catch(() => setError("Couldn't post that. Try again."))
      .finally(() => setSubmitting(false))
  }

  return (
    <div style={{ marginTop: 30 }}>
      <div style={label}>What locals are saying</div>
      <p style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 8, lineHeight: 1.4 }}>
        Heard something a scrape wouldn't catch, like a for-sale sign or the owner mentioning retirement? Add it here.
      </p>

      <form onSubmit={submit} style={{ marginTop: 14 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          maxLength={500}
          placeholder="Share what you know…"
          rows={3}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical', font: 'inherit', fontSize: 13,
            padding: '8px 10px', border: '1px solid var(--rule)', borderRadius: 3,
            background: 'var(--paper-dim)', color: 'var(--ink)',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <input
            value={author}
            onChange={e => setAuthor(e.target.value)}
            maxLength={80}
            placeholder="Name (optional)"
            style={{
              flex: 1, font: 'inherit', fontSize: 12.5, padding: '7px 10px',
              border: '1px solid var(--rule)', borderRadius: 3, background: 'var(--paper-dim)', color: 'var(--ink)',
            }}
          />
          <button
            type="submit"
            disabled={!text.trim() || submitting}
            className="ghost-btn"
            style={{
              background: 'var(--ink)', color: 'var(--paper)', fontWeight: 700,
              fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '9px 14px', borderRadius: 2, flexShrink: 0,
              opacity: !text.trim() || submitting ? 0.5 : 1,
              cursor: !text.trim() || submitting ? 'default' : 'pointer',
            }}
          >
            {submitting ? 'Posting…' : 'Post'}
          </button>
        </div>
        {error && <div style={{ fontSize: 11.5, color: TIER_COLOR.high, marginTop: 6 }}>{error}</div>}
      </form>

      <div style={{ marginTop: 16 }}>
        {comments === null && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Loading…</div>
        )}
        {comments && comments.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontStyle: 'italic' }}>Nobody's said anything yet. Be the first.</div>
        )}
        {comments && comments.map(c => (
          <div key={c.id} style={{ padding: '11px 0', borderTop: '1px solid var(--rule)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-soft)' }}>
              <span style={{ fontWeight: 700 }}>{c.author}</span>
              <span>{timeAgo(c.created_at)}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginTop: 4, lineHeight: 1.5 }}>{c.text}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const mapEl = useRef(null)
  const map = useRef(null)
  const flyToTimeout = useRef(null)
  const [selected, setSelected] = useState(null)
  const [brief, setBrief] = useState(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [businesses, setBusinesses] = useState([])
  const [stats, setStats] = useState(null)
  const [clusters, setClusters] = useState([])
  const [hotspotsOn, setHotspotsOn] = useState(false)
  const [selectedCluster, setSelectedCluster] = useState(null)
  const [cohorts, setCohorts] = useState([])
  const [citywidePctHigh, setCitywidePctHigh] = useState(null)
  const [cohortPanelOpen, setCohortPanelOpen] = useState(false)
  const [selectedCohort, setSelectedCohort] = useState(null)
  const [timelapseYear, setTimelapseYear] = useState(TIMELAPSE_START_YEAR)
  const [timelapsePlaying, setTimelapsePlaying] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS)
  const [weightsPanelOpen, setWeightsPanelOpen] = useState(false)
  const isCustomWeights = WEIGHT_META.some(m => weights[m.key] !== DEFAULT_WEIGHTS[m.key])

  // Re-scored with whatever the weight sliders currently say, using the raw
  // signal_* values every business already carries. Identity when the
  // sliders are at their defaults, so nothing changes until you touch one.
  const customBusinesses = useMemo(() => {
    if (!isCustomWeights) return businesses
    return businesses
      .map(b => ({ ...b, ...computeWeightedTier(b, weights) }))
      .sort((a, b) => b.risk_score - a.risk_score)
  }, [businesses, weights, isCustomWeights])

  // Each business's simulated closure year, computed once per fetch — stable
  // across scrubbing/play so the same dots vanish in the same order every time.
  const simulatedBusinesses = useMemo(() => (
    customBusinesses.map(b => ({
      ...b,
      sim_closure_year: simulateClosureYear(`${b.name}|${b.address}`, b.risk_score),
    }))
  ), [customBusinesses])

  const timelapseClosedCount = useMemo(() => (
    simulatedBusinesses.filter(b => b.sim_closure_year <= timelapseYear).length
  ), [simulatedBusinesses, timelapseYear])

  // Each hotspot corridor's open-business count as of the current timelapse
  // year — the corridor's own risk_score/tier come from the live pipeline,
  // not the sandbox, so this only ever reacts to the timelapse, not the
  // weight sliders. A corridor with 0 open businesses fades out entirely.
  const timelapseClusters = useMemo(() => {
    if (!clusters.length) return clusters
    const closureByKey = new Map(simulatedBusinesses.map(b => [`${b.name}|${b.address}`, b.sim_closure_year]))
    return clusters.map(c => {
      const openCount = c.businesses.filter(b => {
        const closureYear = closureByKey.get(`${b.name}|${b.address}`)
        return closureYear == null || closureYear > timelapseYear
      }).length
      return { ...c, open_count: openCount }
    })
  }, [clusters, simulatedBusinesses, timelapseYear])

  const filteredBusinesses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return customBusinesses
    return customBusinesses.filter(b => b.name.toLowerCase().includes(q) || b.address.toLowerCase().includes(q))
  }, [customBusinesses, searchQuery])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

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
    fetch(`${API_BASE}/cohorts`)
      .then(r => r.json())
      .then(d => { setCohorts(d.cohorts); setCitywidePctHigh(d.citywide_pct_high_risk) })
  }, [])

  const selectBusiness = (props) => {
    setSelected(props)
    setBrief(null)
    setBriefLoading(true)
    setPhotoOpen(false)
    fetch(`${API_BASE}/businesses/brief?name=${encodeURIComponent(props.name)}`)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json() })
      .then(setBrief)
      .catch(() => setBrief({ error: true }))
      .finally(() => setBriefLoading(false))
    if (map.current && props.lat && props.lng) {
      clearTimeout(flyToTimeout.current)
      // Opening the drawer resizes the map column (width 0 -> DRAWER_WIDTH
      // over 300ms), and mapbox's own resize keeps re-centering on whatever
      // point is current *during* that animation. Centering immediately, in
      // the same tick as the resize starts, means flyTo and the resize fight
      // over the center and the dot lands off to the side. Wait for the
      // drawer's CSS transition to finish, then center on the now-final
      // canvas size.
      flyToTimeout.current = setTimeout(() => {
        map.current.flyTo({ center: [props.lng, props.lat], zoom: 15, duration: 600 })
      }, 320)
    }
  }

  useEffect(() => {
    if (map.current || !simulatedBusinesses.length) return

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
        features: simulatedBusinesses
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
          // A closed dot fades and shrinks out instead of snapping away —
          // matters most during timelapse playback, where paint properties
          // change every tick.
          'circle-opacity-transition': { duration: 700 },
          'circle-radius-transition': { duration: 700 },
          'circle-stroke-opacity-transition': { duration: 700 },
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

      // A hollow ring around whichever dot is selected — flyTo re-centers
      // the map, but on a dense block of dots centering alone doesn't tell
      // you *which* one is the case file that just opened.
      map.current.addSource('selected-business', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.current.addLayer({
        id: 'selected-ring',
        type: 'circle',
        source: 'selected-business',
        paint: {
          'circle-radius': 14,
          'circle-color': 'transparent',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#f1e6cd',
          'circle-stroke-opacity': 0,
          'circle-radius-transition': { duration: 900 },
          'circle-stroke-opacity-transition': { duration: 300 },
        },
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
          // Sized and faded by open_count, not the static business_count —
          // a corridor shrinks and fades as the timelapse closes the
          // businesses inside it, so the whole corridor empties out
          // together instead of just the individual dots underneath it.
          'circle-radius': ['interpolate', ['linear'], ['get', 'open_count'], 3, 22, 21, 60],
          'circle-color': '#6f93a0',
          'circle-opacity': ['case', ['==', ['get', 'open_count'], 0], 0, 0.22],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#6f93a0',
          'circle-stroke-opacity': ['case', ['==', ['get', 'open_count'], 0], 0, 0.7],
          'circle-radius-transition': { duration: 700 },
          'circle-opacity-transition': { duration: 700 },
          'circle-stroke-opacity-transition': { duration: 700 },
        },
      })
      map.current.addLayer({
        id: 'risk-clusters-label',
        type: 'symbol',
        source: 'risk-clusters',
        layout: {
          visibility: 'none',
          'text-field': ['get', 'open_count'],
          'text-size': 14,
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        },
        paint: {
          'text-color': '#fbf9f4',
          'text-opacity': ['case', ['==', ['get', 'open_count'], 0], 0, 1],
          'text-opacity-transition': { duration: 700 },
        },
      })

      map.current.on('click', 'risk-clusters-circles', e => {
        // Mapbox GL stringifies nested object/array properties on GeoJSON
        // sources (businesses is a list of {name, address, risk_score}) — parse it back.
        const props = e.features[0].properties
        setSelectedCluster({
          ...props,
          businesses: typeof props.businesses === 'string' ? JSON.parse(props.businesses) : props.businesses,
        })
        setCohortPanelOpen(false)
        setWeightsPanelOpen(false)
      })
      map.current.on('mouseenter', 'risk-clusters-circles', () => {
        map.current.getCanvas().style.cursor = 'pointer'
      })
      map.current.on('mouseleave', 'risk-clusters-circles', () => {
        map.current.getCanvas().style.cursor = ''
      })
    })
  }, [simulatedBusinesses])

  // The map-init effect above only runs once (it bails out as soon as
  // map.current exists), so it never sees later changes to
  // simulatedBusinesses — weight-slider or timelapse-driven risk_tier/score
  // changes need their own push to the live source, same pattern as the
  // risk-clusters source below.
  useEffect(() => {
    if (!map.current) return
    const source = map.current.getSource('businesses')
    if (!source) return
    source.setData({
      type: 'FeatureCollection',
      features: simulatedBusinesses
        .filter(b => b.lat && b.lng)
        .map(b => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
          properties: b,
        })),
    })
  }, [simulatedBusinesses])

  // Feed the risk-clusters source once both the map and the fetched
  // clusters are ready — they resolve independently and in either order.
  // Also re-feeds whenever the timelapse advances, since open_count above
  // is what actually drives the corridor's radius/opacity on the map.
  useEffect(() => {
    if (!map.current || !timelapseClusters.length) return
    const setData = () => {
      map.current.getSource('risk-clusters')?.setData({
        type: 'FeatureCollection',
        features: timelapseClusters.map(c => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.centroid_lng, c.centroid_lat] },
          properties: c,
        })),
      })
    }
    if (map.current.isStyleLoaded()) setData()
    else map.current.once('load', setData)
  }, [timelapseClusters])

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

  // Combined repaint — community lens and timelapse both recolor the same
  // layer, so they're driven from one effect to avoid one clobbering the
  // other. Timelapse takes precedence: a closed dot shrinks to nothing
  // regardless of which cohort is highlighted.
  useEffect(() => {
    if (!map.current) return
    const closedCondition = ['<=', ['get', 'sim_closure_year'], timelapseYear]
    // "zoom" is only valid as the direct input of a top-level step/interpolate
    // expression — it can't be nested inside a "case". So the closed check has
    // to live *inside* each interpolate stop (as the stop's output), not wrap
    // the interpolate itself.
    const radius = [
      'interpolate', ['linear'], ['zoom'],
      9, ['case', closedCondition, 0, ['match', ['get', 'risk_tier'], 'high', 3.5, 'medium', 2.75, 2.25]],
      13, ['case', closedCondition, 0, ['match', ['get', 'risk_tier'], 'high', 8, 'medium', 5.5, 4]],
      16, ['case', closedCondition, 0, ['match', ['get', 'risk_tier'], 'high', 12, 'medium', 8, 6]],
    ]
    const liveColor = selectedCohort
      ? ['case', ['==', ['get', 'cuisine_cohort'], selectedCohort], COHORT_ACCENT, '#3a352c']
      : ['match', ['get', 'risk_tier'], 'high', TIER_COLOR.high, 'medium', TIER_COLOR.medium, 'low', TIER_COLOR.low, '#8a8578']
    const liveOpacity = selectedCohort
      ? ['case', ['==', ['get', 'cuisine_cohort'], selectedCohort], 0.95, 0.18]
      : 0.95

    const apply = () => {
      map.current.setPaintProperty('businesses-circles', 'circle-radius', radius)
      map.current.setPaintProperty('businesses-circles', 'circle-color', ['case', closedCondition, CLOSED_COLOR, liveColor])
      map.current.setPaintProperty('businesses-circles', 'circle-opacity', ['case', closedCondition, 0, liveOpacity])
      map.current.setPaintProperty('businesses-circles', 'circle-stroke-opacity', ['case', closedCondition, 0, 1])
    }
    if (map.current.getLayer('businesses-circles')) apply()
    else map.current.once('load', apply)
  }, [selectedCohort, timelapseYear])

  // The map now lives in a real flex column (not a full-viewport overlay),
  // so its container's pixel size changes whenever the left panel collapses
  // or the right drawer opens/closes — mapbox-gl doesn't detect that on its
  // own and needs an explicit resize() or the canvas goes stale/blurry.
  useEffect(() => {
    if (!mapEl.current) return
    const ro = new ResizeObserver(() => map.current?.resize())
    ro.observe(mapEl.current)
    return () => ro.disconnect()
  }, [])

  // Move the selected-business ring to whichever dot is open (or clear it).
  useEffect(() => {
    if (!map.current) return
    const apply = () => {
      const source = map.current.getSource('selected-business')
      if (!source) return
      if (selected && selected.lat && selected.lng) {
        source.setData({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [selected.lng, selected.lat] }, properties: {} }],
        })
        map.current.setPaintProperty('selected-ring', 'circle-stroke-opacity', 0.9)
      } else {
        source.setData({ type: 'FeatureCollection', features: [] })
        map.current.setPaintProperty('selected-ring', 'circle-stroke-opacity', 0)
      }
    }
    if (map.current.getLayer('selected-ring')) apply()
    else map.current.once('load', apply)
  }, [selected])

  // A slow pulse on the ring while a dossier is open — draws the eye without
  // being distracting; stops the moment nothing is selected.
  useEffect(() => {
    if (!selected || !map.current) return
    let big = false
    const id = setInterval(() => {
      big = !big
      if (map.current?.getLayer('selected-ring')) {
        map.current.setPaintProperty('selected-ring', 'circle-radius', big ? 20 : 14)
      }
    }, 900)
    return () => clearInterval(id)
  }, [selected])

  // Auto-advance while playing; stop at the horizon.
  useEffect(() => {
    if (!timelapsePlaying) return
    if (timelapseYear >= TIMELAPSE_END_YEAR) { setTimelapsePlaying(false); return }
    const id = setTimeout(() => setTimelapseYear(y => Math.min(y + 1, TIMELAPSE_END_YEAR)), 1100)
    return () => clearTimeout(id)
  }, [timelapsePlaying, timelapseYear])

  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--map-bg)' }}>
      {/* TOP BAR — brand + citywide headline stats, pinned above the three-column body */}
      <div className="no-print" style={{
        flexShrink: 0, height: 58, display: 'flex', alignItems: 'center', gap: 18,
        padding: '0 20px', background: 'var(--sidebar)',
        borderBottom: '1px solid rgba(233,214,173,0.14)', zIndex: 4, position: 'relative',
      }}>
        <div className="font-display gradient-text" style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--cream)', flexShrink: 0 }}>
          Keep Fremont Open
        </div>
        <div style={{ ...label, color: 'var(--cream-soft)', flexShrink: 0 }}>Succession Risk Atlas</div>
        <button
          onClick={() => setAboutOpen(v => !v)}
          className="ghost-btn"
          style={{
            width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 12, padding: 0, flexShrink: 0,
            color: 'var(--cream-soft)', border: '1px solid rgba(233,214,173,0.2)',
          }}
          aria-label="About this project"
        >
          ⓘ
        </button>
        <div style={{ flex: 1 }} />
        {stats && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 12, color: 'var(--cream-soft)', flexShrink: 0 }}>
            <span><span className="font-mono gradient-text-warm" style={{ fontWeight: 700, fontSize: 15 }}>{stats.high_risk_count}</span> high-risk</span>
            <span>~{stats.estimated_jobs_at_risk.toLocaleString()} jobs at risk</span>
            <span>${(stats.estimated_annual_revenue_at_risk / 1_000_000).toFixed(0)}M/yr at risk</span>
          </div>
        )}
      </div>

      {/* About — collapsed by default so the pitch never competes with the
          map; opens as a small dropdown right under the info button. */}
      {aboutOpen && (
        <div
          className="no-print fade-up"
          onClick={() => setAboutOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 10, background: 'rgba(20,16,10,0.5)' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute', top: 68, left: 20, width: 420, maxWidth: 'calc(100vw - 40px)',
              background: 'var(--paper)', borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
              padding: '20px 22px',
            }}
          >
            <div style={label}>About</div>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 10, color: 'var(--ink)' }}>
              Hundreds of immigrant-owned restaurants in Fremont will disappear over the next decade.
              Not because they failed, but because the ownership transition fails. Parents retire or pass
              away, their kids became engineers instead of taking over the business, and nobody outside
              the family ever knew it was available. No buyer, no handoff, no warning.
            </p>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, marginTop: 10, color: 'var(--ink)' }}>
              This map pulls together city license records and live restaurant data to flag succession
              risk before a closure happens. Each business gets tailored next steps: for city staff,
              community orgs, potential buyers, and the owner.
            </p>
            <button
              onClick={() => setAboutOpen(false)}
              className="ghost-btn"
              style={{
                marginTop: 14, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                padding: '7px 12px', borderRadius: 4, color: 'var(--ink)',
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* BODY — left registry panel / map canvas / right case-file drawer */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>

        {/* LEFT PANEL — scrollable registry list, collapsible to a thin rail */}
        <div className="no-print" style={{
          width: sidebarCollapsed ? 44 : SIDEBAR_WIDTH, flexShrink: 0, position: 'relative',
          background: 'var(--sidebar)', borderRight: '1px solid rgba(233,214,173,0.14)',
          overflow: 'hidden', transition: 'width 0.25s cubic-bezier(.2,.8,.2,1)',
        }}>
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            className="ghost-btn collapse-btn"
            style={{
              position: 'absolute', top: 12, right: 8, width: 28, height: 28, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
              color: 'var(--cream)', padding: 0, zIndex: 2,
            }}
            aria-label={sidebarCollapsed ? 'Expand list' : 'Collapse list'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>

          <div style={{
            width: SIDEBAR_WIDTH, height: '100%', display: 'flex', flexDirection: 'column',
            opacity: sidebarCollapsed ? 0 : 1, transition: 'opacity 0.15s ease',
            pointerEvents: sidebarCollapsed ? 'none' : 'auto',
          }}>
            <div style={{ padding: '16px 44px 12px 20px', flexShrink: 0, borderBottom: '1px solid rgba(233,214,173,0.1)' }}>
              <div style={{ ...label, color: 'var(--lavender)' }}>Registry</div>
              <div style={{ fontSize: 13, color: 'var(--cream)', marginTop: 4, fontWeight: 600 }}>
                {searchQuery.trim() ? `${filteredBusinesses.length} of ${businesses.length}` : (businesses.length || '—')} Fremont restaurants tracked
              </div>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name or address…"
                style={{
                  width: '100%', marginTop: 10, font: 'inherit', fontSize: 12.5, padding: '8px 10px',
                  border: '1px solid rgba(233,214,173,0.16)', borderRadius: 6,
                  background: 'rgba(255,255,255,0.04)', color: 'var(--cream)',
                }}
              />
            </div>

            <div className="sidebar-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {businesses.length === 0 && Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px' }}>
                  <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ height: 12, width: `${60 + (i % 3) * 10}%`, borderRadius: 4 }} />
                    <div className="skeleton" style={{ height: 10, width: '40%', borderRadius: 4, marginTop: 6 }} />
                  </div>
                </div>
              ))}
              {businesses.length > 0 && filteredBusinesses.length === 0 && (
                <div style={{ padding: '16px 20px', fontSize: 12.5, color: 'var(--cream-soft)', fontStyle: 'italic' }}>
                  No businesses match "{searchQuery}".
                </div>
              )}
              {filteredBusinesses.map(b => {
                const isSelected = selected && selected.name === b.name
                return (
                  <button
                    key={`${b.name}-${b.address}`}
                    onClick={() => selectBusiness(b)}
                    className="biz-row"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, width: 'calc(100% - 16px)', textAlign: 'left',
                      margin: '2px 8px',
                      background: isSelected ? 'rgba(111,147,160,0.18)' : 'transparent',
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
                      <div className="ledger-row">
                        <span style={{
                          fontSize: 13, fontWeight: 600, color: '#fbf9f4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1,
                        }}>{b.name}</span>
                        <span className="ledger-leader" />
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

            <div style={{ padding: '14px 20px', flexShrink: 0, borderTop: '1px solid rgba(233,214,173,0.1)' }}>
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
                  background: hotspotsOn ? 'rgba(111,147,160,0.2)' : 'rgba(255,255,255,0.04)',
                  borderColor: hotspotsOn ? 'var(--lavender)' : 'rgba(255,255,255,0.08)',
                  color: 'var(--cream)', fontSize: 12, fontWeight: 600,
                  padding: '10px 12px', borderRadius: 10,
                }}
              >
                {hotspotsOn ? 'Hide' : 'Show'} risk hotspot corridors
                <span className="font-mono" style={{ marginLeft: 'auto', color: 'var(--cream-soft)', fontWeight: 500 }}>→</span>
              </button>
              <button
                onClick={() => {
                  setCohortPanelOpen(v => {
                    if (v) setSelectedCohort(null)
                    return !v
                  })
                  setSelectedCluster(null)
                  setWeightsPanelOpen(false)
                }}
                className="ghost-btn hotspot-toggle"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 8,
                  background: cohortPanelOpen ? 'rgba(201,143,79,0.2)' : 'rgba(255,255,255,0.04)',
                  borderColor: cohortPanelOpen ? COHORT_ACCENT : 'rgba(255,255,255,0.08)',
                  color: 'var(--cream)', fontSize: 12, fontWeight: 600,
                  padding: '10px 12px', borderRadius: 10,
                }}
              >
                {cohortPanelOpen ? 'Hide' : 'View'} risk by community
                <span className="font-mono" style={{ marginLeft: 'auto', color: 'var(--cream-soft)', fontWeight: 500 }}>→</span>
              </button>
              <button
                onClick={() => {
                  setWeightsPanelOpen(v => !v)
                  setCohortPanelOpen(false)
                  setSelectedCohort(null)
                  setSelectedCluster(null)
                }}
                className="ghost-btn hotspot-toggle"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 8,
                  background: weightsPanelOpen ? 'rgba(122,158,95,0.2)' : isCustomWeights ? 'rgba(122,158,95,0.1)' : 'rgba(255,255,255,0.04)',
                  borderColor: weightsPanelOpen || isCustomWeights ? WEIGHTS_ACCENT : 'rgba(255,255,255,0.08)',
                  color: 'var(--cream)', fontSize: 12, fontWeight: 600,
                  padding: '10px 12px', borderRadius: 10,
                }}
              >
                {weightsPanelOpen ? 'Hide' : 'Adjust'} risk weights
                {isCustomWeights && <span className="font-mono" style={{ color: WEIGHTS_ACCENT, fontWeight: 700 }}>●</span>}
                <span className="font-mono" style={{ marginLeft: 'auto', color: 'var(--cream-soft)', fontWeight: 500 }}>→</span>
              </button>
              <a
                href="/top-at-risk"
                target="_blank"
                rel="noreferrer"
                className="ghost-btn hotspot-toggle"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 8,
                  background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)',
                  color: 'var(--cream)', fontSize: 12, fontWeight: 600,
                  padding: '10px 12px', borderRadius: 10, textDecoration: 'none', boxSizing: 'border-box',
                }}
              >
                View shareable Top 10
                <span className="font-mono" style={{ marginLeft: 'auto', color: 'var(--cream-soft)', fontWeight: 500 }}>→</span>
              </a>
            </div>
          </div>
        </div>

        {/* MAP CANVAS — pin clusters/hotspot corridors render inside this column;
            the timelapse strip and popups float within it, never over the side panels */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          <div ref={mapEl} className="no-print" style={{ position: 'absolute', inset: 0 }} />

          {/* Timelapse — a forward-looking scenario scrub bar, not a forecast.
              Scrubbing/playing recolors businesses-circles via the combined
              repaint effect above; a closed dot fades out completely. */}
          <div className="no-print glass-card" style={{
            position: 'absolute', bottom: 16, left: 16, right: 16, zIndex: 2,
            color: 'var(--cream)', padding: '12px 18px',
          }}>
            <div style={{ fontSize: 11, color: 'var(--cream-soft)', lineHeight: 1.4, marginBottom: 10 }}>
              Each dot is a real Fremont restaurant. The longer it sits without a succession plan, the likelier it is to close —
              press play to watch how many could disappear over the next {TIMELAPSE_HORIZON_YEARS} years if nothing changes.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                onClick={() => {
                  if (timelapseYear >= TIMELAPSE_END_YEAR) setTimelapseYear(TIMELAPSE_START_YEAR)
                  setTimelapsePlaying(v => !v)
                }}
                className="ghost-btn"
                style={{
                  width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: 'var(--cream)', fontSize: 12, padding: 0, flexShrink: 0,
                }}
                aria-label={timelapsePlaying ? 'Pause' : 'Play'}
              >
                {timelapsePlaying ? '❚❚' : '▶'}
              </button>

              <button
                onClick={() => { setTimelapsePlaying(false); setTimelapseYear(TIMELAPSE_START_YEAR) }}
                className="ghost-btn"
                disabled={timelapseYear === TIMELAPSE_START_YEAR && !timelapsePlaying}
                style={{
                  width: 30, height: 30, borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', color: 'var(--cream)', fontSize: 13, padding: 0, flexShrink: 0,
                  opacity: timelapseYear === TIMELAPSE_START_YEAR && !timelapsePlaying ? 0.35 : 1,
                  cursor: timelapseYear === TIMELAPSE_START_YEAR && !timelapsePlaying ? 'default' : 'pointer',
                }}
                aria-label="Reset timelapse"
              >
                ↺
              </button>

              <div style={{ flexShrink: 0 }}>
                <div style={label}>Timelapse</div>
                <div className="font-display" style={{ fontSize: 13.5, fontWeight: 600, marginTop: 1, color: 'var(--cream)', whiteSpace: 'nowrap' }}>
                  {timelapseClosedCount > 0
                    ? `${timelapseClosedCount} gone`
                    : `Fremont`}
                </div>
              </div>

              <input
                type="range"
                min={TIMELAPSE_START_YEAR}
                max={TIMELAPSE_END_YEAR}
                step={1}
                value={timelapseYear}
                onChange={e => { setTimelapsePlaying(false); setTimelapseYear(Number(e.target.value)) }}
                style={{ flex: 1, accentColor: COHORT_ACCENT }}
              />

              <span className="font-mono" style={{ fontSize: 20, fontWeight: 700, color: COHORT_ACCENT, minWidth: 40, textAlign: 'right', flexShrink: 0 }}>
                {timelapseYear}
              </span>
            </div>
          </div>

          {/* Risk hotspot cluster popup */}
          {!selected && selectedCluster && (
            <div className="no-print fade-up" style={{
              position: 'absolute', right: 16, bottom: 132, width: 340, maxHeight: '55%',
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
                    {selectedCluster.open_count != null && selectedCluster.open_count < selectedCluster.business_count && (
                      <div className="font-mono" style={{ fontSize: 11, color: WEIGHTS_ACCENT, marginTop: 2 }}>
                        {selectedCluster.open_count} still open at year {timelapseYear}
                      </div>
                    )}
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

          {/* Community lens — risk grouped by cuisine/community lineage instead
              of geography. Clicking a row highlights that cohort on the map
              (see the selectedCohort paint effect) and surfaces the headline
              stat that a flat citywide count hides. */}
          {!selected && !selectedCluster && cohortPanelOpen && (
            <div className="no-print fade-up" style={{
              position: 'absolute', right: 16, bottom: 132, width: 340, maxHeight: '55%',
              background: 'var(--paper)', borderRadius: 20, boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
              zIndex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{ padding: '16px 18px', borderBottom: `2px solid ${COHORT_ACCENT}`, flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={label}>Risk By Community</div>
                    <div className="font-display" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                      Cuisine / community lineage
                    </div>
                  </div>
                  <button
                    onClick={() => { setCohortPanelOpen(false); setSelectedCohort(null) }}
                    className="ghost-btn"
                    style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '5px 9px', borderRadius: 6 }}
                  >
                    Close
                  </button>
                </div>
                {selectedCohort ? (() => {
                  const c = cohorts.find(x => x.cohort === selectedCohort)
                  if (!c) return null
                  return (
                    <div style={{ fontSize: 12.5, color: 'var(--ink)', marginTop: 8, lineHeight: 1.5, fontWeight: 600 }}>
                      {c.pct_high_risk}% of Fremont's {c.cohort} restaurants are high-risk
                      <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}> ({c.high_risk_count} of {c.business_count}{citywidePctHigh != null && ` — vs ${citywidePctHigh}% citywide`})</span>
                    </div>
                  )
                })() : (
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8, lineHeight: 1.5 }}>
                    Inferred from business names — a coarse lens, not a census. Tap a row to light it up on the map.
                  </div>
                )}
              </div>
              <div className="paper-scroll" style={{ overflowY: 'auto', padding: '4px 18px' }}>
                {cohorts.map(c => {
                  const isSelected = selectedCohort === c.cohort
                  return (
                    <button
                      key={c.cohort}
                      onClick={() => setSelectedCohort(v => v === c.cohort ? null : c.cohort)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
                        cursor: 'pointer', padding: '9px 0', borderTop: '1px solid var(--rule)', font: 'inherit',
                        opacity: selectedCohort && !isSelected ? 0.45 : 1,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 12.5, fontWeight: isSelected ? 700 : 600, color: 'var(--ink)' }}>
                          {c.cohort}{c.small_sample && <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}> (small sample)</span>}
                        </span>
                        <span className="font-mono" style={{ fontSize: 12.5, fontWeight: 700, color: COHORT_ACCENT, flexShrink: 0 }}>
                          {c.pct_high_risk}%
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                        <span>{c.business_count} businesses</span>
                        <span>{c.high_risk_count} high-risk</span>
                      </div>
                      <div style={{ height: 3, background: 'var(--paper-dim)', marginTop: 5 }}>
                        <div style={{ height: '100%', width: `${c.pct_high_risk}%`, background: COHORT_ACCENT }} />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Weight sandbox — same six signals, your own priorities. Recomputes
              client-side from the raw signal_* values already shipped per
              business, so the map recolors instantly with no round trip. */}
          {!selected && !selectedCluster && !cohortPanelOpen && weightsPanelOpen && (
            <div className="no-print fade-up" style={{
              position: 'absolute', right: 16, bottom: 132, width: 340, maxHeight: '65%',
              background: 'var(--paper)', borderRadius: 20, boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
              zIndex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{ padding: '16px 18px', borderBottom: `2px solid ${WEIGHTS_ACCENT}`, flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={label}>Weight Sandbox</div>
                    <div className="font-display" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
                      Same signals, your priorities
                    </div>
                  </div>
                  <button
                    onClick={() => setWeightsPanelOpen(false)}
                    className="ghost-btn"
                    style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '5px 9px', borderRadius: 6 }}
                  >
                    Close
                  </button>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink)', marginTop: 8, lineHeight: 1.5, fontWeight: 600 }}>
                  {customBusinesses.filter(b => b.risk_tier === 'high').length} high-risk under these weights
                  <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}> (of {customBusinesses.length})</span>
                </div>
              </div>
              <div className="paper-scroll" style={{ overflowY: 'auto', padding: '12px 18px' }}>
                {WEIGHT_META.map(m => (
                  <div key={m.key} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                      <span style={{ color: 'var(--ink)' }}>{m.label}</span>
                      <span className="font-mono" style={{ color: 'var(--ink-soft)' }}>{weights[m.key]}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={weights[m.key]}
                      onChange={e => setWeights(w => ({ ...w, [m.key]: Number(e.target.value) }))}
                      style={{ width: '100%', accentColor: WEIGHTS_ACCENT }}
                    />
                  </div>
                ))}
                <button
                  onClick={() => setWeights(DEFAULT_WEIGHTS)}
                  disabled={!isCustomWeights}
                  className="ghost-btn"
                  style={{
                    width: '100%', marginTop: 4, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', padding: '9px 12px', borderRadius: 8, color: 'var(--ink)',
                    opacity: isCustomWeights ? 1 : 0.4,
                  }}
                >
                  Reset to default weights
                </button>
                <p style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 10, lineHeight: 1.4 }}>
                  A city planner might care most about lease risk, a buyer about digital neglect. Same
                  data, different priorities, and the map updates live as you drag.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT DRAWER — slides open as a real column, so the map canvas
            actually narrows to make room rather than the drawer floating
            over it. Content stays a fixed width so it doesn't reflow mid-animation. */}
        <div className={`dossier-drawer paper-scroll${selected ? ' open' : ''}`} style={{
          width: selected ? DRAWER_WIDTH : 0, flexShrink: 0, overflow: 'hidden',
          background: 'var(--paper)', transition: 'width 0.3s cubic-bezier(.2,.8,.2,1)',
          borderLeft: selected ? '1px solid var(--rule)' : 'none',
        }}>
          <div style={{ width: DRAWER_WIDTH, height: '100%', overflowY: 'auto' }}>
            {selected && (
              <>
                <div className="folder-tab no-print">
                  {selected.account_id ? `File No. ${selected.account_id}` : 'Case File'}
                </div>

                <div id="dossier-print-root" style={{ padding: '18px 32px 48px', position: 'relative' }}>
                  <div className="no-print" style={{ position: 'absolute', top: -30, right: 32, display: 'flex', gap: 8 }}>
                    {brief && !brief.error && (
                      <button
                        onClick={() => window.print()}
                        className="ghost-btn"
                        style={{
                          background: 'var(--paper)', color: 'var(--ink)',
                          fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                          padding: '7px 12px', borderRadius: 4,
                        }}
                      >
                        Print Brief
                      </button>
                    )}
                    <button
                      onClick={() => { setSelected(null); setBrief(null); setPhotoOpen(false) }}
                      className="solid-btn"
                      style={{
                        background: 'var(--stamp-red)', border: 'none', cursor: 'pointer',
                        color: 'var(--cream)', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
                        padding: '7px 12px', borderRadius: 4,
                      }}
                    >
                      Close
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: 22, alignItems: 'center' }}>
                    {selected.name && (
                      <button
                        className="no-print photo-thumb"
                        onClick={() => setPhotoOpen(true)}
                        aria-label="Enlarge photo"
                        style={{
                          width: 118, height: 118, flexShrink: 0, padding: 0, cursor: 'zoom-in',
                          border: '5px solid #fff8ea', boxShadow: '0 8px 18px rgba(0,0,0,0.35)',
                          transform: 'rotate(-3deg)', background: 'none',
                        }}
                      >
                        <img
                          src={photoUrl(selected.name, 300)}
                          alt=""
                          onError={e => { e.target.closest('button').style.visibility = 'hidden' }}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      </button>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="font-display" style={{ fontSize: 30, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.15 }}>
                        {selected.name}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 6 }}>{selected.address}</div>
                    </div>
                  </div>

                  <div style={{
                    marginTop: 22, paddingBottom: 18, borderBottom: `2px solid ${TIER_COLOR[selected.risk_tier]}`,
                    display: 'flex', alignItems: 'center', gap: 18,
                  }}>
                    <div className="risk-stamp" style={{ color: TIER_COLOR[selected.risk_tier] }}>
                      <span className="font-display" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>
                        {Math.round(selected.risk_score)}
                      </span>
                      <span className="risk-stamp-tier">{selected.risk_tier} risk</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
                      Succession risk score out of 100, based on the structural and behavioral signals below.
                    </div>
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

                      <div style={{ marginTop: 28 }}>
                        <div style={label}>Signals</div>
                        <div style={{ marginTop: 12 }}>
                          {Object.entries(brief.signals).map(([name, value]) => (
                            <SignalBar key={name} name={name} value={value} />
                          ))}
                        </div>
                      </div>

                      {brief.next_steps && Object.keys(brief.next_steps).length > 0 && (
                        <div style={{ marginTop: 30 }}>
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

                      {selected.name && <CommentSection businessName={selected.name} />}
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
        </div>
      </div>

      {/* Photo lightbox — click the dossier's rotated photo to enlarge it */}
      {photoOpen && selected?.name && (
        <div
          className="no-print photo-lightbox fade-in"
          onClick={() => setPhotoOpen(false)}
        >
          <img src={photoUrl(selected.name, 1200)} alt="" onClick={e => e.stopPropagation()} />
          <button
            className="ghost-btn"
            onClick={() => setPhotoOpen(false)}
            style={{
              position: 'absolute', top: 24, right: 24,
              color: 'var(--cream)', fontWeight: 700, fontSize: 11,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              padding: '8px 14px', borderRadius: 4,
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
