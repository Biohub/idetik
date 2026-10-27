import { Geometry } from "../../core/geometry";
import { loadGLB } from "./glb_loader";

export async function loadMesh(url: string): Promise<Geometry> {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (!path.endsWith(".glb")) {
    throw new Error("Unsupported mesh format. Expected a .glb URL.");
  }
  return loadGLB(url);
}
