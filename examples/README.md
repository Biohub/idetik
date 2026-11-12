# Examples

Each folder here is a standalone viewer built on `idetik`. Run them locally with `npm run examples`.

## Layout

```
examples/<id>/
├── index.html       page shell
├── main.ts          entry point, shown in full on the docs page
└── thumbnail.jpg    16:9 image for the docs gallery and sidebar (1280×720 works well)
```

Other local modules (e.g. `image_2d/scale_bar.ts`) are fine, but only `main.ts` is shown on the docs page. Import the library as `idetik` so the code can be copied as-is.

Use [lil-gui](https://lil-gui.georgealways.com/) for controls and link the shared theme from `index.html` so every example matches the docs:

```html
<link rel="stylesheet" href="../lil_gui_theme.css" />
```

## Adding an example

Add the folder, then an entry to [`examples.ts`](examples.ts). The list's order is the order everywhere: the `npm run examples` picker, the docs gallery, and the docs sidebar.

```ts
{
  id: "my_example",
  title: "Full title, e.g. Segmented Nuclei in a Mouse Blastocyst",
  label: "Short name",
  description: "One sentence on what the example shows.",
  data: "Where the data comes from, e.g. IDR idr0062A · EBI",
  tags: ["2d", "labels"],
},
```

`id` is the folder name and gives the docs page `/examples/<id>`. `title` heads the docs page and the gallery card and names the example in the `npm run examples` picker; match it to the `<title>` in `index.html`. `label` is the short name in the docs sidebar; keep it to one line (about 18 characters). `description` appears under the title on the example's page. `data` appears under the viewer and as the gallery card's subtitle. `tags` are short lowercase feature names shown on the gallery card; keep to two or three and reuse existing ones where they fit.

Preview with `npm run docs:dev`.
