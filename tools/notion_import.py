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
              "Expenses Remunerated": "offset", "Redeemed CC Points": "offset"}
XFER_ROLES = {"Payment to CC": "cc_payment", "Savings": "savings_in",
              "Savings Takeout": "savings_out", "Investment - IRA": "invest_retirement",
              "Investment - Stocks & Cryptos": "invest_taxable",
              "Cash Withdraw": "cash_withdrawal", "General Transfer": "general"}
EXP_ROLES = {"Charity": "charity", "Loan": "loan"}
DROP_TAGS = {"", "Misc."}


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
    for r in A:
        t = acct_type(r["Name"], r["Type"])
        ob = cents(r["Opening Balance"])
        a = {"id": slug("a", r["Name"]), "name": r["Name"], "type": t,
             "ref": (r.get("Acc ID") or r.get("Acc No.") or "").strip(),
             "opening": -ob if t == "credit" else ob}
        if t == "credit":
            a["limit"] = cents(r["Credit Limit"])
        acct_id[r["Name"]] = a["id"]
        accounts.append(a)
    order = ["checking", "savings", "cash", "credit", "investment"]
    accounts.sort(key=lambda a: (order.index(a["type"]), a["name"]))

    RENAME = {"ce": {"Transfer": "Transfer to external account"}}

    def cats(rows, roles, prefix):
        names = sorted({RENAME.get(prefix, {}).get(r["Category"], r["Category"]) for r in rows})
        return [dict({"id": slug(prefix, n), "name": n}, **({"role": roles[n]} if n in roles else {}))
                for n in names]

    def sort_rows(rows):
        return sorted(rows, key=lambda r: (date(r["Date"]), r.get("Created time", "")))

    tags_seen, expenses = {}, []
    for i, r in enumerate(sort_rows(E), 1):
        tags = []
        for t in (r["Sub-Category"] or "").split(", "):
            t = t.strip()
            if t in DROP_TAGS: continue
            tags_seen[t] = tags_seen.get(t, 0) + 1
            tags.append(slug("t", t))
        expenses.append({"id": f"e{i:04d}", "date": date(r["Date"]), "item": r["Item"].strip(),
                         "amount": cents(r["Amount"]), "account": acct_id[clean(r["Debited From"])],
                         "cat": slug("ce", RENAME["ce"].get(r["Category"], r["Category"])), "tags": tags, "notes": r["Notes"].strip()})

    earnings = []
    for i, r in enumerate(sort_rows(I), 1):
        e = {"id": f"i{i:04d}", "date": date(r["Date"]), "item": r["Item"].strip(),
             "amount": cents(r["Amount"]), "account": acct_id[clean(r["Credited To"])],
             "cat": slug("ci", r["Category"]), "notes": r["Notes"].strip()}
        if EARN_ROLES.get(r["Category"]) == "offset":
            e["offsets"] = None
        earnings.append(e)

    transfers = []
    for i, r in enumerate(sort_rows(T), 1):
        transfers.append({"id": f"x{i:04d}", "date": date(r["Date"]), "item": r["Item"].strip(),
                          "amount": cents(r["Amount"]), "from": acct_id[clean(r["Debited From"])],
                          "to": acct_id[clean(r["Credited To"])], "cat": slug("ct", r["Category"]),
                          "notes": r["Notes"].strip()})

    doc = {"app": "money-tracker", "schema": 1, "year": int(year),
           "exportedAt": datetime.now().isoformat(timespec="seconds"),
           "accounts": accounts,
           "categories": {"expense": cats(E, EXP_ROLES, "ce"),
                          "earning": cats(I, EARN_ROLES, "ci"),
                          "transfer": cats(T, XFER_ROLES, "ct")},
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


if __name__ == "__main__":
    main(*sys.argv[1:4])
