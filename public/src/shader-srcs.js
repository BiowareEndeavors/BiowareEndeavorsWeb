// ===============================
// shader-srcs.js (LOG_R8_UNORM volume; uses hardware sampling via texture())
// Texture samples return unit-space in [0,1] directly (already log-mapped in CUDA).
// ===============================

var vertShader =
`#version 300 es
layout(location=0) in vec3 pos;
uniform mat4 proj_view;
uniform vec3 eye_pos;
uniform vec3 volume_scale;

out vec3 vray_dir;
flat out vec3 transformed_eye;

void main(void) {
    // The current density.bin format describes a box centered at the origin.
    vec3 volume_translation = -volume_scale * 0.5;
    gl_Position = proj_view * vec4(pos * volume_scale + volume_translation, 1.0);
    transformed_eye = (eye_pos - volume_translation) / volume_scale;
    vray_dir = pos - transformed_eye;
}`;

// ------------------------------
// Volume fragment shader (raymarch) - LOG_R8_UNORM (unit-space)
// ------------------------------
var fragShaderVol =
`#version 300 es
precision highp int;
precision highp float;

uniform highp sampler3D volume;     // R8 UNORM (unit-space [0,1])
uniform highp sampler2D colormap;   // 180x1
uniform ivec3 volume_dims;
uniform float dt_scale;
uniform vec2  screen_dims;

// UI-exposed volume parameters
uniform float uAlphaLo;
uniform float uAlphaHi;
uniform float uOpacityStrength;

in vec3 vray_dir;
flat in vec3 transformed_eye;
out vec4 color;

vec2 intersect_box(vec3 orig, vec3 dir) {
    const vec3 box_min = vec3(0.0);
    const vec3 box_max = vec3(1.0);
    vec3 inv_dir = 1.0 / dir;
    vec3 tmin_tmp = (box_min - orig) * inv_dir;
    vec3 tmax_tmp = (box_max - orig) * inv_dir;
    vec3 tmin = min(tmin_tmp, tmax_tmp);
    vec3 tmax = max(tmin_tmp, tmax_tmp);
    float t0 = max(tmin.x, max(tmin.y, tmin.z));
    float t1 = min(tmax.x, min(tmax.y, tmax.z));
    return vec2(t0, t1);
}

float wang_hash(int seed) {
    seed = (seed ^ 61) ^ (seed >> 16);
    seed *= 9;
    seed = seed ^ (seed >> 4);
    seed *= 0x27d4eb2d;
    seed = seed ^ (seed >> 15);
    return float(seed % 2147483647) / float(2147483647);
}

float linear_to_srgb(float x) {
    if (x <= 0.0031308) return 12.92 * x;
    return 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}

// Sample in [0,1]^3; returned value is already unit-space in [0,1]
float sample_volume(vec3 p) {
    p = clamp(p, vec3(0.0), vec3(1.0));
    return texture(volume, p).r;
}

void main(void) {
    color = vec4(0.0);

    vec3 ray_dir = normalize(vray_dir);
    vec2 t_hit = intersect_box(transformed_eye, ray_dir);
    if (t_hit.x > t_hit.y) discard;
    t_hit.x = max(t_hit.x, 0.0);

    vec3 dt_vec = 1.0 / (vec3(volume_dims) * abs(ray_dir));
    float dt = dt_scale * min(dt_vec.x, min(dt_vec.y, dt_vec.z));

    int sx = max(1, int(screen_dims.x));
    int seed = int(gl_FragCoord.x) + sx * int(gl_FragCoord.y);

    float r0 = wang_hash(seed);
    float r1 = wang_hash(seed ^ 0x9e3779b9);

    float phase  = r0 * dt;
    float jitter = (r1 - 0.5) * (0.25 * dt);

    vec3 p = transformed_eye + (t_hit.x + phase + jitter) * ray_dir;

    float aLo = clamp(uAlphaLo, 0.0, 1.0);
    float aHi = clamp(uAlphaHi, 0.0, 1.0);
    if (aHi < aLo) { float tmp = aLo; aLo = aHi; aHi = tmp; }
    float opS = max(uOpacityStrength, 0.0);

    const int MAX_STEPS = 1024;
    int steps = 0;

    for (float t = t_hit.x; t < t_hit.y; t += dt) {
        float val = sample_volume(p);                  // unit-space [0,1]
        vec3 rgb = texture(colormap, vec2(val, 0.5)).rgb;

        float a = smoothstep(aLo, aHi, val);
        a *= opS;
        a = clamp(a, 0.0, 1.0);

        // keep your existing opacity correction
        a = 1.0 - pow(1.0 - a, dt_scale);

        color.rgb += (1.0 - color.a) * a * rgb;
        color.a   += (1.0 - color.a) * a;

        if (color.a >= 0.99) { color.a = 1.0; break; }

        p += ray_dir * dt;

        steps++;
        if (steps >= MAX_STEPS) break;
    }

    color.r = linear_to_srgb(color.r);
    color.g = linear_to_srgb(color.g);
    color.b = linear_to_srgb(color.b);
}`;

