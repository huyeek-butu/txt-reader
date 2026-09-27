<div align="right">

**English** | [简体中文](README.md)

</div>

# TXT Reader

A **browser-based, single-file** TXT reading tool, purpose-built for long-form Chinese content such as novels, logs, and scripts. It auto-detects GBK / Big5 / UTF-8 encodings, paginates by real rendered lines, and offers wildcard search, sentence-based layout, a draggable wrap-boundary ruler, distraction-free reading, eye-care themes, and keyboard shortcuts — bringing you back to immersive reading.

> **v1.9** · Pure front-end · Zero dependencies · Works out of the box

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

> **Tip**: When the encoding/font-size dropdowns are focused, PageUp / PageDown won't trigger page-turns, preventing accidental navigation.

## 🔄 Version History

| Version | Tag | Notes |
|------|------|------|
| v1.9 | `v1.9-punct-combos` | Consecutive punctuation rules: runs = one sentence boundary; closing quotes/brackets after punctuation stay with the previous sentence; line breaks after `！”` are no longer dropped |
| v1.8 | `v1.8-wrap-ruler` | Draggable wrap-boundary ruler above the main view |
| v1.7 | `v1.7-longpunct-boundary` | Long-punctuation runs (—— / ……) integrated into the layout pipeline as forced separators |
| v1.6 | `v1.6-segment-long-punct` | Added `segmentByLongPunct` segmentation function |
| v1.5 | `v1.5-layout-module-main` | Layout extracted into a reusable module; main view adopts the same rules |
| v1.4 | `v1.4-layout-join-lines` | Line breaks after non-sentence-ending punctuation removed before segmentation |
| v1.3 | `v1.3-simple-layout` | Simple layout: sentence-per-paragraph, blank lines, short-dialogue merging |
| v1.2 | `v1.2-fontsize-default24` | Default font size 24px; added 28/32/36px steps |
| v1.1 | `v1.1-wildcard-search` | Wildcard fuzzy search (`*` / `?`) |
| v1.0 | `v1.0-reader-fingerprint` | Baseline: encoding detection / pagination / search / fingerprinted progress |

## 🌐 Live Demo

| URL | Notes |
|------|------|
| [CloudStudio Preview](https://50020f68b853499b9e1c53569770686a.app.codebuddy.work) | Direct access within mainland China (recommended) |
| [GitHub Pages](https://huyeek-butu.github.io/txt-reader/) | Official address (may be blocked in mainland China) |
| [jsDelivr CDN](https://cdn.jsdelivr.net/gh/huyeek-butu/txt-reader@main/index.html) | CDN-accelerated mirror |

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
