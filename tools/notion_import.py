#!/usr/bin/env python3
"""Convert a Notion "Money Tracker" export folder into the money-tracker JSON (schema 1).

Usage: python3 -I notion_import.py <export_dir> <year> <out.json>

Model decisions (agreed Oct 2026):
- Amounts are integer cents. Account balances are signed from a net-worth view:
  credit cards are negative when money is owed, so for EVERY account
  balance = opening + inflows - outflows.
- Expenses have a category plus free-form tags (Notion's multi-select
  "Sub-Category" becomes tags; "Misc." is dropped because it carries no meaning).
- Earning categories have a role: paycheck | income | offset.
  An offset (refund, reimbursement, redeemed points) reduces spending instead of
  counting as income. `offsets` optionally names the expense category it reduces;
  historical Notion rows don't say, so it is left null (reduces total spending only).
- Transfer categories have a role that drives the savings/investment/CC reports.
"""
import csv, glob, json, os, re, sys
from datetime import datetime

LINK = re.compile(r"\s*\(https?://[^)]*\)")

EARN_ROLES = {"Paycheck": "paycheck", "Interest": "income", "Other": "income",
              "Tax Refund": "income", "Refunds": "offset",
              "Expenses Remunerated": "offset", "Redeemed CC Points": "offset",
              # 2024 template names
              "Return & Refund": "offset", "Investment Return": "income"}
XFER_ROLES = {"Payment to CC": "cc_payment", "Savings": "savings_in",
              "Savings Takeout": "savings_out", "Investment - IRA": "invest_retirement",
              "Investment - Stocks & Cryptos": "invest_taxable",
              "Cash Withdraw": "cash_withdrawal", "General Transfer": "general"}
EXP_ROLES = {"Charity": "charity", "Loan": "loan"}
DROP_TAGS = {"", "Misc."}

# Rows the importer reshapes carry one of these notes. verify.py (and tests/notion.ts) look
# for them to put such rows back the way Notion counted them before comparing totals.
REFUND_NOTE = "Imported from Notion, where it was a negative expense."
INVEST_NOTE = "Imported from Notion, where it was an Investment expense."

# 2024 logged investing as an "Investment" expense tagged with the platform. From 2025 on it is a
# transfer to an investment account, so map the tag to that account and transfer category.
INVEST_BY_TAG = {"Robinhood": ("GIA - Robinhood", "Investment - Stocks & Cryptos"),
                 "MS eTrade": ("GIA - MS eTrade", "Investment - IRA")}

# Trips were an expense category in 2024 ("Travel") and 2025 ("Vacation"); from 2026 on they are
# a tag, so those rows become a tag on a regular category.
TRIP_CATEGORIES = {"Travel", "Vacation"}
TRIP_TAG, TRIP_CATEGORY = "Vacation", "Personal Care & Activities"


def slug(prefix, name):
    return prefix + "_" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def cents(s):
    s = (s or "").replace("$", "").replace(",", "").strip()
    return round(float(s) * 100) if s else 0


def _match(export_dir, pattern):
    """'*Accounts*_all.csv' -> files named '[Money Tracker ]Accounts <year> <id>_all.csv'
    (so 'Transfers Between Accounts' does not match 'Accounts')."""
    key = pattern.strip("*").split("*")[0]
    rx = re.compile(r"^(Money Tracker )?" + re.escape(key) + r"\b.*_all\.csv$")
    return [p for p in glob.glob(os.path.join(export_dir, "**", "*_all.csv"), recursive=True)
            if rx.match(os.path.basename(p))]


