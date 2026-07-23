import re
import difflib
import pandas as pd

# The license registry and Google Places disagree on nearly every formatting
# convention (case, abbreviated vs. spelled-out street types, suite numbers,
# trailing city/state/zip) so an exact string join on raw name/address never
# matches. Normalize both down to a comparable key before joining.

STREET_TYPE_MAP = {
    "BOULEVARD": "BLVD", "BLVD": "BLVD",
    "ROAD": "RD", "RD": "RD",
    "AVENUE": "AVE", "AVE": "AVE",
    "STREET": "ST", "ST": "ST",
    "DRIVE": "DR", "DR": "DR",
    "COURT": "CT", "CT": "CT",
    "LANE": "LN", "LN": "LN",
    "PLACE": "PL", "PL": "PL",
    "WAY": "WAY",
    "CIRCLE": "CIR", "CIR": "CIR",
    "TERRACE": "TER", "TER": "TER",
    "PARKWAY": "PKWY", "PKWY": "PKWY",
    "HIGHWAY": "HWY", "HWY": "HWY",
}

CORPORATE_SUFFIXES = {"INC", "LLC", "CORP", "CO", "LTD"}


def normalize_name(name: str) -> str:
    if pd.isna(name):
        return ""
    n = re.sub(r"[^A-Z0-9 ]", " ", str(name).upper())
    tokens = [t for t in n.split() if t not in CORPORATE_SUFFIXES]
    return " ".join(tokens).strip()


def parse_address(address: str) -> tuple[str, str]:
    """Returns (house_number, normalized_street_name) — drops unit/suite,
    city, state, and zip since those vary or are missing between sources."""
    if pd.isna(address):
        return "", ""
    a = str(address).upper()
    a = a.split(",")[0]  # drop ", CITY, STATE ZIP"
    a = re.sub(r"#\S+", "", a)  # drop unit/suite markers like #2947
    a = re.sub(r"\b(STE|SUITE|UNIT|APT)\s*\S*", "", a)
    a = re.sub(r"[^A-Z0-9 ]", " ", a)
    a = re.sub(r"\s+", " ", a).strip()

    match = re.match(r"(\d+)\s+(.*)", a)
    if not match:
        return "", a
    house_number, rest = match.group(1), match.group(2)

    tokens = [STREET_TYPE_MAP.get(t, t) for t in rest.split()]
    return house_number, " ".join(tokens)


def name_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a, b).ratio()


def match_businesses(
    left: pd.DataFrame,
    right: pd.DataFrame,
    name_col: str = "name",
    address_col: str = "address",
    min_name_similarity: float = 0.5,
    how: str = "inner",
) -> pd.DataFrame:
    """Fuzzy-join two business dataframes on normalized (house_number, street)
    plus name similarity. Returns `left` joined with `right`'s columns
    (suffixed `_r` on collision). how="inner" keeps only matched rows;
    how="left" keeps every left row, with right's columns as NaN when
    there's no match."""
    left = left.copy()
    right = right.copy()

    left[["_house", "_street"]] = left[address_col].apply(lambda a: pd.Series(parse_address(a)))
    right[["_house", "_street"]] = right[address_col].apply(lambda a: pd.Series(parse_address(a)))
    left["_norm_name"] = left[name_col].apply(normalize_name)
    right["_norm_name"] = right[name_col].apply(normalize_name)

    right_by_addr: dict[tuple, list[int]] = {}
    for idx, row in right.iterrows():
        key = (row["_house"], row["_street"])
        right_by_addr.setdefault(key, []).append(idx)

    skip = {name_col, address_col, "_house", "_street", "_norm_name"}
    right_cols = [c for c in right.columns if c not in skip]

    rows = []
    for _, lrow in left.iterrows():
        candidates = right_by_addr.get((lrow["_house"], lrow["_street"]), [])
        best_idx, best_score = None, 0.0
        if lrow["_house"] and candidates:
            if len(candidates) == 1:
                # Same normalized house number + street and nothing else there
                # to confuse it with — trust the address match on its own,
                # since names legitimately diverge (DBA vs. registered legal name).
                best_idx, best_score = candidates[0], 1.0
            else:
                for idx in candidates:
                    score = name_similarity(lrow["_norm_name"], right.loc[idx, "_norm_name"])
                    if score > best_score:
                        best_idx, best_score = idx, score

        matched = best_idx is not None and best_score >= min_name_similarity
        if not matched and how == "inner":
            continue

        combined = {**lrow.to_dict()}
        for col in right_cols:
            val = right.loc[best_idx, col] if matched else pd.NA
            combined[f"{col}_r" if col in combined else col] = val
        rows.append(combined)

    result = pd.DataFrame(rows)
    return result.drop(columns=["_house", "_street", "_norm_name"], errors="ignore")
