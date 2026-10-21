import { Geometry } from "../../core/geometry";
import { BoxGeometry } from "../../objects/geometry/box_geometry";

export async function loadMesh(_url: string): Promise<Geometry> {
  return new BoxGeometry(1, 0.1, 1, 1, 1, 1);
}
