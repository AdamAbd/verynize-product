"""Regenerate pairs/<name>.png for every PNG present in both wonder/ and verynize/,
and pairs-after/<name>.png for every PNG in both wonder/ and verynize/after/ (after-fix proof;
Wonder's `<name>-confirmed.png` retake is used when it exists).

Wonder on the left, a 20 px magenta gutter, Verynize on the right; the canvas is magenta where a half is shorter.
Run from anywhere: python3 design/wonder/properties-audit/make-pairs.py
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
GUTTER, MAGENTA = 20, (255, 0, 255)


def pair_dir(right, out, prefer_confirmed=False):
    names = sorted({p.name for p in (HERE / "wonder").glob("*.png")} & {p.name for p in right.glob("*.png")})
    out.mkdir(exist_ok=True)
    for old in out.glob("*.png"):
        old.unlink()
    for name in names:
        left = HERE / "wonder" / name
        confirmed = left.with_name(left.stem + "-confirmed.png")
        if prefer_confirmed and confirmed.exists():
            left = confirmed
        w = Image.open(left).convert("RGB")
        v = Image.open(right / name).convert("RGB")
        pair = Image.new("RGB", (w.width + GUTTER + v.width, max(w.height, v.height)), MAGENTA)
        pair.paste(w, (0, 0))
        pair.paste(v, (w.width + GUTTER, 0))
        pair.save(out / name)
    return len(names)


print(f"{pair_dir(HERE / 'verynize', HERE / 'pairs')} pairs")
print(f"{pair_dir(HERE / 'verynize' / 'after', HERE / 'pairs-after', True)} after-fix pairs")
