"""Regenerate pairs/<name>.png for every PNG present in both wonder/ and verynize/.

Wonder on the left, a 20 px magenta gutter, Verynize on the right; the canvas is magenta where a half is shorter.
Run from anywhere: python3 design/wonder/properties-audit/make-pairs.py
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
GUTTER, MAGENTA = 20, (255, 0, 255)

names = sorted({p.name for p in (HERE / "wonder").glob("*.png")} & {p.name for p in (HERE / "verynize").glob("*.png")})
out = HERE / "pairs"
out.mkdir(exist_ok=True)
for old in out.glob("*.png"):
    old.unlink()
for name in names:
    w = Image.open(HERE / "wonder" / name).convert("RGB")
    v = Image.open(HERE / "verynize" / name).convert("RGB")
    pair = Image.new("RGB", (w.width + GUTTER + v.width, max(w.height, v.height)), MAGENTA)
    pair.paste(w, (0, 0))
    pair.paste(v, (w.width + GUTTER, 0))
    pair.save(out / name)
print(f"{len(names)} pairs")
