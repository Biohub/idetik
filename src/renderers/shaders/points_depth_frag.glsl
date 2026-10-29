#version 300 es

precision mediump float;

uniform mediump sampler2DArray u_markerAtlas;

flat in uint v_marker;

void main() {
    // Signed distance to the marker's edge: positive is outside.
    if (texture(u_markerAtlas, vec3(gl_PointCoord, v_marker)).r > 0.0) {
        discard;
    }
}
