# Examples

Each folder here is a standalone viewer built on `@idetik/core`. Run them locally with `npm run examples`.

## Layout

```
examples/<id>/
├── index.html       page shell; its <title> names the example
├── main.ts          entry point, shown in full on the docs page
├── showcase.json    optional: lists the example on the docs showcase
└── thumbnail.jpg    required with showcase.json: 16:9 image for the gallery and sidebar
```

Other local modules (e.g. `image_2d/scale_bar.ts`) are fine, but only `main.ts` is shown on the docs page. Import the library as `@idetik/core` so the code can be copied as-is.

Use [lil-gui](https://lil-gui.georgealways.com/) for controls and link the shared theme from `index.html` so every example matches the docs:

```html
<link rel="stylesheet" href="../lil_gui_theme.css" />
```

## Adding to the showcase

Add `showcase.json` next to `index.html`:

```json
{
  "description": "One sentence on what the example shows.",
  "data": "Where the data comes from, e.g. IDR idr0062A · EBI"
}
```

and a `thumbnail.jpg` (1280×720 works well). The docs pick it up at `/showcase/<id>` with a gallery card and sidebar entry; no docs files need editing. The docs build fails if `showcase.json` exists without `main.ts` or `thumbnail.jpg`.

Preview with `npm run docs:dev`.
