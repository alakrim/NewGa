extends Node3D
## Paint-over experiment, step 1: renders the block map in flat colours from the game angle, one image per
## tile (see tiles.gd), into res://paintover/guides/. Run with --resolution 1920x1280.

const Blockout = preload("res://paintover/blockout.gd")
const Tiles = preload("res://paintover/tiles.gd")
const World = preload("res://scripts/world3d.gd")

var cam := Camera3D.new()


func _ready() -> void:
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Blockout.COLORS.ground
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(1, 1, 1)
	e.ambient_light_energy = 0.55
	e.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	var we := WorldEnvironment.new()
	we.environment = e
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-34, -38, 0)  # same sun as world3d.gd, so painted shadows match the real ones
	sun.light_energy = 0.75
	sun.shadow_enabled = true
	sun.shadow_opacity = 0.6
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance = 300.0
	add_child(sun)
	var mats := {}
	for k in Blockout.COLORS:
		var m := StandardMaterial3D.new()
		m.albedo_color = Blockout.COLORS[k]
		m.roughness = 1.0
		m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
		mats[k] = m
	Blockout.new().build(self, func(k): return mats[k])
	add_child(cam)
	cam.make_current()
	_run()


func _run() -> void:
	var dir := ProjectSettings.globalize_path("res://paintover/guides")
	DirAccess.make_dir_recursive_absolute(dir)
	var i := 0
	for v in Tiles.ROWS:
		for u in Tiles.COLS:
			Tiles.aim(cam, u, v, Tiles.TILE.y)
			for f in range(4):
				await get_tree().process_frame
			get_viewport().get_texture().get_image().save_png(dir.path_join("tile_%d.png" % i))
			print("tile ", i, " u=", u, " v=", v)
			i += 1
	# one overview of the whole panorama for context
	Tiles.aim(cam, Tiles.PANO.get_center().x, Tiles.PANO.get_center().y, Tiles.PANO.size.y)
	for f in range(4):
		await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png(dir.path_join("overview.png"))
	get_tree().quit()
