# fullsnap

A small Chrome extension that captures a whole web page, top to bottom, as one image. Click the toolbar button
(or press `Alt+Shift+S`), wait while the page scrolls itself, and the result opens in a new tab where it can be
saved as PNG, JPG or PDF, or copied.

It has no accounts, no telemetry and talks to no server. It asks for access to a page only when you click the
button on it.

## Install

```sh
npm install
npm run build
```

Then open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select the `dist` folder.

## What it handles

- Pages taller than the window, at the display's real resolution (a 2x screen gives a 2x image).
- Fixed headers and stuck sticky bars, which appear once instead of in every screenful.
- App-style pages where the document stays put and one inner pane scrolls: the pane is unrolled, and whatever
  surrounds it is kept from the first screen.
- Content that loads as it scrolls into view: the page is scrolled through once before it is measured.
- Pages too tall for a single image, which are split into several.

## What it does not do

- Pages wider than the window are captured at the window's width.
- Content inside iframes is captured as it appears, not scrolled.
- Browser pages (`chrome://`), the extension store and the built-in PDF viewer cannot be captured by any extension.
- There is no editor or annotation.

The page is put back as it was afterwards: scroll position, hidden elements and scrollbars.

## How it works

| Part | Role |
|---|---|
| `src/page` | Injected into the page on click. Finds what scrolls, scrolls it step by step, hides pinned elements after the first step and reports geometry. |
| `src/background` | Service worker. Drives the steps, takes a screenshot of the visible tab at each one (at most two per second, which is Chrome's limit) and stores the pieces. |
| `src/result` | The result tab. Stitches the pieces on a canvas and exports them. |
| `src/core` | Pure functions: where each step scrolls to, where each piece lands, how an oversized image is sliced. |

Pieces are placed using the scroll position the page actually reached, and the image scale is taken from the
screenshot itself, so zoom level and display density need no special handling.

## Development

```sh
npm run typecheck
npm test       # unit tests for the planning maths
npm run e2e    # captures the pages in tests/pages in Chromium and checks pixels of the result
```

The end-to-end run grants its copy of the extension access to all sites, because the toolbar click that normally
grants access cannot be automated.

## Licence

[MIT](LICENSE). The built extension bundles [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT).

fullsnap was written from scratch. It shares no code with any other screenshot extension.
