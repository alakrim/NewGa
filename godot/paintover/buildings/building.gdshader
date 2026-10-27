// Painted buildings: a cut-out painting on a quad that faces the orthographic camera, shown at its painted
// colours (the painting has its own light) and casting a shadow from its outline. The blue team trim is
// swapped for the owner's colour.
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_opaque;

uniform sampler2D tex : source_color, filter_linear_mipmap;
uniform float target_hue = -1.0; // 0..1, or < 0 to keep the painted blue
uniform float target_value = 1.0;

vec3 rgb2hsv(vec3 c) {
	vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}

vec3 hsv2rgb(vec3 c) {
	vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
	return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void fragment() {
	vec4 t = texture(tex, UV);
	vec3 c = t.rgb;
	if (target_hue >= 0.0) {
		vec3 h = rgb2hsv(c);
		// how strongly this pixel is team blue: hue around 0.64, some saturation
		float k = smoothstep(0.1, 0.06, abs(h.x - 0.64)) * smoothstep(0.12, 0.25, h.y);
		vec3 swapped = hsv2rgb(vec3(fract(target_hue + h.x - 0.64), h.y, min(1.0, h.z * target_value)));
		c = mix(c, swapped, k);
	}
	ALBEDO = c;
	ALPHA = t.a;
	ALPHA_SCISSOR_THRESHOLD = 0.5;
}
