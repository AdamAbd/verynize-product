<!-- get_design_guidelines {"style": "terminal"} — style section only. The live result is 01-design-fundamentals.md (byte-identical) + "\n\n---\n\n" + this file. Captured 2026-10-30, Wonder 0.2.190. -->

# Terminal CLI

The command line as a design language: brutally functional, high-contrast and authentically retro, like configuring a server in a clean ZSH or Bash shell (not Matrix rain). Shell metaphors carry the interface, and the cursor is its heartbeat.

**Palette.** Dark only, a phosphor monitor.

- Ground `#0a0a0a` (slightly lifted from black so scanlines show).
- Bright green `#33ff00` for main text, cursors and active elements; dimmed green `#1f521f` for borders, and `#36A126` for inactive text.
- Amber `#ffb000` for warnings and accents; red `#ff3333` for errors.
- Tokens the examples bind: `--black` #000000, `--green` #33FF00, `--green-dim` #1F521F, `--ground` #0A0A0A, `--phosphor-glow` rgba(51,255,0,0.5), `--scanline` rgba(0,0,0,0.25).

**Type.** Monospace for every character, headlines to footer links: `JetBrains Mono`, `Fira Code` or `VT323`. Headers in capitals; sizes snap to a strict modular scale. Green text glows with phosphor persistence: `[text-shadow:0_0_5px_var(--phosphor-glow)]`. Glow depth replaces drop shadows with zero-offset colored shadows, shadow-[0_0_<blur>px_<color>], stacked from a tight bright layer to a wide faint one; text glows use drop-shadow-[0_0_<blur>px_<color>].

**Shape and depth.** Square corners, no shadows. Panes are drawn with 1px solid or dashed borders. CRT scanlines cover the page. A repeating pattern is one pointer-events-none absolute inset-0 layer, its text color the pattern's color token at the style's opacity, holding an svg whose rect fills with a <pattern> tile (patternUnits="userSpaceOnUse") drawn in currentColor. The canvas never tiles a CSS gradient, so a background-size tile or a repeating gradient cannot build one. CRT scanlines are a repeating pattern in var(--scanline) over the screen they cover, whose tile is 4px square with a band across its lower 2px.

**Components.**

- Buttons read as commands in brackets, `[ INITIATE ]`: outlined `text-[var(--green)] border border-[var(--green)] bg-transparent`, or inverted video `bg-[var(--green)] text-[var(--black)]`.
- Cards are windows: `bg-[var(--ground)] border border-[var(--green-dim)]` with an ASCII title bar (`+--- SYSTEM STATUS ---+`) or a solid inverted bar, and padded mono text inside.
- Inputs have no box: a prompt prefix `user@acme:~$`, then `bg-transparent border-none text-[var(--green)] caret-[var(--green)]` with a static `█` cursor.
- Small `w-4 h-4` line icons (VS Code style) in green.

**Signature moves.**

- An ASCII-art logo and ASCII graphics in place of images.
- Data as text: progress bars like `[||||||||||.....]` instead of graphical charts.
- Prompt characters (`>`, `$`, `~`), command flags (`--help`) and status codes (`[OK]`, `[ERR]`) throughout.
- Dividers drawn with characters: `----------------`, `================`, `//`.

**Layout.** A grid of terminal windows like `tmux` or `vim` splits, aligned to a rigid character grid; a uniform spine of panes is the style.
