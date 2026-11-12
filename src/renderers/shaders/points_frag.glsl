#version 300 es

precision mediump float;

layout (location = 0) out vec4 fragColor;

uniform mediump sampler2DArray u_markerAtlas;

in vec4 v_color;
flat in uint v_marker;
in float v_fade;
flat in float v_pixel;

uniform float u_opacity;

// The marker occupies the middle MARKER_FRACTION of its atlas sprite (see
// points_renderable.ts); the point sprite covers just the marker.
const float MARKER_FRACTION = 0.5;


void main() {
    // The atlas holds the signed distance to the marker's edge in marker
    // units (negative inside); v_pixel is one screen pixel in those units,
    // so the edge is antialiased over one pixel at any marker size.
    vec2 uv = 0.5 + (gl_PointCoord - 0.5) * MARKER_FRACTION;
    float dist = texture(u_markerAtlas, vec3(uv, v_marker)).r;
    float coverage = 1.0 - smoothstep(-0.5 * v_pixel, 0.5 * v_pixel, dist);
    if (coverage < 1e-2) {
        discard;
    }
    fragColor = vec4(v_color.rgb, u_opacity * coverage * v_color.a * v_fade);
}
