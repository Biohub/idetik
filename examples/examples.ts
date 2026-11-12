export const examples = [
  {
    id: "image_2d",
    title: "2D Image of Zebrafish Embryo",
    label: "Zebrafish Embryo 2D",
    description:
      "A 2D viewer with a dataset picker spanning Zarr v2 and v3, plus a custom URL field.",
    data: "Zebrahub · AIND exaSPIM · EBI",
    tags: ["streaming", "multiscale", "playback"],
  },
  {
    id: "volume_rendering",
    title: "3D Volume of A549 Cells",
    label: "A549 Cells Volume",
    description:
      "3D multichannel volume rendering with orbit controls and a fixed-LOD policy.",
    data: "A549 organelle box · public.czbiohub.org",
    tags: ["3d", "volume"],
  },
  {
    id: "points",
    title: "Cryo-ET Tomogram with Particle Annotations",
    label: "Cryo-ET Particles",
    description:
      "Ribosome and ferritin annotations drawn over a cryo-ET tomogram.",
    data: "CryoET Data Portal",
    tags: ["points", "custom layer"],
  },
  {
    id: "image2d_from_omezarr4d_hcs",
    title: "HCS Plate of A549 Cells",
    label: "HCS Plate",
    description: "Browse wells of a high-content screening plate.",
    data: "A549 organelle box plate · public.czbiohub.org",
    tags: ["2d", "hcs"],
  },
  {
    id: "multi_viewport",
    title: "Orthogonal Views of Zebrafish Embryo",
    label: "Orthogonal Views",
    description:
      "Orthogonal XY, XZ and YZ slices plus a 3D volume, all on one canvas.",
    data: "Zebrahub multi-view · public.czbiohub.org",
    tags: ["viewports", "slices", "volume"],
  },
  {
    id: "labels_overlay",
    title: "Segmented Nuclei in a Mouse Blastocyst",
    label: "Blastocyst Nuclei",
    description:
      "Segmentation labels over a z-stack, with one slider driving both layers.",
    data: "IDR idr0062A · EBI",
    tags: ["2d", "labels", "picking"],
  },
];
