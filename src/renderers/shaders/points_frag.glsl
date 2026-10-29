#version 300 es

precision mediump float;

layout (location = 0) out vec4 fragColor;

uniform mediump sampler2DArray u_markerAtlas;

in vec4 v_color;
flat in uint v_marker;
in float v_fade;
flat in float v_hollow;

uniform float u_opacity;
// Outline width of hollow markers, in pixels.
uniform float u_outlinePixels;


void main() {
    // The atlas holds the signed distance to the marker's edge in sprite
    // units (negative inside); the gradient's length is one screen pixel in
    // those units, so the edge is antialiased over one pixel at any size.
    float dist = texture(u_markerAtlas, vec3(gl_PointCoord, v_marker)).r;
    float pixel = length(vec2(dFdx(dist), dFdy(dist)));
    float coverage = 1.0 - smoothstep(-0.5 * pixel, 0.5 * pixel, dist);
    if (v_hollow > 0.5) {
        // Keep a band of u_outlinePixels inside the edge: subtract the
        // coverage of the marker shrunk by that width.
        float band = u_outlinePixels * pixel;
        coverage -= 1.0 - smoothstep(-0.5 * pixel, 0.5 * pixel, dist + band);
    }
    if (coverage < 1e-2) {
        discard;
    }
    fragColor = vec4(v_color.rgb, u_opacity * coverage * v_color.a * v_fade);
}

