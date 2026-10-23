import { load } from "@loaders.gl/core";
import {
  GLTFLoader,
  postProcessGLTF,
  type GLTFAccessorPostprocessed,
  type GLTFMeshPrimitivePostprocessed,
  type GLTFNodePostprocessed,
} from "@loaders.gl/gltf";
import { mat3, mat4, vec3, type quat } from "gl-matrix";
import { Geometry } from "../../core/geometry";

type MeshData = {
  vertices: Float32Array;
  indices: Uint32Array;
};

export async function loadGLB(url: string): Promise<Geometry> {
  const data = await load(url, GLTFLoader, {
    gltf: {
      normalize: false,
      loadImages: false,
      decompressMeshes: false,
    },
  });

  if (data.json.asset.version !== "2.0") {
    throw new Error("Mesh loading requires glTF 2.0.");
  }

  if (data.json.extensionsRequired?.length) {
    const ext = data.json.extensionsRequired.join(", ");
    throw new Error(`Unsupported required glTF extensions: ${ext}.`);
  }

  const gltf = postProcessGLTF(data);
  const scene = gltf.scene ?? gltf.scenes?.[0];
  const nodes = gltf.nodes ?? [];
  const children = new Set(nodes.flatMap((node) => node.children ?? []));
  const roots = scene?.nodes ?? nodes.filter((node) => !children.has(node));
  const parts: MeshData[] = [];
  const ancestors = new Set<GLTFNodePostprocessed>();

  for (const node of roots) {
    visit(node, mat4.create(), parts, ancestors);
  }

  if (!parts.length) {
    throw new Error("The GLB scene contains no triangle meshes.");
  }

  const vertices = new Float32Array(
    parts.reduce((length, part) => length + part.vertices.length, 0)
  );

  const indices = new Uint32Array(
    parts.reduce((length, part) => length + part.indices.length, 0)
  );

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const part of parts) {
    vertices.set(part.vertices, vertexOffset);
    for (let i = 0; i < part.indices.length; i++) {
      indices[indexOffset + i] = part.indices[i] + vertexOffset / 6;
    }
    vertexOffset += part.vertices.length;
    indexOffset += part.indices.length;
  }

  const geometry = new Geometry(vertices, indices);
  geometry.addAttribute({ type: "position", itemSize: 3, offset: 0 });
  geometry.addAttribute({ type: "normal", itemSize: 3, offset: 12 });

  return geometry;
}

function visit(
  node: GLTFNodePostprocessed,
  parent: mat4,
  parts: MeshData[],
  ancestors: Set<GLTFNodePostprocessed>
): void {
  if (ancestors.has(node)) {
    throw new Error("Cyclic glTF node hierarchy.");
  }

  if (node.extensions?.EXT_mesh_gpu_instancing) {
    throw new Error("Instanced meshes are not supported.");
  }

  ancestors.add(node);

  const world = mat4.create();
  if (node.matrix) {
    mat4.copy(world, node.matrix as mat4);
  } else {
    mat4.fromRotationTranslationScale(
      world,
      (node.rotation ?? [0, 0, 0, 1]) as quat,
      (node.translation ?? [0, 0, 0]) as vec3,
      (node.scale ?? [1, 1, 1]) as vec3
    );
  }

  mat4.multiply(world, parent, world);

  for (const primitive of node.mesh?.primitives ?? []) {
    parts.push(readPrimitive(primitive, world));
  }

  for (const child of node.children ?? []) {
    visit(child, world, parts, ancestors);
  }

  ancestors.delete(node);
}

function readPrimitive(
  primitive: GLTFMeshPrimitivePostprocessed,
  world: mat4
): MeshData {
  if ((primitive.mode ?? 4) !== 4) {
    throw new Error("Only triangle mesh primitives are supported.");
  }

  if (primitive.extensions?.KHR_draco_mesh_compression) {
    throw new Error("Compressed mesh geometry is not supported.");
  }

  const position = primitive.attributes.POSITION;
  const normal = primitive.attributes.NORMAL;
  const index = primitive.indices;
  const positions = readVectorAttribute(position, "POSITION");
  const normals = normal ? readVectorAttribute(normal, "NORMAL") : undefined;

  if (normal && normal.count !== position.count) {
    throw new Error("Mesh POSITION and NORMAL counts must match.");
  }

  if (
    index &&
    (index.type !== "SCALAR" ||
      ![5121, 5123, 5125].includes(index.componentType) ||
      index.normalized ||
      index.value.length < index.count)
  ) {
    throw new Error("Invalid mesh index accessor.");
  }

  const indexCount = index?.count ?? position.count;
  if (!indexCount || indexCount % 3 !== 0) {
    throw new Error(
      "Triangle mesh index count must be a positive multiple of three."
    );
  }

  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indexCount; i++) {
    const value = index ? Number(index.value[i]) : i;
    if (!Number.isInteger(value) || value < 0 || value >= position.count) {
      throw new Error("Mesh index is outside the POSITION accessor.");
    }
    indices[i] = value;
  }

  // keep front faces consistent with transformed normals.
  if (mat4.determinant(world) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
    }
  }

  const normalMatrix = mat3.create();
  if (normals && !mat3.normalFromMat4(normalMatrix, world)) {
    throw new Error(
      "Cannot transform mesh normals with a singular node transform."
    );
  }

  const vertexCount = normals ? position.count : indices.length;
  const vertices = new Float32Array(vertexCount * 6);
  const point = vec3.create();
  for (let i = 0; i < vertexCount; i++) {
    // if normals are missing glTF specifies flat shading. each face needs its own vertices.
    const sourceOffset = (normals ? i : indices[i]) * 3;

    vec3.set(
      point,
      positions[sourceOffset],
      positions[sourceOffset + 1],
      positions[sourceOffset + 2]
    );

    vec3.transformMat4(point, point, world);
    vertices.set(point, i * 6);

    if (normals) {
      vec3.set(
        point,
        normals[sourceOffset],
        normals[sourceOffset + 1],
        normals[sourceOffset + 2]
      );

      vec3.transformMat3(point, point, normalMatrix);
      vec3.normalize(point, point);
      vertices.set(point, i * 6 + 3);
    }
  }

  if (!normals) {
    const edgeA = vec3.create();
    const edgeB = vec3.create();
    for (let i = 0; i < vertexCount; i += 3) {
      const offset = i * 6;
      for (let axis = 0; axis < 3; axis++) {
        edgeA[axis] = vertices[offset + 6 + axis] - vertices[offset + axis];
        edgeB[axis] = vertices[offset + 12 + axis] - vertices[offset + axis];
      }
      vec3.cross(point, edgeA, edgeB);
      vec3.normalize(point, point);
      for (let corner = 0; corner < 3; corner++) {
        vertices.set(point, offset + corner * 6 + 3);
        indices[i + corner] = i + corner;
      }
    }
  }

  return { vertices, indices };
}

function readVectorAttribute(
  accessor: GLTFAccessorPostprocessed | undefined,
  name: string
): Float32Array {
  if (
    !accessor ||
    accessor.type !== "VEC3" ||
    accessor.componentType !== 5126 ||
    accessor.normalized ||
    !(accessor.value instanceof Float32Array) ||
    accessor.value.length < accessor.count * 3 ||
    !accessor.value.every(Number.isFinite)
  ) {
    throw new Error(`Mesh ${name} must be a finite float VEC3 accessor.`);
  }
  return accessor.value;
}
