import pandas as pd

# Human-readable label + the program/resource each signal maps to, reused
# across audiences so the "why" behind a recommendation is always visible.
SIGNAL_INFO = {
    "signal_years_in_operation": {
        "label": "long-tenured, no visible succession plan",
        "program": "facade/succession grant outreach",
    },
    "signal_lease_expiry": {
        "label": "lease expiring soon",
        "program": "commercial lease renewal & relocation assistance",
    },
    "signal_review_decline": {
        "label": "declining customer engagement",
        "program": "local marketing / BID support",
    },
    "signal_website_staleness": {
        "label": "stale or missing digital presence",
        "program": "digital modernization support",
    },
    "signal_no_sba_enrollment": {
        "label": "not enrolled in any SBA/transition program",
        "program": "SCORE mentorship & SBA transition planning",
    },
    "signal_renting": {
        "label": "renting rather than owning the property",
        "program": "tenant protection / lease-transfer resources",
    },
}

ELEVATED_THRESHOLD = 0.5


def _elevated_signals(row: pd.Series) -> list[str]:
    return [
        col for col in SIGNAL_INFO
        if pd.notna(row.get(col)) and row.get(col) >= ELEVATED_THRESHOLD
    ]


def generate_next_steps(row: pd.Series) -> dict:
    elevated = _elevated_signals(row)
    top = sorted(elevated, key=lambda c: row.get(c), reverse=True)[:2]
    is_high_risk = row.get("risk_tier") == "high"
    is_owner_occupied = row.get("owner_occupied") is True
    needs_digital_refresh = "signal_website_staleness" in elevated

    city_econ_dev = None
    if is_high_risk:
        reasons = ", ".join(SIGNAL_INFO[c]["label"] for c in top) or "elevated overall risk"
        programs = ", ".join(dict.fromkeys(SIGNAL_INFO[c]["program"] for c in top)) or "general outreach"
        city_econ_dev = f"Worth a call soon. Flagged for {reasons} — {programs} is probably the right fit."

    community_org = None
    if is_high_risk:
        community_org = (
            f"{row['name']} is high-risk and hasn't touched a transition program yet. Get them "
            "talking to SCORE or the county SBDC now, not after they've already put up a closing sign."
        )

    buyer = None
    if is_high_risk and is_owner_occupied:
        buyer = (
            "This one might be worth a direct ask — owner-occupied, high risk, and there's no "
            "listing anywhere. Nobody may have even offered to buy it yet."
        )

    owner = None
    if needs_digital_refresh:
        owner = (
            "Your site or listing hasn't been touched in a while. The city runs a free program "
            "for updated photos and a basic refresh — no cost, just say the word."
        )

    high_school_program = (
        "Could use some help online — new photos, an Instagram, maybe a simple site. Good fit "
        "for a student looking for service hours."
        if needs_digital_refresh else None
    )

    return {
        "next_step_city_econ_dev": city_econ_dev,
        "next_step_community_org": community_org,
        "next_step_buyer": buyer,
        "next_step_owner": owner,
        "next_step_high_school_program": high_school_program,
        "needs_digital_refresh": needs_digital_refresh,
    }


def add_next_steps(df: pd.DataFrame) -> pd.DataFrame:
    steps = df.apply(generate_next_steps, axis=1, result_type="expand")
    return pd.concat([df, steps], axis=1)
