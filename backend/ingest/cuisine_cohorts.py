# Cuisine/community cohort inference from business name tokens. Like
# chains.py, this is a maintained keyword list, not derived from data — Google
# Places doesn't expose cuisine on the search results we already store, and
# calling Place Details for `types` on every business is a second live API
# pass this heuristic avoids. Coarse but auditable, and every match is a
# human-readable trace back to the word in the name that triggered it.
#
# Fremont's Afghan community runs one of the largest Afghan commercial
# districts in the US (Little Kabul, along Fremont Blvd) — this cohort view
# exists to make that kind of community-level stake visible, not just an
# individual business's score.
COHORT_KEYWORDS = {
    "Afghan": {"afghan", "kabul", "kabob"},
    "South Asian": {
        "indian", "india", "punjabi", "punjab", "biryani", "tandoori", "dosa",
        "chaat", "thali", "desi", "masala", "samosa", "bombay", "hyderabad",
        "mylapore", "dhaba", "idly", "dakshin", "vegetarian cuisine", "mirchi",
    },
    "Italian": {"italian", "ristorante", "trattoria"},
    "Middle Eastern": {
        "kebab", "shawarma", "falafel", "mediterranean", "lebanese", "persian",
        "karak", "haraz",
    },
    "Chinese": {
        "chinese", "dumpling", "szechuan", "sichuan", "canton", "shanghai",
        "hong kong", "fortune cookie", "bun bun",
    },
    "Vietnamese": {"vietnam", "pho ", "pho-", "banh mi", "viet"},
    "Latin American": {
        "taqueria", "taco", "mexican", "cantina", "birria", "pupusa", "latin",
        "sonora", "antojitos", "tacos",
    },
    "Korean": {"korean", "kimchi", "seoul"},
    "Japanese": {"japanese", "sushi", "ramen", "izakaya"},
    "Thai": {"thai"},
    "Filipino": {"filipino", "adobo", "lumpia"},
}

OTHER_COHORT = "Other / American"


def classify_cohort(name: str) -> str:
    name_lower = f" {name.lower()} "
    for cohort, keywords in COHORT_KEYWORDS.items():
        if any(keyword in name_lower for keyword in keywords):
            return cohort
    return OTHER_COHORT
