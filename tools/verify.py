#!/usr/bin/env python3
"""Recompute Notion's summary figures from a money-tracker JSON file and compare
them with the Monthly/Yearly Summary CSVs from the same Notion export.

Usage: python3 -I verify.py <data.json> <export_dir>
"""
import csv, glob, json, os, re, sys
from collections import defaultdict


def _match(export_dir, pattern):
    """'*Accounts*_all.csv' -> files named '[Money Tracker ]Accounts <year> <id>_all.csv'
    (so 'Transfers Between Accounts' does not match 'Accounts')."""
    key = pattern.strip("*").split("*")[0]
    rx = re.compile(r"^(Money Tracker )?" + re.escape(key) + r"\b.*_all\.csv$")
    return [p for p in glob.glob(os.path.join(export_dir, "**", "*_all.csv"), recursive=True)
            if rx.match(os.path.basename(p))]


def load_csv(export_dir, pattern):
    path = _match(export_dir, pattern)[0]
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def c(s):
    s = (s or "").replace("$", "").replace(",", "").strip()
    return round(float(s) * 100) if s else 0


def metrics(d, month=None):
    """Notion-equivalent (gross) metrics plus the new net view. month='MM' or None for YTD."""
    acct = {a["id"]: a for a in d["accounts"]}
    role = {x["id"]: x.get("role") for k in d["categories"] for x in d["categories"][k]}
    sel = lambda rows: [r for r in rows if month is None or r["date"][5:7] == month]
    E, I, T = sel(d["expenses"]), sel(d["earnings"]), sel(d["transfers"])
    m = defaultdict(int)
    for r in E:
        m["spent"] += r["amount"]
        m["spent_" + {"credit": "card", "cash": "cash"}.get(acct[r["account"]]["type"], "bank")] += r["amount"]
        if role.get(r["cat"]) == "charity": m["charity"] += r["amount"]
        if role.get(r["cat"]) == "loan": m["loan"] += r["amount"]
        if "t_india" in r["tags"]: m["india"] += r["amount"]
    for r in I:
        m["earned"] += r["amount"]
        m["paycheck" if role[r["cat"]] == "paycheck" else "other_earned"] += r["amount"]
        if role[r["cat"]] == "offset": m["offsets"] += r["amount"]
    for r in T:
        ro = role[r["cat"]]
        if ro == "cc_payment": m["cc_payments"] += r["amount"]
        if ro == "savings_in": m["savings"] += r["amount"]
        if ro == "savings_out": m["savings"] -= r["amount"]
        if ro == "invest_retirement": m["ira"] += r["amount"]
        if ro == "invest_taxable": m["stocks"] += r["amount"]
    m["surplus"] = m["earned"] - m["spent"]
    m["investment"] = m["ira"] + m["stocks"]
    m["net_spent"] = m["spent"] - m["offsets"]
    m["net_income"] = m["earned"] - m["offsets"]
    return m


def balances(d):
    bal = {a["id"]: a["opening"] for a in d["accounts"]}
    for r in d["expenses"]: bal[r["account"]] -= r["amount"]
    for r in d["earnings"]: bal[r["account"]] += r["amount"]
    for r in d["transfers"]:
        bal[r["from"]] -= r["amount"]; bal[r["to"]] += r["amount"]
    return bal


def main(path, export_dir):
    d = json.load(open(path, encoding="utf-8"))
    fails = 0

    def check(label, got, want):
        nonlocal fails
        ok = got == want
        fails += not ok
        if not ok: print(f"  MISMATCH {label}: json={got/100:,.2f} notion={want/100:,.2f}")

    # account closing balances
    notion_acc = {r["Name"]: r for r in load_csv(export_dir, "*Accounts*_all.csv")}
    bal = balances(d)
    for a in d["accounts"]:
        check(f"balance {a['name']}", bal[a["id"]], c(notion_acc[a["name"]]["Closing Balance"]))

    # monthly + yearly summaries
    cols = {"earned": "Amount Earned", "paycheck": "Earnings from Paychecks",
            "other_earned": "Earnings from Other Sources", "spent": "Amount Spent",
            "spent_bank": "Amount Spent from Bank", "spent_card": "Amount Spent in Card",
            "spent_cash": "Amount Spent in Cash", "cc_payments": "CC Payments Made",
            "surplus": "Balance", "savings": "Gross Savings", "investment": "Investment",
            "ira": "Investment in IRA", "stocks": "Investment in S&C",
            "charity": "Charity Amount", "india": "Send to India"}
    months = ["January", "February", "March", "April", "May", "June", "July",
              "August", "September", "October", "November", "December"]
    n_checked = 0
    for r in load_csv(export_dir, "*Monthly*_all.csv"):
        mm = f"{months.index(r['Name'].strip()) + 1:02d}"
        m = metrics(d, mm)
        for k, col in cols.items():
            if col in r and r[col].strip():
                check(f"{r['Name']} {col}", m[k], c(r[col])); n_checked += 1
    y = load_csv(export_dir, "*Yearly*_all.csv")[0]
    m = metrics(d)
    for k, col in cols.items():
        key = next((h for h in y if h.lower().startswith(col.lower()) and "rollup" in h.lower()), None)
        if key and y[key].strip():
            check(f"YTD {col}", m[k], c(y[key])); n_checked += 1

    cash = sum(bal[a["id"]] for a in d["accounts"] if a["type"] in ("checking", "savings", "cash"))
    debt = -sum(bal[a["id"]] for a in d["accounts"] if a["type"] == "credit")
    limit = sum(a["limit"] for a in d["accounts"] if a["type"] == "credit")
    print(f"{len(d['accounts'])} balances + {n_checked} summary figures checked, {fails} mismatches")
    print(f"YTD earned {m['earned']/100:,.2f} | spent {m['spent']/100:,.2f} | surplus {m['surplus']/100:,.2f}")
    print(f"cash {cash/100:,.2f} | card debt {debt/100:,.2f} | net {(cash-debt)/100:,.2f} | "
          f"utilization {debt/limit:.2%}")
    print(f"NEW net view: offsets {m['offsets']/100:,.2f} | net income {m['net_income']/100:,.2f} | "
          f"net spending {m['net_spent']/100:,.2f} | surplus unchanged {m['surplus']/100:,.2f}")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
