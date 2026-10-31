"""Regenerate pairs/<name>.png for every Verynize PNG that has Wonder evidence (preview parity audit).

Wonder's verified retake (<name>-verified/-confirmed/-ready/-menu/-retry) is used when it exists; excluded first attempts are skipped.

Wonder on the left, a 20 px magenta gutter, Verynize on the right; the canvas is magenta where a half is shorter.
Run from anywhere: python3 design/wonder/preview-audit/make-pairs.py
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
GUTTER, MAGENTA = 20, (255, 0, 255)


# Wonder retakes that supersede a failed first attempt (see wonder/notes.md, "Do not use attempted-state names").
PREFER = ("-verified", "-final")
# First attempts the Wonder notes exclude as evidence; they are never paired unless a retake exists.
# PP2-stopped-verified is valid evidence of the discard confirmation (not of the stopped result, which is PS5-paused).
EXCLUDED = {
    "PS1-hover.png", "PS2-card.png", "PS2-card-verified.png", "PS3-starting.png", "PF1-running.png", "PM1-toolbar.png",
    "PM1-toolbar-verified.png", "PM2-typed.png", "PM3-hover.png", "PF2-path.png", "PF2-path-about.png", "PF3-expanded.png",
    "PS4-error.png", "PS4-transition.png", "PS4-logs.png", "PM5-context.png", "X4-more-actions.png", "PP2-stopped.png",
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
print(f"{pair_dir(HERE / 'wonder', HERE / 'verynize' / 'after', HERE / 'pairs-after')} after-fix pairs")
