export const examples = [
  {
    id: "zebrafish_tem",
    title: "Virtual TEM Slide of a Zebrafish Embryo",
    label: "Zebrafish TEM",
    description:
      "A 350-gigapixel electron microscopy section streamed from a sharded Zarr v3 pyramid.",
    data: "IDR idr0053 · Faas et al. 2012 · CC BY-NC-SA 3.0",
    dataUrl: "https://data.idetik.org/examples/idr0053-zebrafish-tem/README.md",
    tags: ["2d", "streaming", "multiscale"],
  },
  {
    id: "zebrafish_volume",
    title: "3D Volume of a Zebrafish Embryo",
    label: "Zebrafish Volume",
    description:
      "Two-channel volume rendering of a light-sheet timelapse with orbit controls and a fixed-LOD policy.",
    data: "Zebrahub multi-view ZMNS001 · public.czbiohub.org",
    tags: ["3d", "volume"],
  },
  {
    id: "cryoet_segmentation",
    title: "Segmented CryoET Tomogram",
    label: "CryoET Segmentation",
    description:
      "Membrane, microtubule and actin segmentations of a simulated tomogram: meshes inside a volume rendering next to labels over an XY slice.",
    data: "CryoET Data Portal 10490 · Stojanovska et al. 2025 · CC0",
    dataUrl: "https://cryoetdataportal.czscience.com/runs/35127",
    tags: ["2d", "3d", "labels", "mesh", "volume"],
  },
  {
    id: "multi_viewport",
    title: "Orthogonal Views of a Mouse Brain",
    label: "Orthogonal Views",
    description:
      "Orthogonal XY, XZ and YZ slices plus a 3D volume of a whole exaSPIM mouse brain, all on one canvas.",
    data: "AIND exaSPIM 822177 · Allen Institute for Neural Dynamics · CC BY 4.0",
    dataUrl: "https://registry.opendata.aws/allen-nd-open-data",
    tags: ["viewports", "slices", "volume"],
  },
  {
    id: "cell_tracking",
    title: "Cell Tracks in a Zebrafish Tail",
    label: "Zebrafish Tracks",
    description:
      "Click a nucleus in a light-sheet timelapse to follow its track and lineage through time.",
    data: "Zebrahub ZSNS001 tail · Royer lab, CZ Biohub",
    dataUrl: "https://data.idetik.org/examples/zebrahub-tail-tracks/README.md",
    tags: ["2d", "points", "picking", "playback"],
  },
  {
    id: "image2d_from_omezarr4d_hcs",
    title: "HCS Plate of A549 Cells",
    label: "HCS Plate",
    description:
      "A 60-well plate as a grid of viewports, drilling into a well's fields and then a single field.",
    data: "A549 OrganelleBox plate · organellebox.org",
    dataUrl: "https://organellebox.org",
    tags: ["2d", "hcs", "viewports"],
  },
  {
    id: "pathology_slide",
    title: "Whole-Slide Pathology Image",
    label: "Pathology Slide",
    description:
      "A 1.5-gigapixel H&E slide stored as red, green and blue channels, blended back into true color as you zoom.",
    data: "OpenSlide test data CMU-1 · Carnegie Mellon University · CC0",
    dataUrl: "https://openslide.cs.cmu.edu/download/openslide-testdata/",
    tags: ["2d", "channels", "multiscale"],
  },
  {
    id: "zebrafish_timelapse",
    title: "2D Timelapse of a Zebrafish Embryo",
    label: "Zebrafish Timelapse",
    description:
      "A 2D slice through a 5D light-sheet timelapse, with z and t sliders and time playback.",
    data: "Zebrahub ZSNS001 · public.czbiohub.org",
    tags: ["2d", "streaming", "slices", "playback"],
  },
  {
    id: "hela_mitosis",
    title: "HeLa Cell Division with Segmentations",
    label: "HeLa Mitosis",
    description:
      "Three-channel confocal stacks of a dividing cell over an hour, with cell and chromosome labels following the z and t sliders.",
    data: "IDR idr0052 · Walther et al. 2018 · CC BY 4.0",
    dataUrl: "https://idr.openmicroscopy.org/study/idr0052/",
    tags: ["2d", "labels", "playback", "channels"],
  },
  {
    id: "points",
    title: "Spatial Transcriptomics of a Mouse Liver",
    label: "Liver Transcripts",
    description:
      "Single-molecule transcripts of four marker genes over DAPI-stained nuclei and their segmentation, showing the zones of the liver lobule.",
    data: "Molecular Cartography · Guilliams et al. 2022, Pollaris et al. 2024 · CC BY 4.0",
    dataUrl:
      "https://spatialdata.scverse.org/en/latest/tutorials/notebooks/datasets/README.html",
    tags: ["points", "labels", "custom layer"],
  },
];
