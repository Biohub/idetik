#version 300 es

precision mediump float;

layout (location = 0) out vec4 fragColor;

uniform mediump sampler2DArray u_markerAtlas;

in vec4 v_color;
flat in uint v_marker;
in float v_fade;
flat in float v_hollow;
flat in float v_outlinePixels;
flat in float v_pointSize;

uniform float u_opacity;


void main() {
    // The atlas holds the signed distance to the marker's edge in sprite
    // units (negative inside). The sprite spans v_pointSize pixels, so one
    // screen pixel is 1 / v_pointSize in those units; the edge is
    // antialiased over one pixel at any size. (Not derived from screen-space
    // derivatives: those collapse along the distance field's creases, e.g.
    // a square's diagonals, and would open gaps in hollow outlines.)
    float dist = texture(u_markerAtlas, vec3(gl_PointCoord, v_marker)).r;
    float pixel = 1.0 / v_pointSize;
    float coverage = 1.0 - smoothstep(-0.5 * pixel, 0.5 * pixel, dist);
    if (v_hollow > 0.5) {
        // Keep a band of v_outlinePixels inside the edge: subtract the
        // coverage of the marker shrunk by that width.
        float band = v_outlinePixels * pixel;
        coverage -= 1.0 - smoothstep(-0.5 * pixel, 0.5 * pixel, dist + band);
    }
    if (coverage < 1e-2) {
        discard;
    }
    fragColor = vec4(v_color.rgb, u_opacity * coverage * v_color.a * v_fade);
}

