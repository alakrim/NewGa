// Paint-over experiment: projects the stitched painting onto the block map. The camera looks down at a
// fixed pitch with an orthographic projection, so every surface maps to one spot on the view plane
// (u = x, v = y cos(pitch) - z sin(pitch)) wherever the camera pans or zooms; see tiles.gd.
// The painting already has its light and shadows, so the sun only adds the shadows of things that are not
// painted (units, buildings), and local lights (braziers, spells) add on top.
shader_type spatial;
render_mode specular_disabled, cull_back;

uniform sampler2D pano : source_color, filter_linear_mipmap, repeat_disable;
uniform vec4 rect = vec4(-104.25, 33.0, 208.5, 51.0); // u0, v at the top, width, height
uniform float pitch = 52.0;
uniform vec3 fallback : source_color = vec3(0.25, 0.48, 0.62);
// Scene ambient (world3d.gd: colour * energy); lit areas get 1 - ambient from the sun so they show the
// painting as is, shadowed ones keep `shadow` of it.
uniform vec3 ambient = vec3(0.325, 0.38, 0.493);
uniform float shadow = 0.5;
uniform float gain = 1.0;

varying vec3 wp;

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	float r = radians(pitch);
	float v = wp.y * cos(r) - wp.z * sin(r);
	vec2 uv = vec2((wp.x - rect.x) / rect.z, (rect.y - v) / rect.w);
	vec3 c = fallback;
	if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0)
		c = texture(pano, uv).rgb;
	ALBEDO = c * gain;
}

void light() {
	if (LIGHT_IS_DIRECTIONAL) {
		DIFFUSE_LIGHT += (vec3(1.0) - ambient) * mix(shadow, 1.0, ATTENUATION);
	} else {
		DIFFUSE_LIGHT += LIGHT_COLOR * ATTENUATION * max(dot(NORMAL, LIGHT), 0.0) / PI;
	}
}
