"""Asset provenance: checks every committed art, audio and font file against assets-manifest.json.

    python3 -I tools/assets.py lint      # CI: every file has a source and an allowed licence; nothing forbidden is committed
    python3 -I tools/assets.py credits   # writes CREDITS.md from the manifest

lint fails when a file under one of the manifest's roots matches no entry, when an entry's licence is not
allowed, when a CC BY entry has no credit line, or when a forbidden file (the Tiny Swords Free Pack) is
tracked by git. It warns, without failing, about scripts that still load forbidden assets at runtime.
"""
import json
import os
import re
import subprocess
import sys
from functools import lru_cache

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = json.load(open(os.path.join(ROOT, "assets-manifest.json")))


@lru_cache(maxsize=None)
def _regex(glob):
    # ** spans folders, * and ? stay inside one (works on any Python 3, unlike PurePath.full_match)
    out, i = "", 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out, i = out + "(?:.*/)?", i + 3
        elif glob.startswith("**", i):
            out, i = out + ".*", i + 2
        elif glob[i] == "*":
            out, i = out + "[^/]*", i + 1
        elif glob[i] == "?":
            out, i = out + "[^/]", i + 1
        else:
            out, i = out + re.escape(glob[i]), i + 1
    return re.compile(out + r"\Z")


def match(path, glob):
    return _regex(glob).match(path) is not None


def tracked():
    out = subprocess.run(["git", "ls-files", "-z", *MANIFEST["roots"]], cwd=ROOT, capture_output=True, check=True).stdout
    return [p for p in out.decode().split("\0") if p]


def entry_for(path):
    return next((e for e in MANIFEST["entries"] if match(path, e["glob"])), None)


def lint():
    errors, warnings = [], []
    allowed = set(MANIFEST["allowed_licences"])
    for e in MANIFEST["entries"]:
        if e["licence"] not in allowed:
            errors.append(f"entry {e['glob']}: licence {e['licence']} is not allowed")
        if e["licence"].startswith("CC-BY") and not e.get("credit"):
            errors.append(f"entry {e['glob']}: CC BY needs a credit line")
    files = tracked()
    counted = 0
    for path in files:
        if any(match(path, f["glob"]) for f in MANIFEST["forbidden"]):
            errors.append(f"{path}: forbidden in git")
            continue
        if any(match(path, s) for s in MANIFEST["skip"]):
            continue
        counted += 1
        if not entry_for(path):
            errors.append(f"{path}: no manifest entry (add one to assets-manifest.json)")
    # runtime references to forbidden assets: allowed for now, but visible
    for f in MANIFEST["forbidden"]:
        folder = f["glob"].split("/**")[0].split("/")[-1]
        for dirpath, _, names in os.walk(os.path.join(ROOT, "godot", "scripts")):
            for n in names:
                if n.endswith(".gd") and folder in open(os.path.join(dirpath, n), encoding="utf-8").read():
                    warnings.append(f"godot/scripts/{n} loads {folder} at runtime: a clean clone needs tools/fetch-tinyswords.mjs")
    for w in warnings:
        print("warning:", w)
    for e in errors:
        print("error:", e)
    print(f"{counted} asset files checked, {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


LICENCE_NAMES = {
    "CC0-1.0": "CC0 1.0 (public domain)", "CC-BY-3.0": "CC BY 3.0", "CC-BY-4.0": "CC BY 4.0",
    "OFL-1.1": "SIL Open Font License 1.1", "project": "made for this project", "ai-generated": "AI-generated for this project",
}


def credits():
    seen, rows = set(), []
    for e in MANIFEST["entries"]:
        key = (e["author"], e.get("url") or e.get("generator"))
        if key in seen or e["licence"] in ("project",):
            continue
        seen.add(key)
        rows.append(e)
    lines = [
        "# Credits",
        "",
        "Generated from `assets-manifest.json` by `python3 tools/assets.py credits`. Do not edit by hand.",
        "",
        "Code: MIT. Game design and code: the Bannerfall project.",
        "",
        "| Asset | Author | Licence | Source |",
        "|---|---|---|---|",
    ]
    for e in rows:
        src = e.get("url") or e.get("generator", "")
        lines.append(f"| {e['name']} | {e['author']} | {LICENCE_NAMES[e['licence']]} | {src} |")
    attributions = sorted({e["credit"] for e in rows if e.get("credit")})
    if attributions:
        lines += ["", "## Required attributions", ""] + [f"- {a}" for a in attributions]
    lines += [
        "",
        "Not included: the Tiny Swords Free Pack by Pixel Frog is free for commercial use but may not be",
        "redistributed, so it is fetched at setup time by `tools/fetch-tinyswords.mjs` and never committed.",
        "",
    ]
    open(os.path.join(ROOT, "CREDITS.md"), "w").write("\n".join(lines))
    print("wrote CREDITS.md")
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "lint"
    sys.exit({"lint": lint, "credits": credits}[cmd]())
