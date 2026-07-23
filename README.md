# Handoff

An early warning system for immigrant-owned small business succession gaps in Fremont, CA.

## The Problem

Fremont has hundreds of immigrant-owned restaurants and small businesses that will disappear in the next decade — not because they failed, but because the transition fails. Parents retire or pass away, their kids went to college and became engineers, and nobody outside the family knows the business was ever available. No buyer, no handoff, no warning.

## How It Works

The pipeline cross-validates two independently-sourced populations of the same restaurants, then layers in structural and behavioral signals for each:

1. **City of Fremont business license registry** — scraped live from the city's PrimeWeb portal, filtered to non-chain restaurants open 5+ years.
2. **Google Places** — the base population. A multi-tile, multi-category grid search across Fremont (restaurants, cafes, bakeries, bars, takeout) finds every currently-open restaurant Google indexes, independently re-verified via a live text search so stale/closed listings don't survive.

These two sources disagree on almost everything — casing, abbreviated vs. spelled-out street types, DBA vs. legal entity names — so they're joined with a fuzzy matcher (`backend/ingest/matching.py`) on normalized address + name similarity, not an exact string match. License data (age, SBA enrollment) enriches a Places-sourced restaurant when a match exists; it's not required for the restaurant to appear in the list.

**Structural signals**
- Years in operation (from the license registry, when matched)
- Owner-occupied vs. renting (Alameda County Assessor — proxied by owner mailing address vs. property address; **not yet wired to a live endpoint**, see Known Gaps)
- SBA loan enrollment (SBA FOIA 7(a) data, filtered to restaurant NAICS codes, address-matched since loan filings use the legal entity name)

**Behavioral signals**
- Google review count trend (week-over-week snapshot comparison — needs a second pipeline run to produce a real trend; the first run has no prior snapshot)
- Website staleness (`Last-Modified` header where available, plus reachability)

## Risk Scoring Model

Each business receives a succession risk score from 0–100 built from weighted signals:

| Signal | Weight | High Risk Threshold |
|---|---|---|
| Years in operation | 25% | 15+ years |
| Months until lease expires | 20% | < 18 months (currently unavailable — see Known Gaps) |
| Review frequency decline (YoY) | 20% | > 30% drop |
| Website last updated | 15% | > 2 years ago, or unreachable |
| No SBA program enrollment | 10% | not enrolled |
| Owner occupied vs. renting | 10% | renting (currently unavailable — see Known Gaps) |

Tier cutoffs (high ≥ 0.42, medium ≥ 0.32) are calibrated against the actual score distribution rather than picked arbitrarily — see the comment in `backend/scoring/risk_scorer.py`. They'll need revisiting once lease/ownership data is live, since that will shift the distribution.

Every business also gets audience-specific next steps (`backend/scoring/next_steps.py`): a prioritized outreach note for city economic development, a succession-program referral for community organizations, an "inheritable, unlisted" flag for potential buyers, a plain-language digital-refresh nudge for the owner, and a high-school volunteer opportunity where relevant.

## What It Produces

A Mapbox choropleth of Fremont restaurants colored by succession risk score, plus a citywide impact estimate (jobs/revenue at risk, based on national small-restaurant averages — not per-business figures). Click any business to see:
- Risk score breakdown, signal by signal
- Tailored next steps for each audience
- Transition resources (SBA programs, SCORE mentorship, Alameda County small business services)
- A one-page printable brief (`Print Brief` in the dossier) for a city officer to hand to a business owner

## Who It's For

- **City economic development officers** — prioritized list of at-risk businesses before they close, enabling proactive intervention
- **Community organizations** — pipeline into succession programs before it's too late
- **Potential buyers** — discoverable inventory of businesses that might be available, most of which never hit any marketplace
- **Business owners** — a plain-language brief on what's driving their risk score and what to do about it
- **High school volunteers** — a standing list of businesses that could use a menu photo shoot, Instagram setup, or website refresh

## Running It

```
# backend
cd backend && uvicorn main:app --reload          # http://localhost:8000
# regenerate the dataset (live scrape + Google Places + scoring)
python3 -c "from ingest.merge import run as m; from scoring.risk_scorer import run as s; s(m())"

# frontend
cd frontend && npm run dev                        # http://localhost:5173 (or next free port)
```

Requires `GOOGLE_API_KEY` in `backend/.env` and `VITE_MAPBOX_TOKEN` in `frontend/.env`.

## Known Gaps

- **Alameda County Assessor isn't wired up** (`backend/ingest/property_records.py`) — `DATA_SOURCE` is a placeholder. Until a verified parcel-layer endpoint is set, `owner_occupied` and `months_until_lease_expires` stay neutral for every business.
- **Review decline is neutral on a first run** — it needs a second pipeline run, days or weeks later, to compute a real trend against the first snapshot.
- **Coverage is bounded by what Google Places indexes** — the grid search finds what Google surfaces; there's no independent way to know what it's missing.
- Chain filtering (`backend/ingest/chains.py`) is a maintained keyword list, not derived from data — new chains require a manual addition.

## Congressional Angle

Small business succession is an active policy gap. The SBA has transition programs almost nobody uses because at-risk businesses are never surfaced in time. Handoff demonstrates what's possible when cities use their own public data to protect their economic fabric before it disappears — and makes the case for federal investment in proactive succession infrastructure.

## Stack

- **Frontend:** React, Vite, Mapbox GL
- **Backend:** FastAPI, pandas
- **Data:** Fremont PrimeWeb business license portal (live scrape via Playwright), Google Places API, SBA FOIA 7(a) loan data, Alameda County Assessor (planned)
