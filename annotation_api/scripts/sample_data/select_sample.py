"""Greedy, deterministic draft selection of sample alerts from the prod export."""

import csv
import json
import sys
from collections import Counter
from pathlib import Path

dataset, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)
rows = [json.loads(line) for line in (dataset / "manifest.jsonl").open()]


def features(r):
    objs = r["objects"]
    smoke = {t for o in objs for t in o["smoke_types"]}
    fps = sorted({t for o in objs for t in o["false_positive_types"]})
    kinds = {o["record_kind"] for o in objs}
    wf_boxed = any(
        "wildfire" in o["smoke_types"] and any(f["boxes"] for f in o["frames"])
        for o in objs
    )
    if len(kinds) > 1:
        cat = "mixed"
    elif "wildfire" in smoke:
        cat = "wildfire"
    elif "industrial" in smoke:
        cat = "industrial"
    elif smoke:
        cat = "other_smoke"
    else:
        cat = "false_positive"
    hour = int(r["recorded_at"][11:13])
    dets = {f["detection_id"] for o in objs for f in o["frames"]}
    return {
        "id": r["platform_alert_id"],
        "org": r["organisation_name"],
        "camera": r["camera_name"],
        "azimuth": r["azimuth"],
        "cat": cat,
        "smoke": sorted(smoke),
        "fps": fps,
        "n_objects": len(objs),
        "n_frames": len(dets),
        "night": hour >= 20 or hour <= 3,
        "wf_boxed": wf_boxed,
        "recorded_at": r["recorded_at"],
    }


feats = sorted((features(r) for r in rows), key=lambda f: f["id"])

# state -> category -> count
PLAN = {
    "to_classify": {
        "wildfire": 15,
        "industrial": 6,
        "other_smoke": 6,
        "false_positive": 24,
        "mixed": 3,
    },
    "to_localize": {"wildfire": 30},
    "done": {
        "wildfire": 12,
        "industrial": 5,
        "other_smoke": 5,
        "false_positive": 13,
        "mixed": 1,
    },
}
# Target share per organisation, largest organisation first. Sizes are read
# from the export so no real organisation name lives in this file.
ORG_SHARES = [0.45, 0.33, 0.22]
_org_sizes = Counter(f["org"] for f in feats).most_common()
if len(_org_sizes) > len(ORG_SHARES):
    sys.exit(
        f"ORG_SHARES covers {len(ORG_SHARES)} organisations, export has {len(_org_sizes)}"
    )
ORG_SHARE = {org: share for (org, _), share in zip(_org_sizes, ORG_SHARES)}
MULTI_SHARE, NIGHT_SHARE = 0.25, 0.12

used, picked = set(), []
# scarcest pool first: only boxed wildfire alerts can be loaded as to_localize
for state, cats in sorted(PLAN.items(), key=lambda kv: kv[0] != "to_localize"):
    state_rows = []
    total = sum(cats.values())
    for cat, n in cats.items():
        for _ in range(n):
            orgs = Counter(p["org"] for p in state_rows)
            seen_fp = Counter(t for p in state_rows for t in p["fps"])
            seen_cam = Counter(p["camera"] for p in state_rows)
            k = len(state_rows) + 1
            multi_def = MULTI_SHARE * k - sum(p["n_objects"] > 1 for p in state_rows)
            night_def = NIGHT_SHARE * k - sum(p["night"] for p in state_rows)

            def score(f):
                s = 3 * (ORG_SHARE[f["org"]] * k - orgs[f["org"]])
                s += sum(1.0 / (1 + seen_fp[t]) for t in f["fps"]) / max(
                    1, len(f["fps"])
                )
                # a camera seen once already is welcome (recurring-object groups), more is not
                s += {0: 0.3, 1: 0.5}.get(seen_cam[f["camera"]], -0.5)
                s += multi_def if f["n_objects"] > 1 else 0
                s += night_def if f["night"] else 0
                s -= 0.02 * max(0, f["n_frames"] - 25)
                return s

            cands = [
                f
                for f in feats
                if f["id"] not in used
                and f["cat"] == cat
                and (state != "to_localize" or f["wf_boxed"])
                and (state != "done" or cat != "wildfire" or f["wf_boxed"])
            ]
            if not cands:
                print(f"no candidate left for {state}/{cat}")
                continue
            best = max(cands, key=lambda f: (score(f), -f["id"]))
            used.add(best["id"])
            state_rows.append({**best, "load_state": state})
    picked += state_rows

with (out_dir / "selection.csv").open("w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(
        [
            "load_state",
            "platform_alert_id",
            "organisation",
            "camera",
            "azimuth",
            "category",
            "smoke_types",
            "false_positive_types",
            "n_objects",
            "n_frames",
            "night",
            "recorded_at",
        ]
    )
    for p in picked:
        w.writerow(
            [
                p["load_state"],
                p["id"],
                p["org"],
                p["camera"],
                p["azimuth"],
                p["cat"],
                "|".join(p["smoke"]),
                "|".join(p["fps"]),
                p["n_objects"],
                p["n_frames"],
                int(p["night"]),
                p["recorded_at"],
            ]
        )
(out_dir / "alert_ids.txt").write_text("\n".join(str(p["id"]) for p in picked) + "\n")

C = Counter
print(
    "total",
    len(picked),
    "frames",
    sum(p["n_frames"] for p in picked),
    "est_MB",
    round(sum(p["n_frames"] for p in picked) * 125 / 1024),
)
for state in PLAN:
    ps = [p for p in picked if p["load_state"] == state]
    print(f"\n{state}: {len(ps)}")
    print("  org", dict(C(p["org"] for p in ps)))
    print("  cat", dict(C(p["cat"] for p in ps)))
    print(
        "  multi",
        sum(p["n_objects"] > 1 for p in ps),
        "night",
        sum(p["night"] for p in ps),
        "cameras",
        len({p["camera"] for p in ps}),
    )
    print("  fp", dict(C(t for p in ps for t in p["fps"])))
print("\nall fp types", dict(C(t for p in picked for t in p["fps"])))
print(
    "cameras",
    len({p["camera"] for p in picked}),
    "of",
    len({f["camera"] for f in feats}),
)
print(
    "cam+azimuth pairs with >=2 alerts",
    sum(v >= 2 for v in C((p["camera"], p["azimuth"]) for p in picked).values()),
)
