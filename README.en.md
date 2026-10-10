<div align="right">

**English** | [简体中文](README.md)

</div>

# TXT Reader

A **browser-based, single-file** TXT reading tool, purpose-built for long-form Chinese content such as novels, logs, and scripts. It auto-detects GBK / Big5 / UTF-8 encodings, paginates by real rendered lines, and offers wildcard search, sentence-based layout, a draggable wrap-boundary ruler, distraction-free reading, eye-care themes, and keyboard shortcuts — bringing you back to immersive reading.

> **v1.25** · Pure front-end · Zero dependencies · Works out of the box

---

## 📌 Overview

A browser-based TXT reading tool designed for long-form Chinese content such as novels, logs, and scripts. It supports automatic GBK / Big5 / UTF-8 encoding detection, paginates by actual rendered lines, and provides wildcard search, sentence-based text layout, a draggable wrap-boundary ruler, a distraction-free reading mode, eye-care themes, and keyboard shortcuts for a fully immersive experience.

## ✨ Features

- **Automatic encoding detection**: Smartly detects GBK / Big5 / UTF-8, with manual override available.
- **Real-line pagination**: Calculates page numbers based on actual wrapped visual lines for precise paging.
- **Wildcard search & locate**: `*` matches any-length sequences and `?` matches a single character — supported in both file search and body-text search; cyclic jumping, inline highlighting, and an "X/N match" counter.
- **Simple layout · sentence segmentation**: The main reading view and the "✒ Simple Layout" dialog share one layout engine (the `Layout` module) — one sentence per paragraph with blank lines between paragraphs; consecutive short dialogue lines are merged without blank lines; line breaks after non-sentence-ending punctuation (e.g. commas) are automatically joined back into the same sentence; runs of em-dashes `——` / ellipses `……` act as forced paragraph separators.
- **Consecutive punctuation handling**:
  - Runs/mixes of sentence-ending punctuation (`！！`, `？！`, `!?`, `。。。`) count as **one** sentence boundary — never split, collapsed, or converted; the original style is preserved;
  - Closing quotes/brackets right after sentence-ending punctuation (`！”`, `。”`, `……”`, `！”）`) belong to the **previous** sentence — they never form a paragraph of their own or get attached to the start of the next sentence;
  - Leading quotes/brackets (`“`, `《`, `（`) belong to the sentence that follows;
  - Sentence-boundary detection (whether a newline is kept, whether to split) uses the same "sentence-ending punctuation run + optional closing marks" rule, so line breaks like `“你好！”\n他走了。` are no longer lost;
  - Decorative long-punctuation dividers are still removed, but an in-sentence ellipsis with a closing mark (e.g. `……”`) is preserved and re-attached to the previous paragraph — no characters are dropped.
- **Wrap-boundary ruler**: A Word-style horizontal ruler above the reading area — drag to set the wrap column (live preview while dragging, re-layout on release), double-click to restore auto width; the setting is persisted.
- **Text-to-speech (TTS)**: Reads the text sentence by sentence. The line being spoken carries **unmistakable markers** (leading `▶` + bottom underline + left bar + full-line tint) that move with playback; marker colours switch by reading-background lightness, so they stay legible in **every theme × reading-palette combination**. Start rule: the **first line of the current page** by default; **click any line** in the body to set a manual start line (click again to clear), and the selected line takes priority over the page start. Supports pause / resume / stop, a real-time 0.5–2.0× rate slider, Chinese voice picker, and a follow-scroll toggle; sentences are **joined gaplessly** (the next one is pre-queued into the engine), so there is no perceptible wait between paragraphs.
- **Automatic progress saving**: Reading positions are remembered per file independently, keyed by a content fingerprint (FNV-1a) to prevent cross-file mix-ups; one-click restore / clear.
- **Distraction-free mode**: One-click hide the UI; customize font size, font family, width, and background color.
- **Eye-care themes**: Warm paper-like light mode / non-pure-black soft-contrast dark mode / follow-system, one-click toggle.
- **Auto page-turn**: Configurable 15–90 seconds per page, start/stop with the spacebar.
- **Font size steps**: 14 / 16 / 18 / 20 / 24 (default) / 28 / 32 / 36px.