// ------------------------------
// Isosurface fragment shader - LOG_R8_UNORM (unit-space)
// iso_value is expected to be unit-space threshold in [0,1] (JS converts from RAW rho)
// ------------------------------
var fragShaderIso =
`#version 300 es
precision highp int;
precision highp float;

uniform highp sampler3D volume;     // R8 UNORM (unit-space [0,1])
uniform highp sampler2D colormap;

uniform ivec3 volume_dims;
uniform float dt_scale;

uniform vec2  screen_dims;
uniform float iso_value;            // UNIT-space threshold [0,1]

in vec3 vray_dir;
flat in vec3 transformed_eye;
out vec4 color;

vec2 intersect_box(vec3 orig, vec3 dir) {
    const vec3 box_min = vec3(0.0);
    const vec3 box_max = vec3(1.0);
    vec3 inv_dir = 1.0 / dir;
    vec3 tmin_tmp = (box_min - orig) * inv_dir;
    vec3 tmax_tmp = (box_max - orig) * inv_dir;
    vec3 tmin = min(tmin_tmp, tmax_tmp);
    vec3 tmax = max(tmin_tmp, tmax_tmp);
    float t0 = max(tmin.x, max(tmin.y, tmin.z));
    float t1 = min(tmax.x, min(tmax.y, tmax.z));
    return vec2(t0, t1);
}

float wang_hash(int seed) {
    seed = (seed ^ 61) ^ (seed >> 16);
    seed *= 9;
    seed = seed ^ (seed >> 4);
    seed *= 0x27d4eb2d;
    seed = seed ^ (seed >> 15);
    return float(seed % 2147483647) / float(2147483647);
}

// Sample in [0,1]^3; returned value is unit-space in [0,1]
float sample_volume(vec3 p) {
    p = clamp(p, vec3(0.0), vec3(1.0));
    return texture(volume, p).r;
}

vec3 normal_from_density(vec3 p) {
    vec3 e = 1.0 / vec3(volume_dims);

    float dx = sample_volume(p + vec3(e.x, 0.0, 0.0)) - sample_volume(p - vec3(e.x, 0.0, 0.0));
    float dy = sample_volume(p + vec3(0.0, e.y, 0.0)) - sample_volume(p - vec3(0.0, e.y, 0.0));
    float dz = sample_volume(p + vec3(0.0, 0.0, e.z)) - sample_volume(p - vec3(0.0, 0.0, e.z));

    vec3 g = vec3(dx, dy, dz);
    float gl = length(g);
    if (gl <= 1e-12) return vec3(0.0, 0.0, 1.0);

    return normalize(-g);
}

void main(void) {
    vec3 ray_dir = normalize(vray_dir);

    vec2 t_hit = intersect_box(transformed_eye, ray_dir);
    if (t_hit.x > t_hit.y) discard;
    t_hit.x = max(t_hit.x, 0.0);

    vec3 dt_vec = 1.0 / (vec3(volume_dims) * abs(ray_dir));
    float dt = dt_scale * min(dt_vec.x, min(dt_vec.y, dt_vec.z));

    int sx = max(1, int(screen_dims.x));
    int seed = int(gl_FragCoord.x) + sx * int(gl_FragCoord.y);
    float jitter = (wang_hash(seed) - 0.5) * (0.25 * dt);

    float t = t_hit.x;
    vec3 p = transformed_eye + (t + jitter) * ray_dir;

    float prev = sample_volume(p);
    bool hit = false;

    float t0 = t;
    float t1 = t;

    const int MAX_STEPS = 2048;
    int steps = 0;

    for (; t < t_hit.y; t += dt) {
        t1 = t;
        vec3 p1 = transformed_eye + (t1 + jitter) * ray_dir;
        float v1 = sample_volume(p1);

        if (prev < iso_value && v1 >= iso_value) {
            hit = true;
            t0 = t1 - dt;
            break;
        }

        prev = v1;

        steps++;
        if (steps >= MAX_STEPS) break;
    }

    if (!hit) discard;

    float a = t0;
    float b = t1;
    for (int i = 0; i < 8; ++i) {
        float m = 0.5 * (a + b);
        vec3 pm = transformed_eye + (m + jitter) * ray_dir;
        float vm = sample_volume(pm);
        if (vm >= iso_value) b = m;
        else                a = m;
    }

    float thit = 0.5 * (a + b);
    vec3 phit = transformed_eye + (thit + jitter) * ray_dir;

    vec3 N = normal_from_density(phit);

    vec3 V = normalize(-ray_dir);
    vec3 L = V;
    vec3 H = V;

    float diff = max(dot(N, L), 0.0);

    const float SHININESS      = 48.0;
    const float AMBIENT        = 0.25;
    const float DIFFUSE        = 0.90;
    const float SPEC_STRENGTH  = 0.20;

    float spec = pow(max(dot(N, H), 0.0), SHININESS);

    float val = sample_volume(phit); // unit-space for colormap
    vec3 baseColor = texture(colormap, vec2(val, 0.5)).rgb;

    vec3 shaded = baseColor * (AMBIENT + DIFFUSE * diff) + vec3(1.0) * (SPEC_STRENGTH * spec);

    color = vec4(shaded, 1.0);
}`;
