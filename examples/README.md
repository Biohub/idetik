# Examples

Each folder here is a standalone viewer built on `idetik`. Run them locally with `npm run examples`.

## Layout

```
examples/<id>/
├── index.html       page shell
├── main.ts          entry point, shown in full on the docs page
└── thumbnail.jpg    16:9 image for the docs gallery and sidebar (1280×720 works well)
```

Other modules (e.g. the shared `scale_bar.ts`) are fine, but only `main.ts` is shown on the docs page. Import the library as `idetik` so the code can be copied as-is.

Link the shared page styles from `index.html`. They include a theme for [lil-gui](https://lil-gui.georgealways.com/), which the examples use for controls, so every example matches the docs:

```html
<link rel="stylesheet" href="../example.css" />
```

## Adding an example

Add the folder, then an entry to [`examples.ts`](examples.ts). The list's order is the order everywhere: the `npm run examples` picker, the docs gallery, and the docs sidebar.

```ts
{
  id: "my_example",
  title: "Full title, e.g. Segmented CryoET Tomogram",
  label: "Short name",
  description: "One sentence on what the example shows.",
  data: "Where the data comes from, e.g. CryoET Data Portal 10490 · Stojanovska et al. 2025 · CC0",
  dataUrl: "https://… (optional) link to the dataset's README or license",
  tags: ["2d", "labels"],
},
```

`id` is the folder name and gives the docs page `/examples/<id>`. `title` heads the docs page and the gallery card and names the example in the `npm run examples` picker; match it to the `<title>` in `index.html`. `label` is the short name in the docs sidebar; keep it to one line (about 18 characters). `description` appears under the title on the example's page. `data` appears under the viewer and as the gallery card's subtitle; if `dataUrl` is set, the line under the viewer links to it (use it for a README or license page). `tags` are short lowercase feature names shown on the gallery card; keep to two or three and reuse existing ones where they fit.

Preview with `npm run docs:dev`.