## ⌨ Keyboard Shortcuts

| Key | Action |
|------|------|
| `PageUp` | Previous page |
| `PageDown` | Next page |
| `Home` | Jump to start |
| `End` | Jump to end |
| `Space` | Start / stop auto page-turn |
| `R` | Enter / exit distraction-free mode |
| `Esc` | Exit distraction-free mode |
| `Ctrl` + `↑` | Previous file |
| `Ctrl` + `↓` | Next file |
| `Ctrl` + `←` | Previous match |
| `Ctrl` + `→` | Next match |

## 🚀 Getting Started

1. Click "**Open File**" or "**Open Folder**" in the top bar to load TXT files
2. Switch files in the left "File List"; both file search and body-text search accept `*` / `?` wildcards — type and press Enter (or the search button) to jump
3. Adjust encoding, line-wrapping, font size (14–36px), and theme in the top bar; click "✒ Body Layout" to toggle sentence-based paragraphing in the main view
4. The "✒ Simple Layout" dialog: paste a large block of text, it re-paragraphs by sentences in real time, with one-click copy
5. Drag the **ruler** above the reading area to set the wrap boundary (takes effect on release); double-click to restore auto
6. Click "📖 Distraction-Free Reading" for immersive mode; adjust font size, font family, page width, and background color; press R or Esc to exit
7. Reading progress is **saved automatically**; click "**↺ Restore Progress**" on the page bar to return to where you left off
8. Click "**🔊 Speak**" in the top bar to start listening in distraction-free mode (starts at the **first line of the current page** by default); to start from a given line, **click that line** first, then hit Speak; click the same line again to clear it

> **Tip**: When the encoding/font-size dropdowns are focused, PageUp / PageDown won't trigger page-turns, preventing accidental navigation.

## 🛣 Roadmap

Formal plans live in [`docs/plans/`](docs/plans/README.md). **Current code version: `v1.25-toc`** (latest stable freeze line: `v1.12-stable`); plan docs baseline `plans-v1.0-frozen`.

| ID | Name | Priority | Effort | Status |
|---|---|---|---|---|
| `PLAN-2026-1001-A` | Local file write-back & export | **P0** | M | **✅ Delivered in v1.10** |
| `PLAN-2026-1001-B` | Text-to-speech reading | P1 | M | **✅ Delivered in v1.13** |
| `PLAN-2026-1001-C` | Large-file performance & mobile | P1 | L | **✅ Delivered in v1.18** — stages 1/2/3 plus item 3 "chunked scheduling"; 100k-line first paint 383 → **138 ms**, meeting the <300 ms target. See [`bench/README.md`](bench/README.md). **v1.19 closes its last remaining item** (landscape phone reader 53 → 111 px) |
| `PLAN-2026-1001-D` | Highlights & knowledge-base export | P2 | L | **✅ Delivered in v1.20 · v1.21 fixed excerpts spanning blank lines** — select-to-excerpt floating toolbar, highlights layered into the chunked render pipeline, sidebar excerpt panel, Markdown export with `[[filename]]` backlinks; acceptance [`bench/plan-d.js`](bench/plan-d.js) 28/28, blank-line regression [`bench/plan-d-blank.js`](bench/plan-d-blank.js) 17/17 |

> Suggested order: A → B → C → D. Frozen plans stay unchanged; revisions bump the version (v1.0 → v1.1) and append a change log inside the document.

## ⚠️ Known Issues

**Pasting a large block of text into the "Simple layout" dialog may stutter.**

- **Cause**: when pasting large text, browsers deliver `input` events in chunks; combined with live re-layout this triggers repeated full recomputation and DOM rewrites.
- **Workaround**: save the content as a `.txt` file, load it via "Open file", **copy from the main view**, then paste into the dialog — `FileReader` reads the whole file in one shot, so there is no chunking.
- **Clarification**: this is *not* a capacity limit. There is **no character limit** in the code, and the layout algorithm benchmarks at ~**20 ms for 500,000 Chinese characters**. The bottleneck is clipboard chunking, not the algorithm.

## 🔄 Version History

