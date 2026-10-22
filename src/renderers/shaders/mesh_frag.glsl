#version 300 es

precision highp float;

layout (location = 0) out vec4 fragColor;

uniform vec3 u_color;
uniform float u_ambientStrength;
uniform float u_diffuseStrength;

in vec3 v_normal;

void main() {
    vec3 lightDirection = normalize(vec3(0.0, -1.0, 1.0));
    float diffuse = max(dot(normalize(v_normal), lightDirection), 0.0);
    float brightness = u_ambientStrength + u_diffuseStrength * diffuse;
    fragColor = vec4(u_color * brightness, 1.0);
}
