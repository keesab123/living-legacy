# Handoff

An early warning system for immigrant-owned small business succession gaps in Fremont, CA.

## The Problem

Fremont has hundreds of immigrant-owned restaurants and small businesses that will disappear in the next decade — not because they failed, but because the transition fails. Parents retire or pass away, their kids went to college and became engineers, and nobody outside the family knows the business was ever available. No buyer, no handoff, no warning.

## How It Works

Two independent data streams are cross-validated to produce a succession risk score for each business:

**Stream 1 — Structural Signals**
- City of Fremont business license registry (business age, years at address, renewal history)
- Lease and property records (upcoming expirations, owner vs. renter status)
- SBA loan data (whether they've accessed any transition or succession programs)

**Stream 2 — Behavioral Signals**
- Google/Yelp review frequency trends over time
- Website and social media staleness (last update date, digital presence quality)
- Google Maps foot traffic trajectory

A business with 20+ years of operation, declining review velocity, stale digital presence, and a lease expiring in 18 months scores as high succession risk. Neither stream alone tells you that. Together they do.

## Risk Scoring Model

Each business receives a succession risk score from 0–100 built from weighted signals across both streams. The score is fully auditable — every business detail view shows exactly which signals fired and how much each contributed.

| Signal | Weight | High Risk Threshold |
|---|---|---|
| Years in operation | 25% | 15+ years |
| Months until lease expires | 20% | < 18 months |
| Review frequency decline (YoY) | 20% | > 30% drop |
| Website last updated | 15% | > 2 years ago |
| No SBA program enrollment | 10% | not enrolled |
| Owner occupied vs. renting | 10% | renting |

Scores above 70 are flagged as high risk. Weights are adjustable and will be calibrated against ground-truth data collected by on-the-ground canvassers.

## What It Produces

A Mapbox choropleth of Fremont colored by succession risk score. Click any business to see:
- Risk score breakdown (which signals triggered and why)
- Years in operation and ownership history
- Relevant transition resources (SBA programs, SCORE mentorship, Alameda County small business services)
- A generated business brief for sharing with potential buyers or community investors

## Who It's For

- **City economic development officers** — prioritized list of at-risk businesses before they close, enabling proactive intervention
- **Community organizations** — pipeline into succession programs before it's too late
- **Potential buyers** — discoverable inventory of businesses that might be available, most of which never hit any marketplace
- **Business owners** — simple intake flow that generates a shareable business profile

## Actionable Next Steps

- [ ] Scrape and clean Fremont business license registry data
- [ ] Pull Yelp/Google review frequency trends via API
- [ ] Define and calibrate the risk scoring model
- [ ] Build Mapbox map with choropleth risk layer
- [ ] Build business detail view with score breakdown and resource links
- [ ] Partner with Fremont Chamber of Commerce or local business associations for outreach
- [ ] Recruit high school students looking for summer work to do on-the-ground canvassing — talking to owners directly, collecting intake data, and verifying what the data signals actually reflect on the street
- [ ] Build owner intake form that feeds verified data back into the risk model

## Congressional Angle

Small business succession is an active policy gap. The SBA has transition programs almost nobody uses because at-risk businesses are never surfaced in time. Handoff demonstrates what's possible when cities use their own public data to protect their economic fabric before it disappears — and makes the case for federal investment in proactive succession infrastructure.

## Stack (Planned)

- **Frontend:** React, Vite, Mapbox GL
- **Backend:** FastAPI or Node/Express
- **Data:** Fremont open data portal, Yelp Fusion API, Google Places API
- **Scoring:** Custom risk model (weighted signals, auditable per business)
