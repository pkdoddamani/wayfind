"""Download official registers and write compact JSON for the offer checker.

Sources (all public, official):
  UK  - Home Office register of licensed sponsors (workers), CSV, updated daily
  NL  - IND public register of recognised sponsors (work), HTML table
  IN  - MEA eMigrate: active recruiting agents, non-active agents, illegal agents (JSON)

Usage:  python fetch_data.py [out_dir]      (default: ./data)
Needs only the Python standard library. Run once a day at most.
"""
import csv, html, io, json, os, re, shutil, sys, time, urllib.request
from datetime import date

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
UA = {"User-Agent": "Nextshore offer checker (daily refresh; contact via github.com/pkdoddamani/wayfind)"}

UK_PAGE = "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers"
NL_PAGE = "https://ind.nl/en/public-register-recognised-sponsors/public-register-work"
IN_ACTIVE = "https://emigrate.gov.in/api/rs/api/active-ra"
IN_NONACTIVE = "https://emigrate.gov.in/api/rs/api/non-active-ra"
IN_ILLEGAL = "https://emigrate.gov.in/api/ra/partner/illegelradetails"

# Words that don't help tell companies apart. Must match NORM in checker.js.
STOP = {"ltd", "limited", "plc", "llp", "llc", "inc", "co", "company", "the", "and", "uk", "bv", "b", "v",
        "nv", "pvt", "private", "gmbh", "group", "services", "service", "international", "intl", "of"}


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return r.read()
        except Exception as e:  # network hiccup: retry with backoff
            if i == tries - 1:
                raise
            print(f"  retry {url}: {e}")
            time.sleep(5 * (i + 1))