> **Versioning**: follows [Semantic Versioning](https://semver.org/) (SemVer) — `v1.9` is followed by `v1.10` (the **tenth** minor release, not a typo), just like `2.9` is followed by `2.10`. Rows are ordered newest → oldest.

| Version | Tag | Date | Notes |
|------|------|------|------|
| v1.20 | `v1.20-annotate-export` | 2026-10-10 | Highlights & knowledge-base export (PLAN-D): (1) **Select-to-excerpt** — selecting text pops a floating toolbar (highlight / excerpt / copy), recording line number and timestamp automatically with optional note; (2) **Storage** — excerpts live in localStorage keyed by file content fingerprint (separate namespace from progress); each excerpt stores a text snapshot and is re-located by text search (nearest match to the original line), so **layout toggles, re-opening files and chunked fill never shift it**; (3) **Highlight rendering** — character-level spans as the base layer, merged with search `<mark>` in one segmenter (search claims the overlap), wired into the PLAN-C chunked render pipeline; (4) **Sidebar excerpt panel** — grouped per file, click to jump back, per-item delete, removed files marked "exportable, not jumpable"; (5) **Markdown export** — `> quote` blocks plus `[[filename]]` backlinks (recognized by Obsidian directly), via clipboard / FSA save-to-vault / Blob download; (6) **Fixed a latent v1 bug** — the toast element sat after the script, so `showToast` always threw a silent `TypeError` (15+ notifications never actually showed; confirmed via CDP); the element now precedes the script. Acceptance [`bench/plan-d.js`](bench/plan-d.js) **28/28**; zero regression on the 100k-line benchmark (first paint 193.5 ms / heap 28.3 MB) and across all three mobile viewports |
| v1.21 | `v1.21-blank-excerpt` | 2026-10-10 | Fixed **excerpts failing to span blank lines**: selection capture filtered by "intra-line interval e>s", so a blank line's `[0,0)` interval was dropped; the text snapshot lost the blank line (`"A\nB"` instead of `"A\n\nB"`), and the reverse text search broke at the real blank line — no highlight, no jump. Three fixes: (1) blank lines covered by the selection are kept as `[0,0)` placeholders in the per-line merge table (the snapshot preserves `\n\n`); (2) logical lines between the first and last hit lines are filled as whole lines (guards against `intersectsNode` misses); (3) the reverse search trims leading/trailing empty segments (edge case where the selection starts/ends on a blank line). New regression [`bench/plan-d-blank.js`](bench/plan-d-blank.js) **17/17** (synthetic blank / real blank / panel jump / layout-toggle stability / selection ending on a blank / export quote block); the original PLAN-D acceptance still passes 28/28. Known boundary (pre-existing since v1.20, not introduced here): a multi-line excerpt spanning a *layout-synthetic* blank loses its anchor after toggling layout off — the snapshot is per-logical-line and the two views differ; excerpts spanning *real* blank lines are stable in both views |
| v1.22 | `v1.22-panel-solo` | 2026-10-10 | **Sidebar panel solo**: single-click a panel header (Files / Search / Excerpts) and that panel fills the remaining sidebar space while the others collapse to header bars (body hidden, chevron rotated); two clicks on the same header within 400 ms (equivalent to double-click, works on touch too) restore the default three-panel split; clicking another header while soloed switches the solo directly. Buttons inside headers (collapse chevron / panel actions) keep their original behavior and never trigger solo; a previously collapsed panel is expanded automatically when soloed. Implementation: pure CSS shrink via `.sidebar.solo-mode` (non-soloed panels `flex: 0 0 auto` + body `display: none`, soloed panel `flex: 1 1 0`); the double-click detection uses a manual 400 ms window instead of native `dblclick` (touch double-taps also fire click, so desktop and mobile behave identically). New regression [`bench/panel-solo.js`](bench/panel-solo.js) **22/22** (default split / click-to-solo / buttons unaffected / solo switching / double-click restore / soloing a collapsed panel expands it) |
| v1.23 | `v1.23-solo-click-restore` | 2026-10-10 | **Solo restore now uses a single click** (interaction simplification from v1.22): restoring the same panel changed from "two clicks within 400 ms (double-click equivalent)" to **clicking the soloed panel's header again** — both solo and restore are single clicks, no timing window; clicking another header while soloed still switches directly, and header buttons remain unaffected. Removed the 400 ms double-click window logic (`soloLastClick`); regression [`bench/panel-solo.js`](bench/panel-solo.js) case 4 switched from double-click to single-click, **22/22** |
| v1.24 | `v1.24-head-title` | 2026-10-10 | **Book title at file head gets its own paragraph**: the first line of a file is usually a book title (with or without 《》) and carries no sentence-end punctuation, so the newline-cleaning pass before sentence splitting glued "title\Nbody" into one paragraph. Fix: `layoutParas` gains a `head` parameter — full-text entry points (`simpleLayout` / `simpleLayoutLines` / the chunked layout's first chunk at `cursor===0`) lift the first non-empty line into its own paragraph first; conservative detection: ① a leading 《…》 prefix is the title (same-line remainder flows back into the body); ② without 《》, the line must be ≤30 chars and contain no sentence punctuation at all; a first line with sentence punctuation or an overlong line behaves exactly as before. Chunked layout extracts only in the first chunk, item-for-item identical to full-text layout. New regression [`bench/head-title.js`](bench/head-title.js) **11/11**; PLAN-D 28/28 / blank-line 17/17 / panel-solo 22/22 zero regressions (also fixed plan-d.js test infra: a reused profile with leftover excerpt localStorage shreds text nodes and made the selection helper throw IndexSizeError — case 0 now clears storage and reloads first) |
| v1.25 | `v1.25-toc` | 2026-10-10 | **Sidebar chapter TOC**: a fourth panel "目录" auto-detects chapter headings (`第X章/回/节/卷/部/篇/集/讲` with Chinese or Arabic numerals, plus fixed words like 楔子/序章/前言/后记; whole line ≤60 chars so narrative lines are never misdetected); 节-level entries indent one step; clicking a heading jumps to it (reusing the excerpt locate path `ensureRowsUpTo` + `lineFirstVisualRow`). The detection rule has a single source `Layout.matchHeadLine`, shared with the layout engine. **Paired layout rule**: a heading line's trailing newline is preserved as a boundary and heading sentences always form their own paragraph — otherwise the punctuation-less heading gets glued into the body paragraph by newline-cleaning, breaking both the TOC and readability. Line-set changes (file open / layout toggle / chunk fill completion) trigger a debounced 300ms rebuild. Works in both layout on/off views. New regression [`bench/toc.js`](bench/toc.js) **9/9**; panel-solo criteria upgraded to four panels (all panel heights = sidebar inner height − 12×(count−1)), 22/22; head-title 11/11, PLAN-D 28/28, blank-line 17/17 zero regressions |
| v1.19 | `v1.19-landscape-compact` | 2026-10-10 | Landscape compact mode (closes the last PLAN-C §7.1 leftover): on short viewports (`max-height: 480px`, covering landscape phones with viewport heights 375 / 390 / 414 / 430) every vertical gap is squeezed — `.app` padding 16→8px and row gap 14→8px; the **top bar switches from wrapping (its content measured 184px tall, previously clipped to 94px by the 25vh cap and scrolled internally) to a single row with horizontal scrolling**, so no control is lost and all stay reachable by touch; status-bar font and padding are tightened (46→34px). Measured at 812×375: **reader 53 → 111 px (+109%, 30% of viewport height)**, all 7 key controls still ≥44×44, no document-level horizontal overflow, and the last control fully visible after scrolling the bar to its end (33/33 assertions pass). The rule is keyed to height only: portrait 375×812, tablet 768×1024 and desktop 1400×900 are unaffected (measured padding / gap / `flex-wrap` / status-bar display identical to v1.18; desktop baseline 215.7 ms vs 214 ms after reverting — that difference comes from machine load, not this change). One false positive fixed in the harness: `mobile.js` previously judged overflow per element only (element `right` beyond viewport width), which flagged content **inside** a horizontal scroller as overflow; it now checks the document level first (`documentElement.scrollWidth > clientWidth`) and only then hunts the culprit, and it also reports top-bar scroll state |
| v1.18 | `v1.18-chunked-layout` | 2026-10-03 | Chunked scheduling (PLAN-C item 3, closing out PLAN-C): the whole-document layout performed on file open is now **two-layer chunked** — (1) **visual-row chunking** (line wrapping built in batches) and (2) **layout (sentence-splitting) chunking** (incremental sentence splitting + per-sentence grouping, cut only at safe line boundaries). Only the first chunk runs synchronously on open (60k chars ≈ 2ms); the rest is drained on `requestIdleCallback` with a 6ms-per-chunk budget, while total height and total line count are estimated by prefix-ratio extrapolation before completion (0.088% line-count error). Measured at 100k lines: first paint 949.9 → **138.4 ms** (−85.4%, meeting the <300 ms target), layout toggle 607/854 → 15/10 ms, font 24→28 466 → 54 ms, "no wrap" 1245 → 11 ms, heap 31.8 → 28.2 MB; at 500k lines first paint 4354.5 → **340.3 ms** and heap 155.6 → 137.6 MB. **Byte-for-byte identical rendering**: the first screen (captured while still unchunked) and 10 visual-row positions produce the same fingerprints as v1.17, with matching total height / status-bar line count; 69 chunk-equivalence assertions pass; features needing the full document (search, read-aloud) auto-drain on demand. The headless harness gains three anti-throttling flags and `--wait-fill` |
| v1.17 | `v1.17-perf-mobile` | 2026-10-03 | Large-file performance & mobile (PLAN-C stages 2/3): (1) **Performance** (measured at 100k lines) — layout toggles, font-size and ruler changes no longer re-decode the whole file or re-run whole-document sentence splitting (decode & split results are version-keyed and reused), character-width measurement now uses a typed-array lookup table, and the speech queue is built lazily: first paint 1009 → **383 ms**, layout toggle 603–871 → **53–72 ms**, font 24→28 454 → **97 ms**, heap 31.8 → **25.5 MB**. (2) **Mobile** — sidebar becomes a drawer at ≤768px (tap the scrim to close), the wrap ruler uses Pointer Events so it can be dragged by touch (re-layout only on release), interactive targets are ≥44×44px, and horizontal overflow is gone. (3) **Fix** — the top bar / page bar could wrap out of control on narrow and landscape viewports and squeeze the reader to 0 (measured 0 → 53px at 812×375 and 97 → 249px at 375×812). (4) New zero-dependency benchmark harness [`bench/`](bench/README.md) (real CDP timing + memory-leak verification) |
| v1.16 | `v1.16-btn-order` | 2026-10-03 | Toolbar grouping: moved "⤓ Export result" ahead of "🔊 Read aloud" so the **typeset → export** chain (text processing and output) stays contiguous. Read-aloud belongs to the listening branch (it switches to reading mode and hides the top bar), so it is placed last and no longer splits that chain |
| v1.15 | `v1.15-speak-contrast-gap` | 2026-10-03 | Speech legibility & pacing: (1) Fixed "the spoken line's text is invisible on a light reading background" — the spoken line no longer hard-codes the theme text colour; it now follows its context (`--read-text` in reading mode). Marker colours are decoupled from the theme and picked by reading-background lightness (dark markers on light, light markers on dark); in reading mode the spoken row keeps its full-row tint and left bar, and the ▶ sits right before the text. (2) Shorter pauses: the next sentence is pre-queued into the engine for gapless playback, the timer gap drops 140ms → 60ms (fallback only), plus a hand-off guard so a dropped queued block can never leave playback silently stalled |
| v1.14 | `v1.14-speak-start` | 2026-10-03 | Speech start position & line marker sync: the spoken line now carries multiple markers (leading ▶ + bottom underline + left bar + tint) that move with playback; reading now starts at the **first line of the current page** instead of the last interrupted position, and clicking any line in the body sets a manual start line (click again to clear) which takes priority over the page start — re-triggering after stop re-resolves accordingly |
| v1.13 | `v1.13-speak` | 2026-10-03 | Text-to-speech (PLAN-B): read the text sentence by sentence with per-sentence highlight follow; pause/resume/stop; 0.5–2.0× rate applied in real time; Chinese voice picker; follow-scroll toggle. Long sentences are re-chunked to dodge the ~15s browser cut-off; a watchdog self-heals background throttling; the spoken position is stored per file for resume. Also fixes a PLAN-A leftover where the export button stayed disabled after opening a file |
| v1.12 | `v1.12-modal-foot` / **`v1.12-stable`** | 2026-10-01 | Simple-layout dialog: all action buttons consolidated into a persistent bottom bar (does not scroll with content); the redundant primary "Re-layout" button removed and re-layout is now on-demand — it only appears in the footer once the result has been edited manually; buttons stretch to fill evenly on narrow screens |
| v1.11 | `v1.11-editable-output` | 2026-10-01 | Editable layout result: the output box is no longer read-only — edit it directly before copying/saving; a manual edit pauses auto-layout with an inline notice, and "Re-layout" overwrites it; matching the auto output again restores auto mode |
| v1.10 | `v1.10-export-save` | 2026-10-01 | Export/save loop (PLAN-A): save layout results as TXT from both the main view and the dialog; overwrite the original file directly when FSA is available (with confirmation), otherwise fall back to download |
| v1.9 | `v1.9-punct-combos` | 2026-09-27 | Consecutive punctuation rules: runs = one sentence boundary; closing quotes/brackets after punctuation stay with the previous sentence; line breaks after `！”` are no longer dropped |
| v1.8 | `v1.8-wrap-ruler` | 2026-09-26 | Draggable wrap-boundary ruler above the main view |
| v1.7 | `v1.7-longpunct-boundary` | 2026-09-26 | Long-punctuation runs (—— / ……) integrated into the layout pipeline as forced separators |
| v1.6 | `v1.6-segment-long-punct` | 2026-09-26 | Added `segmentByLongPunct` segmentation function |
| v1.5 | `v1.5-layout-module-main` | 2026-09-26 | Layout extracted into a reusable module; main view adopts the same rules |
| v1.4 | `v1.4-layout-join-lines` | 2026-09-26 | Line breaks after non-sentence-ending punctuation removed before segmentation |
| v1.3 | `v1.3-simple-layout` | 2026-09-26 | Simple layout: sentence-per-paragraph, blank lines, short-dialogue merging |
| v1.2 | `v1.2-fontsize-default24` | 2026-09-26 | Default font size 24px; added 28/32/36px steps |
| v1.1 | `v1.1-wildcard-search` | 2026-09-26 | Wildcard fuzzy search (`*` / `?`) |
| v1.0 | `v1.0-reader-fingerprint` | 2026-07-21 | Baseline: encoding detection / pagination / search / fingerprinted progress |

## 🌐 Live Demo

| URL | Notes |
|------|------|
| [CloudStudio Preview](https://50020f68b853499b9e1c53569770686a.app.codebuddy.work) | Direct access within mainland China (recommended) |
| [GitHub Pages](https://huyeek-butu.github.io/txt-reader/) | Official address (may be blocked in mainland China) |
| [jsDelivr CDN](https://gcore.jsdelivr.net/gh/huyeek-butu/txt-reader@v1.18-chunked-layout/index.html) | CDN-accelerated mirror (pinned tag; use the `gcore` node — `cdn`/`fastly` return 301 to the raw source, unreachable in mainland China) |

## 📦 Local Usage

1. Download [`index.html`](index.html) from this repository
2. Double-click to open it in any modern browser
3. No installation, no backend, files are never uploaded — everything runs locally

## 🔧 Technical Notes

- A single HTML file with inline CSS + JS, zero external dependencies
- Uses the browser `FileReader API` to read local files; nothing is uploaded to any server
- Uses browser `localStorage` to persist reading progress and settings
- Progress keys use a content fingerprint (FNV-1a over the first 4KB + byte length) to prevent same-size key collisions; per-file save queues flush immediately on file switching
- The layout engine is encapsulated as a `Layout` module (newline cleanup → sentence segmentation → short-dialogue merging → long-punctuation forced breaks), shared by the main view and the layout dialog
- Large-file layout optimization: samples and estimates real rendered lines for ~100× faster rendering
- The wrap ruler is canvas-drawn (DPR-aware); zero re-layout while dragging, re-layout only on release — smooth even for large files
- Compatible with modern browsers (Chrome / Edge / Firefox / Safari)

## License

A personal project — feel free to use and modify it as you like.
