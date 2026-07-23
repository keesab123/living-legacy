CHAIN_KEYWORDS = {
    # Fast food
    "kentucky fried chicken", "mcdonald", "mc donald", "subway", "starbucks", "taco bell", "burger king",
    "wendy's", "wendys", "chick-fil-a", "chick fil a", "popeyes", "kfc",
    "pizza hut", "domino's", "dominos", "little caesars", "papa john",
    "panda express", "chipotle", "olive garden", "applebee's", "applebees",
    "denny's", "dennys", "ihop", "waffle house", "cracker barrel",
    "red lobster", "outback steakhouse", "texas roadhouse", "chili's", "chilis",
    "buffalo wild wings", "bj's restaurant", "bj's brewhouse", "in-n-out",
    "in n out", "five guys", "shake shack", "raising cane", "wingstop",
    "jersey mike", "jimmy john", "firehouse subs", "potbelly", "panera",
    "jason's deli", "krispy kreme", "dunkin", "baskin-robbins", "baskin robbins",
    "dairy queen", "sonic drive", "jack in the box", "carl's jr", "carls jr",
    "hardee", "whataburger", "del taco", "el pollo loco", "rubio's", "rubios",
    "qdoba", "smashburger", "habit burger", "fatburger", "tropical smoothie",
    "jamba juice", "jamba", "wetzel", "auntie anne", "cinnabon", "sbarro",
    "peet's coffee", "peets coffee", "coffee bean", "dutch bros",
    "crowne plaza", "hilton", "marriott", "holiday inn", "best western",
    "hampton inn", "blaze pizza", "blaze fast", "blaze fremont",
    "dog haus", "black bear diner", "boudin", "cold stone creamery",
    "bruster", "claim jumper", "bowl of heaven", "bennigan", "boston market",
    "carino's", "carinos", "quizno", "blimpie",
    # More chains
    "round table pizza", "papa murphy", "mountain mike", "straw hat pizza",
    "straw hat grill", "hooters", "p.f. chang", "pf chang", "sweet tomatoes",
    "wienerschnitzel", "el torito", "togo's", "togos", "pick up stix",
    "l&l hawaiian", "l & l hawaiian", "lee's sandwiches", "lees sandwiches",
    "dickey's barbecue", "dickeys barbecue", "una mas", "noah's bagels",
    "noahs bagels", "charley's grilled", "charleys grilled", "taco del mar",
    "zpizza", "z pizza", "kabuki", "ohana hawaiian", "h salt",
    "stuart anderson", "spoons grill", "java city", "la salsa",
    "nations burger", "nations #", "honeybaked", "fresh & natural",
    "fresh and natural", "pick up stix", "zpizza", "la pinata",
    "la casita", "el patron", "happi house", "papa murphys",
    "round table", "taco del mar", "zpizza", "straw hat",
    "wienerschnitzel", "el torito", "spoons express",
    # Corporate cafeterias
    "aramark", "bon appetit", "sodexo", "sodexho", "compass group",
    "eurest", "guckenheimer", "western dining", "logitech cafeteria",
    "zomax cafeteria", "perkin elmer", "silicon valley college",
    "technics cafe", "western digital cafe", "lin fon cafeteria",
    "sky food service", "chum's cafeteria", "n e t-cafeteria",
    "front page cafe at", "@ siemens", "@ thermo", "@ p d l",
    "@ oracle", "@ google", "@ stryker", "@ net.com",
    # Hotel chains
    "courtyard", "hampton inn", "residence inn",
    # Convenience / grocery chains
    "7-eleven", "7 eleven", "circle k", "safeway", "trader joe", "whole foods",
    "walgreens", "cvs pharmacy", "target", "walmart", "costco",
}


def is_chain(name: str) -> bool:
    name_lower = name.lower().strip()
    return any(keyword in name_lower for keyword in CHAIN_KEYWORDS)
