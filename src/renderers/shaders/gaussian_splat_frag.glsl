#version 300 es

precision highp float;

layout (location = 0) out vec4 fragColor;

in vec2 v_offset;
flat in vec3 v_conic;
flat in vec4 v_color;

void main() {
    vec2 d = v_offset;
    float mahalSq = v_conic.x * d.x * d.x + 2.0 * v_conic.y * d.x * d.y + v_conic.z * d.y * d.y;
    float alpha = min(0.99, v_color.a * exp(-0.5 * mahalSq));
    if (alpha < 1.0 / 255.0) discard;
    // Premultiplied alpha for back-to-front "over" compositing.
    fragColor = vec4(v_color.rgb * alpha, alpha);
}
