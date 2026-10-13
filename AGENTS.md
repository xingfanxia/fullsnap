# fullsnap — agent guide

## Project scale and verification

**Profile: personal browser extension, public MIT repository.** A Chrome MV3 extension that captures a whole page
by scrolling and stitching. Structure and behaviour are described in `README.md`.

- The requested behaviour defines completion. Keep the split: `core` pure, `page` only moves the page and reports
  geometry, `background` takes the screenshots, `result` stitches and exports.
- Check a change with what covers it: `npm run typecheck`, `npm test`, and `npm run e2e` whenever scrolling,
  pinned-element handling, stitching or the result page change. Add a page under `tests/pages` for a new layout
  case and assert on pixels.
- User-facing strings live in `static/_locales/{en,zh_CN}/messages.json`; add both when adding one.
- Deliberate boundaries: no site-specific special cases, no remote calls, no accounts, and only `activeTab`
  access. Anything the page script changes must be undone in `end()`.
- Nothing copied from another extension's source may enter this repository.
