#version 300 es

precision mediump float;

layout (location = 0) in vec3 a_position;
layout (location = 6) in vec4 a_color;
layout (location = 7) in float a_size;
layout (location = 8) in float a_marker;

uniform mat4 u_projection;
uniform mat4 u_modelView;
uniform vec2 u_resolution;
// 1.0 when a_size is in world units, 0.0 when in screen pixels
uniform float u_sizeInWorld;
uniform float u_sizeScale;
uniform float u_minPointSize;
uniform float u_maxPointSize;
// Depth slab, in model-space z: points farther than u_slabHalfThickness from
// u_slabCenter are dropped; with u_slabFlatten, the rest are drawn at
// z = u_slabCenter. A huge half thickness keeps every point.
uniform float u_slabCenter;
uniform float u_slabHalfThickness;
uniform float u_slabFlatten;

out vec4 v_color;
flat out uint v_marker;


void main() {
    if (abs(a_position.z - u_slabCenter) > u_slabHalfThickness) {
        // Outside the slab: put the point outside the clip volume so it is
        // never rasterized.
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        v_color = vec4(0.0);
        v_marker = 0u;
        return;
    }

    vec3 position = a_position;
    if (u_slabFlatten > 0.5) position.z = u_slabCenter;
    gl_Position = u_projection * u_modelView * vec4(position, 1.0);
    float size = a_size * u_sizeScale;
    if (u_sizeInWorld > 0.5) {
        // Pixels per world unit at this depth: the projection's y scale maps
        // view-space units to NDC (which spans 2 units over the viewport
        // height), and perspective divides by w. The y scale is negated by
        // the renderer's axis flip, hence abs.
        size *= abs(u_projection[1][1]) * u_resolution.y * 0.5 / gl_Position.w;
    }
    gl_PointSize = clamp(size, u_minPointSize, u_maxPointSize);
    v_color = a_color;
    v_marker = uint(a_marker);
}
