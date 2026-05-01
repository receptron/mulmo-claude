# presentHtml — Authoring Guide

Reference for the `presentHtml` plugin. The HTML you provide is saved to `artifacts/html/<YYYY>/<MM>/<slug>-<timestamp>.html` and rendered in the canvas. The user may also open the file directly from disk via `file://`, so it must remain portable: every URL inside the document has to resolve both when served by the app and when loaded straight off the filesystem.

## Self-Contained Document

- Full document including `<!DOCTYPE html>` and `<html>` / `<body>` tags.
- All CSS and JavaScript inline, or loaded via a public CDN. No local script / stylesheet files (the app does not host arbitrary `.css` / `.js`).

## Referencing Workspace Files

The output HTML lives three directory levels deep under `artifacts/`. To reference an image / chart / other artifact, use a **relative path with exactly three `../`** to climb out of `html/<YYYY>/<MM>/`:

```html
<!-- GOOD -->
<img src="../../../images/2026/04/foo.png">

<!-- BAD: absolute path breaks under file:// -->
<img src="/artifacts/images/2026/04/foo.png">

<!-- BAD: workspace-rooted path resolves against the page URL -->
<img src="artifacts/images/2026/04/foo.png">

<!-- BAD: runtime artifact, not a stored convention -->
<img src="/api/files/raw?path=artifacts/images/2026/04/foo.png">
```

Workspace paths returned by other tools (e.g. an image-generating tool returns `artifacts/images/2026/04/foo.png`): replace the leading `artifacts/` with `../../../`, giving `../../../images/2026/04/foo.png`.

The same rule applies to anywhere a path appears: `<img>`, `<source>`, `<video poster>`, `<audio src>`, CSS `url(...)`, etc.

## Local Images Not Already Under `artifacts/`

If you want to embed a local image that lives **outside** `artifacts/` — e.g. a file the user pasted into `data/attachments/2026/04/foo.png`, a wiki source under `data/wiki/sources/foo.png`, or any other workspace path — **do not link to it directly**. The three-`../` math only resolves cleanly for files under `artifacts/`; references that climb further or sideways break under `file://` and are fragile across workspace reorganisation.

Copy the file into `artifacts/images/<YYYY>/<MM>/` first, then reference the copy. Use `mkdir -p` for the partition directory and a UTC year/month matching the convention (`saveImage()` shards by UTC, so doing the same keeps copies grouped with same-month generated images):

```bash
mkdir -p artifacts/images/2026/04
cp data/attachments/2026/04/foo.png artifacts/images/2026/04/foo.png
```

Then in the HTML:

```html
<img src="../../../images/2026/04/foo.png">
```

Files **already** under `artifacts/` (e.g. `artifacts/images/2026/03/bar.png`, `artifacts/charts/2026/04/baz.svg`) — reference them in place; do **not** copy.

## Why Three `../`

The file is saved at `artifacts/html/<YYYY>/<MM>/<slug>-<timestamp>.html`. From that location, `../../../` climbs out of `<MM>/`, `<YYYY>/`, and `html/` to land in `artifacts/`. From `artifacts/`, the next path segment is the sibling artifact directory you want — `images/`, `charts/`, `documents/`, etc.

Absolute paths like `/artifacts/...` work in-app (the server mounts `/artifacts/images` as a static route) but break under `file://`, where root-relative URLs resolve against the filesystem root. Workspace-rooted paths without a leading slash (`artifacts/...`) get joined to the page URL by the browser and 404 every time.
