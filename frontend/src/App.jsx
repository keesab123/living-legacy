import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

const TIER_COLOR = {
  high: '#ef4444',
  medium: '#f97316',
  low: '#22c55e',
}

export default function App() {
  const mapContainer = useRef(null)
  const map = useRef(null)
  const [selected, setSelected] = useState(null)
  const [businesses, setBusinesses] = useState([])

  useEffect(() => {
    fetch('http://localhost:8000/api/businesses?limit=500')
      .then(r => r.json())
      .then(setBusinesses)
  }, [])

  useEffect(() => {
    if (map.current || !businesses.length) return

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-121.9886, 37.5485],
      zoom: 12,
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

      map.current.addLayer({
        id: 'businesses-circles',
        type: 'circle',
        source: 'businesses',
        paint: {
          'circle-radius': [
            'interpolate', ['linear'], ['get', 'risk_score'],
            0, 6, 100, 14
          ],
          'circle-color': [
            'match', ['get', 'risk_tier'],
            'high', '#ef4444',
            'medium', '#f97316',
            'low', '#22c55e',
            '#94a3b8'
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff',
        },
      })

      map.current.on('click', 'businesses-circles', e => {
        setSelected(e.features[0].properties)
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
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {/* Header */}
      <div style={{
        position: 'absolute', top: 20, left: 20,
        background: 'rgba(15,15,15,0.9)', borderRadius: 12,
        padding: '14px 20px', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.08)'
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.3px' }}>Living Legacy</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Fremont business succession risk</div>
      </div>

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 40, left: 20,
        background: 'rgba(15,15,15,0.9)', borderRadius: 12,
        padding: '12px 16px', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.08)'
      }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Succession Risk</div>
        {[['high', 'High'], ['medium', 'Medium'], ['low', 'Low']].map(([tier, label]) => (
          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: TIER_COLOR[tier] }} />
            <span style={{ fontSize: 13 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Detail panel */}
      {selected && (
        <div style={{
          position: 'absolute', top: 20, right: 20, width: 300,
          background: 'rgba(15,15,15,0.95)', borderRadius: 12,
          padding: 20, backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.08)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontWeight: 700, fontSize: 15, flex: 1, lineHeight: 1.3 }}>{selected.name}</div>
            <button onClick={() => setSelected(null)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{selected.address}</div>

          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 8,
            background: `${TIER_COLOR[selected.risk_tier]}22`,
            border: `1px solid ${TIER_COLOR[selected.risk_tier]}44`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <span style={{ color: TIER_COLOR[selected.risk_tier], fontWeight: 600, textTransform: 'capitalize' }}>
              {selected.risk_tier} risk
            </span>
            <span style={{ fontSize: 22, fontWeight: 800, color: TIER_COLOR[selected.risk_tier] }}>
              {selected.risk_score}
            </span>
          </div>

          {selected.years_in_operation && (
            <div style={{ marginTop: 14, fontSize: 13, color: '#cbd5e1' }}>
              In operation for <strong>{Math.round(selected.years_in_operation)} years</strong>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
