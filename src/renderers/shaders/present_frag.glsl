#version 300 es

precision highp float;

uniform highp sampler2D u_sceneSampler;

layout (location = 0) out vec4 fragColor;

vec3 linearToSrgb(vec3 color) {
    color = clamp(color, 0.0, 1.0);
    return mix(
        color * 12.92,
        1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
        greaterThan(color, vec3(0.0031308))
    );
}

void main() {
    vec4 sceneColor = texelFetch(u_sceneSampler, ivec2(gl_FragCoord.xy), 0);
    if (sceneColor.a <= 0.0) {
        fragColor = vec4(0.0);
        return;
    }

    vec3 color = linearToSrgb(sceneColor.rgb / sceneColor.a);
    fragColor = vec4(color * sceneColor.a, sceneColor.a);
}
