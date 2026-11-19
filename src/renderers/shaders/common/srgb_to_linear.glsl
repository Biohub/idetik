vec3 srgbToLinear(vec3 color) {
    return mix(
        color / 12.92,
        pow((color + 0.055) / 1.055, vec3(2.4)),
        greaterThan(color, vec3(0.04045))
    );
}
