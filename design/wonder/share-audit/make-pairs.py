"""Regenerate the Share parity pairs: Wonder on the left, a 20 px magenta gutter, Verynize on the right.

- pairs/        Wonder vs Verynize before the Share work (verynize/*.png, captured by verynize/capture.cjs).
- pairs-after/  Wonder vs Verynize after it (verynize/after/**.png, captured by verynize/capture-after.cjs);
                pairs-after/collab/ holds the two-account flow (wonder-web/collab/).

Pairs line up by filename. Wonder's "Do not use" captures (the notes in wonder/, wonder-web/, wonder-web/collab/) are
never paired. The before captures used other names for the web build, mapped in BEFORE_ALIASES.
The canvas is magenta where a half is shorter. Run from anywhere: python3 design/wonder/share-audit/make-pairs.py
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
GUTTER, MAGENTA = 20, (255, 0, 255)

# "Do not use" in the Wonder notes (busy states, captures of the wrong surface, raced typing, stale lists).
EXCLUDED = {
    "SH1-idle.png", "SH3-escape.png", "SC1-multiplayer.png", "SI1-comma.png", "SW1-members.png", "SI3-sent.png",
    "SI5-revoked.png", "06-rectangle-deleted.png", "21-revoked-fresh-navigation.png",
}
# Before captures of the web build (verynize/web-*.png) → the Wonder web name they answer.
BEFORE_ALIASES = {
    "web-SH2-open.png": "chrome-SH2-open.png",
    "web-SL2-chrome-owner.png": "chrome-SL2-owner.png",
    "web-SL2-chrome-signedout.png": "chrome-SL2-signedout.png",
}
WONDER = [HERE / "wonder", HERE / "wonder-web"]


def wonder_for(name, folders):
    if name in EXCLUDED:
        return None
    for folder in folders:
        if (folder / name).exists():
            return folder / name
    return None


def pair(left, right, target):
    w = Image.open(left).convert("RGB")
    v = Image.open(right).convert("RGB")
    out = Image.new("RGB", (w.width + GUTTER + v.width, max(w.height, v.height)), MAGENTA)
    out.paste(w, (0, 0))
    out.paste(v, (w.width + GUTTER, 0))
    target.parent.mkdir(parents=True, exist_ok=True)
    out.save(target)


def clear(folder):
    folder.mkdir(exist_ok=True)
    for old in folder.rglob("*.png"):
        old.unlink()


def before():
    out = HERE / "pairs"
    clear(out)
    count = 0
    for shot in sorted((HERE / "verynize").glob("*.png")):
        name = BEFORE_ALIASES.get(shot.name, shot.name)
        left = wonder_for(name, WONDER)
        if left:
            pair(left, shot, out / name)
            count += 1
    return count


def after():
    out = HERE / "pairs-after"
    clear(out)
    count = 0
    for shot in sorted((HERE / "verynize" / "after").glob("*.png")):
        left = wonder_for(shot.name, WONDER)
        if left:
            pair(left, shot, out / shot.name)
            count += 1
    for shot in sorted((HERE / "verynize" / "after" / "collab").glob("*.png")):
        left = wonder_for(shot.name, [HERE / "wonder-web" / "collab"])
        if left:
            pair(left, shot, out / "collab" / shot.name)
            count += 1
    return count


print(f"{before()} pairs")
print(f"{after()} after pairs")
