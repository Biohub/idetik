import depthFragmentShader from "./depth_frag.glsl";
import depthVertexShader from "./depth_vert.glsl";
import imageVertexShader from "./image_vert.glsl";
import labelImage from "./label_image_frag.glsl";
import meshFragmentShader from "./mesh_frag.glsl";
import meshVertexShader from "./mesh_vert.glsl";
import pointsDepthFragmentShader from "./points_depth_frag.glsl";
import pointsFragmentShader from "./points_frag.glsl";
import pointsVertexShader from "./points_vert.glsl";
import projectedLineFragmentShader from "./projected_line_frag.glsl";
import projectedLineVertexShader from "./projected_line_vert.glsl";
import scalarImageFragmentShader from "./scalar_image_frag.glsl";
import volumeFragmentShader from "./volume_frag.glsl";
import volumeVertexShader from "./volume_vert.glsl";
import wireframeFragmentShader from "./wireframe_frag.glsl";
import wireframeVertexShader from "./wireframe_vert.glsl";

export type Shader =
  | "floatScalarImage"
  | "floatVolume"
  | "intLabelImage"
  | "intScalarImage"
  | "intVolume"
  | "labelImage"
  | "mesh"
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
    vertex: imageVertexShader,
    fragment: scalarImageFragmentShader,
  },
  intScalarImage: {
    vertex: imageVertexShader,
    fragment: scalarImageFragmentShader,
    fragmentDefines: new Map([["TEXTURE_DATA_TYPE_INT", "1"]]),
  },
  uintScalarImage: {
    vertex: imageVertexShader,
    fragment: scalarImageFragmentShader,
    fragmentDefines: new Map([["TEXTURE_DATA_TYPE_UINT", "1"]]),
  },
  labelImage: {
    vertex: imageVertexShader,
    fragment: labelImage,
  },
  mesh: {
    vertex: meshVertexShader,
    fragment: meshFragmentShader,
  },
  intLabelImage: {
    vertex: imageVertexShader,
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
    vertex: depthVertexShader,
    fragment: depthFragmentShader,
  },
  pointsDepth: {
    vertex: pointsVertexShader,
    fragment: pointsDepthFragmentShader,
  },
  projectedLineDepth: {
    vertex: projectedLineVertexShader,
    fragment: depthFragmentShader,
  },
};
