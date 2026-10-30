#version 300 es

precision highp float;

layout (location = 0) in vec3 a_position;
layout (location = 6) in vec4 a_color;
layout (location = 7) in float a_size;
layout (location = 8) in float a_marker;

uniform mat4 u_projection;
uniform mat4 u_modelView;
uniform vec2 u_resolution;
// true when a_size is in world units, false when in screen pixels
uniform bool u_sizeInWorld;
uniform float u_sizeScale;
uniform float u_minPointSize;
uniform float u_maxPointSize;
// Depth slab around a model-space plane (n . p + d = 0): points farther than
// u_slabHalfThickness from it are dropped; with u_slabFlatten, the rest are
// drawn on the plane. A huge half thickness keeps every point.
uniform vec3 u_slabNormal;
uniform float u_slabDistance;
uniform float u_slabHalfThickness;
uniform bool u_slabFlatten;
// 0: no fade. 1: opacity falls linearly to 0 at the slab faces. 2: size and
// opacity follow the cross-section of a ball spanning the slab.
uniform int u_slabFalloff;

out vec4 v_color;
flat out uint v_marker;
out float v_fade;
// One screen pixel in marker units (the marker spans gl_PointSize pixels).
flat out float v_pixel;


void main() {
    float dist = dot(a_position, u_slabNormal) + u_slabDistance;
    vec3 position = a_position;
    if (u_slabFlatten) position -= dist * u_slabNormal;
    gl_Position = u_projection * u_modelView * vec4(position, 1.0);

    // Pixels per model unit at this depth. The model-view's second row is
    // the gradient of view-space y over model space, so its length is the
    // model-to-view scale (camera zoom and the renderable's transform, for
    // any rotation). The projection's y scale then maps view units to NDC
    // (2 units over the viewport height), and perspective divides by w. The
    // y scale is negated by the renderer's axis flip, hence abs.
    float modelToView = length(vec3(u_modelView[0][1], u_modelView[1][1], u_modelView[2][1]));
    float pixelsPerUnit = modelToView * abs(u_projection[1][1]) * u_resolution.y * 0.5 / gl_Position.w;
    float toPixels = u_sizeInWorld ? pixelsPerUnit : 1.0;
    float size = a_size * u_sizeScale * toPixels;

    // Distance from the mid-plane as a fraction of the half thickness.
    float d = abs(dist) / u_slabHalfThickness;
    float fade = 1.0;
    if (u_slabFalloff == 1) {
        fade = 1.0 - d;
    } else if (u_slabFalloff == 2) {
        fade = sqrt(max(1.0 - d * d, 0.0));
        size *= fade;
    }
    gl_PointSize = clamp(size, u_minPointSize, u_maxPointSize);

    v_pixel = 1.0 / gl_PointSize;
    v_fade = fade;
    v_color = a_color;
    v_marker = uint(a_marker);

    // Outside the slab: put the point outside the clip volume so it is
    // never rasterized.
    if (d > 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
