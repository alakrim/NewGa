extends RefCounted
## Paint-over experiment: how the painting is cut into tiles. The game camera looks down at a fixed
## pitch, so with an orthographic camera every point maps to the same spot on one flat "view plane"
## wherever the camera pans: u = world x, v = y cos(pitch) - z sin(pitch). The painting is a single
## panorama over that plane; it is generated in overlapping tiles and stitched.

const PITCH := 52.0
const TILE := Vector2(87.0, 58.0)  # units on the view plane, 3:2 like the image model's output
const TILE_PX := Vector2i(1920, 1280)
## Panorama extent on the view plane (u0, v0, u1, v1) and tile centres.
const PANO := Rect2(-115.5, -25.0, 231.0, 58.0)
const COLS := [-72.0, 0.0, 72.0]
const ROWS := [4.0]


static func view_v(p: Vector3) -> float:
	var r := deg_to_rad(PITCH)
	return p.y * cos(r) - p.z * sin(r)


## Places an orthographic camera at the game pitch so it looks at view-plane point (u, v).
static func aim(cam: Camera3D, u: float, v: float, height: float) -> void:
	var r := deg_to_rad(PITCH)
	var target := Vector3(u, 0.0, -v / sin(r))
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.keep_aspect = Camera3D.KEEP_HEIGHT
	cam.size = height
	cam.position = target + Vector3(0, sin(r), cos(r)) * 120.0
	cam.rotation = Vector3(-r, 0, 0)
	cam.near = 1.0
	cam.far = 400.0