def norm(name):
    s = html.unescape(name or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\bnational health service\b", "nhs", s)
    return " ".join(w for w in s.split() if w not in STOP)


def shard_key(n):
    k = re.sub(r"[^a-z0-9]", "", n)[:2]
    return k if len(k) == 2 else (k + "_")[:2] or "__"


def digits(s):
    """All phone-like numbers in s, as their last 10 digits."""
    out = set()
    for m in re.findall(r"\+?\d[\d\s().\-]{7,}\d", s or ""):
        d = re.sub(r"\D", "", m)
        if len(d) >= 10:
            out.add(d[-10:])
    return sorted(out)


def emails(s):
    return sorted({e.lower().rstrip(".") for e in re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", s or "")})


FREE_MAIL = {"gmail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "rediffmail.com", "ymail.com", "live.com", "icloud.com", "aol.com", "protonmail.com", "zoho.com"}


def domain_of(url_or_email):
    s = (url_or_email or "").lower().strip()
    s = s.split("@")[-1]
    s = re.sub(r"^https?://", "", s).split("/")[0]
    s = re.sub(r"^www\.", "", s)
    return "" if not s or s in FREE_MAIL or "." not in s else s


def write(path, obj):
    path = os.path.join(OUT, path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def sharded(prefix, rows):
    """rows: list of (norm, record). Writes prefix/<key>.json and returns shard count."""
    shutil.rmtree(os.path.join(OUT, prefix), ignore_errors=True)
    shards = {}
    for n, rec in rows:
        shards.setdefault(shard_key(n), []).append([n] + rec)
    for k, v in shards.items():
        v.sort()
        write(f"{prefix}/{k}.json", v)
    return len(shards)


def uk():
    page = get(UK_PAGE).decode("utf-8", "replace")
    url = re.search(r"https://assets\.publishing\.service\.gov\.uk/[^\"]+\.csv", page).group(0)
    as_of = (re.search(r"(\d{4}-\d{2}-\d{2})\.csv$", url) or [None, ""])[1]
    text = get(url).decode("utf-8-sig", "replace")
    orgs = {}
    for r in csv.DictReader(io.StringIO(text)):
        name = " ".join((r.get("Organisation Name") or "").split())
        if not name:
            continue
        town = " ".join((r.get("Town/City") or "").split()).title()
        key = (name.lower(), town.lower())
        o = orgs.setdefault(key, {"name": name, "town": town, "rating": set(), "routes": set()})
        o["rating"].add(" ".join((r.get("Type & Rating") or "").split()))
        o["routes"].add(" ".join((r.get("Route") or "").split()))
    routes = sorted({x for o in orgs.values() for x in o["routes"]})
    ratings = sorted({x for o in orgs.values() for x in o["rating"]})
    rows = []
    for o in orgs.values():
        n = norm(o["name"]) or o["name"].lower()
        rows.append((n, [o["name"], o["town"], [ratings.index(x) for x in sorted(o["rating"])], [routes.index(x) for x in sorted(o["routes"])]]))
    shards = sharded("uk", rows)
    return {"source": url, "page": UK_PAGE, "asOf": as_of, "orgs": len(rows), "shards": shards, "routes": routes, "ratings": ratings}


def nl():
    page = get(NL_PAGE).decode("utf-8", "replace")
    as_of = (re.search(r"last updated on ([0-9]{1,2} [A-Za-z]+ 20[0-9]{2})", page) or [None, ""])[1]
    rows = []
    for name, kvk in re.findall(r'<th scope="row">(.*?)</th>\s*<td>(.*?)</td>', page, re.S):
        name = " ".join(html.unescape(re.sub(r"<[^>]+>", "", name)).split())
        kvk = re.sub(r"\D", "", kvk)
        if name:
            rows.append((norm(name) or name.lower(), [name, kvk]))
    if len(rows) < 1000:
        raise RuntimeError(f"NL register looks wrong: only {len(rows)} rows")
    shards = sharded("nl", rows)
    return {"source": NL_PAGE, "asOf": as_of, "orgs": len(rows), "shards": shards}


def india():
    def load(u):
        d = json.loads(get(u))
        if d.get("status") != "success":
            raise RuntimeError(f"{u}: {d.get('error')}")
        return d["data"]

    agents = []
    for r in load(IN_ACTIVE) + load(IN_NONACTIVE):
        blob = " ".join(str(r.get(k) or "") for k in ("contactNumber", "email", "website", "address"))
        agents.append({
            "n": norm(r.get("raName")), "name": " ".join((r.get("raName") or "").split()),
            "id": r.get("raId"), "rc": " ".join((r.get("rcNumber") or "").split()),
            "status": " ".join((r.get("status") or "").split()), "state": (r.get("state") or "").strip().title(),
            "district": (r.get("district") or "").strip().title(),
            "phones": digits(blob), "emails": emails(blob),
            "domains": sorted({d for d in [domain_of(r.get("website"))] + [domain_of(e) for e in emails(blob)] if d}),
        })
    illegal = []
    for r in load(IN_ILLEGAL):
        name = " ".join((r.get("RAName") or "").split())
        addr = r.get("RAAddress") or ""
        es = emails(addr)
        illegal.append({
            "n": norm(name), "name": name, "state": (r.get("State") or "").strip(),
            "phones": digits(addr), "emails": es,
            "domains": sorted({d for d in [domain_of(e) for e in es] + [domain_of(w) for w in re.findall(r"www\.[\w.-]+", addr)] if d}),
            "complaints": r.get("GrievanceCount") or 0,
        })
    write("in/agents.json", agents)
    write("in/illegal.json", illegal)
    active = sum(1 for a in agents if a["status"].lower() == "active")
    return {"source": [IN_ACTIVE, IN_NONACTIVE, IN_ILLEGAL], "page": "https://emigrate.gov.in/", "asOf": date.today().isoformat(),
            "active": active, "notActive": len(agents) - active, "illegal": len(illegal)}


def main():
    meta = {"built": date.today().isoformat(), "stop": sorted(STOP)}
    for key, fn in (("uk", uk), ("nl", nl), ("in", india)):
        print(f"{key} ...", flush=True)
        try:
            meta[key] = fn()
            print(f"  ok {json.dumps({k: v for k, v in meta[key].items() if k not in ('routes', 'ratings', 'source')})}")
        except Exception as e:  # keep last good data for this source
            print(f"  FAILED {key}: {e}")
            old = os.path.join(OUT, "meta.json")
            if os.path.exists(old):
                meta[key] = json.load(open(old, encoding="utf-8")).get(key)
    write("meta.json", meta)
    print("done ->", OUT)


if __name__ == "__main__":
    main()