def read(export_dir, pattern):
    hits = _match(export_dir, pattern)
    if len(hits) != 1:
        sys.exit(f"expected one file for {pattern}, found {hits}")
    with open(hits[0], encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def clean(s):
    return LINK.sub("", s or "").strip()


def col(row, *names):
    """The first of several column names the row has. Older Notion templates
    (2024) used e.g. "Payment Method" where later ones use "Debited From"."""
    for n in names:
        if n in row:
            return row[n]
    sys.exit(f"none of the columns {names} found")


def is_blank(row):
    """A stray empty row Notion keeps around (no date, no amount)."""
    return not (row.get("Date") or "").strip() and not (row.get("Amount") or "").strip()


def date(s):
    return datetime.strptime(s.strip(), "%B %d, %Y").strftime("%Y-%m-%d")


def acct_type(name, emoji):
    if "💳" in emoji: return "credit"
    if "🌱" in emoji: return "investment"
    if "💵" in emoji: return "cash"
    return "savings" if "savings" in name.lower() else "checking"


def main(export_dir, year, out):
    A = read(export_dir, "*Accounts*_all.csv")
    E = read(export_dir, "*Expenses*_all.csv")
    I = read(export_dir, "*Earnings*_all.csv")
    T = read(export_dir, "*Transfers*_all.csv")

    accounts, acct_id = [], {}

    def add_account(name, t, ref="", opening=0, limit=None):
        a = {"id": slug("a", name), "name": name, "type": t, "ref": ref, "opening": opening}
        if limit is not None:
            a["limit"] = limit
        acct_id[name] = a["id"]
        accounts.append(a)

    for r in A:
        t = acct_type(r["Name"], r["Type"])
        ob = cents(r["Opening Balance"])
        add_account(r["Name"], t, ref=(r.get("Acc ID") or r.get("Acc No.") or "").strip(),
                    opening=-ob if t == "credit" else ob,
                    # 2024 had no credit limits
                    limit=cents(r["Credit Limit"]) if t == "credit" and (r.get("Credit Limit") or "").strip() else None)

    RENAME = {"ce": {"Transfer": "Transfer to external account",
                     "Personal Care & Activites": "Personal Care & Activities"},  # 2024 typo
              "ci": {"Return & Refund": "Refunds"}}  # 2024 name

    skipped = {k: sum(map(is_blank, rows)) for k, rows in (("expenses", E), ("earnings", I), ("transfers", T))}
    E, I, T = ([r for r in rows if not is_blank(r)] for rows in (E, I, T))

    def order(r):
        return (date(r["Date"]), r.get("Created time", ""))

    def with_note(notes, note):
        return f"{notes} {note}".strip()

    # Each list holds (sort key, entry without id); ids are given once everything is merged.
    exp_rows, earn_rows, xfer_rows = [], [], []
    names = {"ce": set(), "ci": set(), "ct": set()}
    tags_seen, converted = {}, {"refunds": 0, "investments": 0, "trips": 0}

    for r in E:
        cat = RENAME["ce"].get(r["Category"], r["Category"])
        tags = [t.strip() for t in (r["Sub-Category"] or "").split(", ") if t.strip() not in DROP_TAGS]
        account = acct_id[clean(col(r, "Debited From", "Payment Method"))]
        amount, notes = cents(r["Amount"]), r["Notes"].strip()
        base = {"date": date(r["Date"]), "item": r["Item"].strip(), "amount": amount}

        if cat == "Investment":
            platform = next((t for t in tags if t in INVEST_BY_TAG), None)
            if not platform:
                sys.exit(f"which investment account did {r['Item']!r} on {r['Date']} go to? tags: {tags}")
            name, xcat = INVEST_BY_TAG[platform]
            if name not in acct_id:
                add_account(name, "investment")
            names["ct"].add(xcat)
            xfer_rows.append((order(r), {**base, "from": account, "to": acct_id[name],
                                         "cat": slug("ct", xcat), "notes": with_note(notes, INVEST_NOTE)}))
            converted["investments"] += 1
            continue

        if cat in TRIP_CATEGORIES:
            cat = TRIP_CATEGORY
            if TRIP_TAG not in tags:
                tags.append(TRIP_TAG)
            converted["trips"] += 1
        names["ce"].add(cat)

        if amount < 0:  # a refund recorded as a negative expense: an earning that lowers this category
            names["ci"].add("Refunds")
            earn_rows.append((order(r), {**base, "amount": -amount, "account": account, "cat": slug("ci", "Refunds"),
                                         "notes": with_note(notes, REFUND_NOTE), "offsets": slug("ce", cat)}))
            converted["refunds"] += 1
            continue

        for t in tags:
            tags_seen[t] = tags_seen.get(t, 0) + 1
        exp_rows.append((order(r), {**base, "account": account, "cat": slug("ce", cat),
                                    "tags": [slug("t", t) for t in tags], "notes": notes}))

    for r in I:
        cat = RENAME["ci"].get(r["Category"], r["Category"])
        names["ci"].add(cat)
        e = {"date": date(r["Date"]), "item": r["Item"].strip(), "amount": cents(r["Amount"]),
             "account": acct_id[clean(col(r, "Credited To", "Earning Source"))],
             "cat": slug("ci", cat), "notes": r["Notes"].strip()}
        if EARN_ROLES.get(cat) == "offset":
            e["offsets"] = None
        earn_rows.append((order(r), e))

    for r in T:
        names["ct"].add(r["Category"])
        xfer_rows.append((order(r), {"date": date(r["Date"]), "item": r["Item"].strip(), "amount": cents(r["Amount"]),
                                     "from": acct_id[clean(col(r, "Debited From", "From"))],
                                     "to": acct_id[clean(col(r, "Credited To", "To"))],
                                     "cat": slug("ct", r["Category"]), "notes": r["Notes"].strip()}))

    def numbered(rows, prefix):
        return [{"id": f"{prefix}{i:04d}", **row} for i, (_, row) in enumerate(sorted(rows, key=lambda x: x[0]), 1)]

    def cats(prefix, roles):
        return [dict({"id": slug(prefix, n), "name": n}, **({"role": roles[n]} if n in roles else {}))
                for n in sorted(names[prefix])]

    kinds = ["checking", "savings", "cash", "credit", "investment"]
    accounts.sort(key=lambda a: (kinds.index(a["type"]), a["name"]))
    expenses, earnings, transfers = numbered(exp_rows, "e"), numbered(earn_rows, "i"), numbered(xfer_rows, "x")

    doc = {"app": "money-tracker", "schema": 1, "year": int(year),
           "exportedAt": datetime.now().isoformat(timespec="seconds"),
           "accounts": accounts,
           "categories": {"expense": cats("ce", EXP_ROLES),
                          "earning": cats("ci", EARN_ROLES),
                          "transfer": cats("ct", XFER_ROLES)},
           "tags": [{"id": slug("t", t), "name": t} for t in sorted(tags_seen)],
           "expenses": expenses, "earnings": earnings, "transfers": transfers,
           "budgets": {"default": {}}}
    for kind in ("earning", "transfer"):
        for c in doc["categories"][kind]:
            if "role" not in c:
                sys.exit(f"no role mapping for {kind} category {c['name']!r}")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    print(f"wrote {out}: {len(accounts)} accounts, {len(expenses)} expenses, "
          f"{len(earnings)} earnings, {len(transfers)} transfers, {len(tags_seen)} tags")
    for kind, n in skipped.items():
        if n:
            print(f"skipped {n} empty {kind} row{'s' if n > 1 else ''} (no date or amount)")
    if converted["refunds"]:
        print(f"made {converted['refunds']} negative expense(s) into refunds")
    if converted["investments"]:
        print(f"made {converted['investments']} Investment expense(s) into investment transfers")
    if converted["trips"]:
        print(f"moved {converted['trips']} {'/'.join(sorted(TRIP_CATEGORIES))} expense(s) to "
              f"{TRIP_CATEGORY!r} with a {TRIP_TAG!r} tag")


if __name__ == "__main__":
    main(*sys.argv[1:4])
