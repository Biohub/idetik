#version 300 es

precision mediump float;

uniform mediump sampler2DArray u_markerAtlas;

flat in uint v_marker;

// The marker occupies the middle MARKER_FRACTION of its atlas sprite (see
// points_renderable.ts); the point sprite covers just the marker.
const float MARKER_FRACTION = 0.5;

void main() {
    // Signed distance to the marker's edge: positive is outside.
    vec2 uv = 0.5 + (gl_PointCoord - 0.5) * MARKER_FRACTION;
    if (texture(u_markerAtlas, vec3(uv, v_marker)).r > 0.0) {
        discard;
    }
}
