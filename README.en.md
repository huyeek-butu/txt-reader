<div align="right">

**English** | [简体中文](README.md)

</div>

# TXT Reader

A **browser-based, single-file** TXT reading tool, purpose-built for long-form Chinese content such as novels, logs, and scripts. It auto-detects GBK / Big5 / UTF-8 encodings, paginates by real rendered lines, and offers keyword search, distraction-free reading, eye-care themes, and keyboard shortcuts — bringing you back to immersive reading.

> **v1.0** · Pure front-end · Zero dependencies · Works out of the box

---

## 📌 Overview

A browser-based TXT reading tool designed for long-form Chinese content such as novels, logs, and scripts. It supports automatic GBK / Big5 / UTF-8 encoding detection, paginates by actual rendered lines, and provides keyword search, a distraction-free reading mode, eye-care themes, and keyboard shortcuts for a fully immersive experience.

## ✨ Features

- **Automatic encoding detection**: Smartly detects GBK / Big5 / UTF-8, with manual override available.
- **Real-line pagination**: Calculates page numbers based on actual wrapped visual lines for precise paging.
- **Keyword search & locate**: Cyclic jumping, inline highlighting in the body text, and an "X/N match" counter.
- **Distraction-free mode**: One-click hide the UI; customize font size, font family, width, and background color.
- **Eye-care themes**: Warm paper-like light mode / non-pure-black soft-contrast dark mode, toggle with one click.
- **Auto page-turn**: Configurable 15–90 seconds per page, start/stop with the spacebar.

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
2. Switch files in the left "File List"; type a keyword in "Search & Locate" and press Enter (or the search button) to jump
3. Adjust encoding, line-wrapping, font size, and theme in the top bar; click "📖 Distraction-Free Reading" for immersive mode
4. In distraction-free mode, adjust font size, font family, page width, and background color; press R or Esc to exit
5. Reading progress is **saved automatically**; click "**↺ Restore Progress**" on the page bar to return to where you left off

> **Tip**: When the encoding/font-size dropdowns are focused, PageUp / PageDown won't trigger page-turns, preventing accidental navigation.

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
- Large-file layout optimization: samples and estimates real rendered lines for ~100× faster rendering
- Compatible with modern browsers (Chrome / Edge / Firefox / Safari)

## License

A personal project — feel free to use and modify it as you like.
