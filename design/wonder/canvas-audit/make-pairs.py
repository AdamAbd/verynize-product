"""Regenerate pairs/<name>.png for every Verynize PNG that has Wonder evidence (canvas parity audit).

Wonder's verified retake (<name>-verified/-confirmed/-ready/-menu/-retry) is used when it exists; excluded first attempts are skipped.

Wonder on the left, a 20 px magenta gutter, Verynize on the right; the canvas is magenta where a half is shorter.
Run from anywhere: python3 design/wonder/canvas-audit/make-pairs.py
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
GUTTER, MAGENTA = 20, (255, 0, 255)


# Wonder retakes that supersede a failed first attempt (see wonder/notes.md, "Do not use attempted-state names").
PREFER = ("-verified", "-confirmed", "-ready", "-menu", "-retry", "-focused", "-final")
# First attempts the Wonder notes exclude as evidence; they are never paired unless a retake exists.
EXCLUDED = {
    "CM1-empty.png", "CM2-frame.png", "S4-frame.png", "S4-frame-verified.png", "CM3-text.png", "CM5-multi.png",
    "S2-escape.png", "T4-scale.png", "TX1-selection.png", "V4-return.png", "L1-rename.png", "L2-renamed.png",
    "TR2-rotate.png", "TR3-nudge.png", "T1-plus.png", "T1-shader.png", "T1-text.png", "T1-view-a.png", "T1-view-b.png",
}


def wonder_for(left, name):
    stem = name[:-4]
    for suffix in PREFER:
        if (left / f"{stem}{suffix}.png").exists() and f"{stem}{suffix}.png" not in EXCLUDED:
            return left / f"{stem}{suffix}.png"
    if name in EXCLUDED or not (left / name).exists():
        return None
    return left / name


def pair_dir(left, right, out):
    names = sorted(p.name for p in right.glob("*.png") if wonder_for(left, p.name))
    out.mkdir(exist_ok=True)
    for old in out.glob("*.png"):
        old.unlink()
    for name in names:
        w = Image.open(wonder_for(left, name)).convert("RGB")
        v = Image.open(right / name).convert("RGB")
        pair = Image.new("RGB", (w.width + GUTTER + v.width, max(w.height, v.height)), MAGENTA)
        pair.paste(w, (0, 0))
        pair.paste(v, (w.width + GUTTER, 0))
        pair.save(out / name)
    return len(names)


print(f"{pair_dir(HERE / 'wonder', HERE / 'verynize', HERE / 'pairs')} pairs")
