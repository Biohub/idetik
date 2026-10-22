import projectedLineVertexShader from "./projected_line_vert.glsl";
import projectedLineFragmentShader from "./projected_line_frag.glsl";
import meshVertexShader from "./mesh_vert.glsl";
import scalarImageFragmentShader from "./scalar_image_frag.glsl";
import pointsVertexShader from "./points_vert.glsl";
import pointsFragmentShader from "./points_frag.glsl";
import wireframeVertexShader from "./wireframe_vert.glsl";
import wireframeFragmentShader from "./wireframe_frag.glsl";
import volumeVertexShader from "./volume_vert.glsl";
import volumeFragmentShader from "./volume_frag.glsl";
import labelImage from "./label_image_frag.glsl";
import depthFragmentShader from "./depth_frag.glsl";
import pointsDepthFragmentShader from "./points_depth_frag.glsl";
import gaussianSplatVertexShader from "./gaussian_splat_vert.glsl";
import gaussianSplatFragmentShader from "./gaussian_splat_frag.glsl";

export type Shader =
  | "floatScalarImage"
  | "floatVolume"
  | "gaussianSplat"
  | "intLabelImage"
  | "intScalarImage"
  | "intVolume"
  | "labelImage"
  | "points"
  | "projectedLine"
  | "uintScalarImage"
  | "uintVolume"
  | "wireframe"
  | "meshDepth"
  | "pointsDepth"
  | "projectedLineDepth";

type ShaderCode = {
  vertex: string;
  vertexDefines?: ReadonlyMap<string, string>;
  fragment: string;
  fragmentDefines?: ReadonlyMap<string, string>;
};

export const shaderCode: Record<Shader, ShaderCode> = {
  projectedLine: {
    vertex: projectedLineVertexShader,
    fragment: projectedLineFragmentShader,
  },
  points: {
    vertex: pointsVertexShader,
    fragment: pointsFragmentShader,
  },
  wireframe: {
    vertex: wireframeVertexShader,
    fragment: wireframeFragmentShader,
  },
  floatScalarImage: {
    vertex: meshVertexShader,
    fragment: scalarImageFragmentShader,
  },
  intScalarImage: {
    vertex: meshVertexShader,
    fragment: scalarImageFragmentShader,
    fragmentDefines: new Map([["TEXTURE_DATA_TYPE_INT", "1"]]),
  },
  uintScalarImage: {
    vertex: meshVertexShader,
    fragment: scalarImageFragmentShader,
    fragmentDefines: new Map([["TEXTURE_DATA_TYPE_UINT", "1"]]),
  },
  labelImage: {
    vertex: meshVertexShader,
    fragment: labelImage,
  },
  intLabelImage: {
    vertex: meshVertexShader,
    fragment: labelImage,
    fragmentDefines: new Map([["TEXTURE_DATA_TYPE_INT", "1"]]),
  },
  floatVolume: {
    vertex: volumeVertexShader,
    fragment: volumeFragmentShader,
  },
  intVolume: {
    vertex: volumeVertexShader,
    fragment: volumeFragmentShader,
    fragmentDefines: new Map([["TEXTURE_DATA_TYPE_INT", "1"]]),
  },
  uintVolume: {
    vertex: volumeVertexShader,
    fragment: volumeFragmentShader,
    fragmentDefines: new Map([["TEXTURE_DATA_TYPE_UINT", "1"]]),
  },
  meshDepth: {
    vertex: meshVertexShader,
    fragment: depthFragmentShader,
  },
  pointsDepth: {
    vertex: pointsVertexShader,
    fragment: pointsDepthFragmentShader,
  },
  gaussianSplat: {
    vertex: gaussianSplatVertexShader,
    fragment: gaussianSplatFragmentShader,
  },
  projectedLineDepth: {
    vertex: projectedLineVertexShader,
    fragment: depthFragmentShader,
  },
};
