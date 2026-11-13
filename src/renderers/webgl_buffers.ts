import { Geometry, GeometryAttributeIndex } from "../core/geometry";

type BufferHandles = {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ebo?: WebGLBuffer;
};

export class WebGLBuffers {
  private readonly gl_: WebGL2RenderingContext;
  private readonly buffers_: Map<Geometry, BufferHandles> = new Map();
  private currentGeometry_: Geometry | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl_ = gl;
  }

  public bindGeometry(geometry: Geometry) {
    if (this.alreadyActive(geometry)) return;

    if (!this.buffers_.has(geometry)) {
      this.generateBuffers(geometry);
    }

    const buffers = this.buffers_.get(geometry);
    if (!buffers) {
      throw new Error("Failed to retrieve buffer handles for object");
    }

    this.gl_.bindVertexArray(buffers.vao);
    this.currentGeometry_ = geometry;
  }

  public reset() {
    this.currentGeometry_ = null;
  }

  public disposeObject(geometry: Geometry) {
    const buffers = this.buffers_.get(geometry);
    if (!buffers) return;

    this.gl_.deleteVertexArray(buffers.vao);
    this.gl_.deleteBuffer(buffers.vbo);

    if (buffers.ebo) this.gl_.deleteBuffer(buffers.ebo);

    this.buffers_.delete(geometry);
    if (this.currentGeometry_ === geometry) {
      this.currentGeometry_ = null;
    }
  }

  public disposeAll() {
    for (const geometry of this.buffers_.keys()) {
      this.disposeObject(geometry);
    }
  }

  private alreadyActive(geometry: Geometry) {
    return this.currentGeometry_ === geometry;
  }

  private generateBuffers(geometry: Geometry) {
    const vao = this.gl_.createVertexArray();
    if (!vao) {
      throw new Error("Failed to create vertex array object (VAO)");
    }

    this.gl_.bindVertexArray(vao);

    const { vertexData } = geometry;
    const vboType = this.gl_.ARRAY_BUFFER;
    const vbo = this.gl_.createBuffer();
    if (!vbo) throw new Error("Failed to create vertex buffer (VBO)");

    this.gl_.bindBuffer(vboType, vbo);
    this.gl_.bufferData(vboType, vertexData, this.gl_.STATIC_DRAW);

    const { attributes, strideBytes } = geometry;
    attributes.forEach((attr) => {
      const idx = GeometryAttributeIndex[attr.type];
      this.gl_.vertexAttribPointer(
        idx,
        attr.itemSize,
        this.gl_.FLOAT,
        false,
        strideBytes,
        attr.offset
      );
      this.gl_.enableVertexAttribArray(idx);
    });

    const buffers: BufferHandles = { vao, vbo };

    const { indexData } = geometry;
    if (indexData.length) {
      const eboType = this.gl_.ELEMENT_ARRAY_BUFFER;
      const ebo = this.gl_.createBuffer();
      if (!ebo) throw new Error("Failed to create index buffer (EBO)");

      this.gl_.bindBuffer(eboType, ebo);
      this.gl_.bufferData(eboType, indexData, this.gl_.STATIC_DRAW);
      buffers.ebo = ebo;
    }

    this.buffers_.set(geometry, buffers);
    this.gl_.bindVertexArray(null);
  }
}
