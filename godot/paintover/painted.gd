extends "res://tests/hd2d.gd"
## Paint-over experiment, step 3: the staged battle from tests/hd2d.gd, but the battlefield is the block map
## with the stitched painting projected onto it (projection.gdshader) and the camera is orthographic.
## Screenshots go to $VT_SHOTS as po-*.png.

const Blockout = preload("res://paintover/blockout.gd")
const Tiles = preload("res://paintover/tiles.gd")


func _ready() -> void:
	game = Game.new()
	game.ortho = true
	add_child(game)
	world = game.world
	_soften_atmosphere()
	_paint_world()
	_stage()
	_run()


## Replaces the game's terrain and dressing with the painted blocks.
func _paint_world() -> void:
	_strip_world()
	var img := Image.load_from_file(ProjectSettings.globalize_path("res://paintover/pano.jpg"))
	img.generate_mipmaps()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://paintover/projection.gdshader")
	mat.set_shader_parameter("pano", ImageTexture.create_from_image(img))
	mat.set_shader_parameter("rect", Vector4(Tiles.PANO.position.x, Tiles.PANO.end.y, Tiles.PANO.size.x, Tiles.PANO.size.y))
	mat.set_shader_parameter("fallback", Color(0.36, 0.2, 0.09))  # autumn canopy beyond the painting
	var env: Environment = world.environment
	mat.set_shader_parameter("ambient", Vector3(env.ambient_light_color.r, env.ambient_light_color.g, env.ambient_light_color.b) * env.ambient_light_energy)
	var blocks := Node3D.new()
	blocks.name = "PaintedBlocks"
	world.add_child(blocks)
	Blockout.new().build(blocks, func(_k): return mat)
	for b in blocks.get_children():
		b.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF  # the painting has their shadows


## Drops the game's own terrain, water, ground cover, trees and props; keeps light, fireflies, braziers and
## actors.
func _strip_world() -> void:
	for c in world.get_children():
		var keep: bool = c == world.actors or c is WorldEnvironment or c is DirectionalLight3D or c is OmniLight3D \
			or c is GPUParticles3D or (c is AnimatedSprite3D and not c.shaded)
		if not keep:
			c.queue_free()


## The painting already has its light and mood, so the game's own grading and haze would wash it out, and
## its sun must agree with the painted one:
## - no tone mapping curve, colour grade, contrast or saturation change, fog, light shafts, vignette or depth of
##   field: the ground shows exactly as painted (projection.gdshader keeps lit areas at the painted colour);
## - the sun comes from the left like the painted light (the painted tents' shadows fall to the right), turned
##   a little toward the front: units are flat sprites facing the camera and leaning back, so a sun straight
##   from the side hits them edge-on and one from behind hides their shadow under them and leaves them dark;
## - single-map sun shadows: the two-split mode the game uses gives no shadows with an orthographic camera.
const SUN_ROT := Vector3(-38.0, -60.0, 0.0)


func _soften_atmosphere() -> void:
	for layer in game.get_children():
		if layer is CanvasLayer:
			for c in layer.get_children():
				if c is ColorRect and c.material is ShaderMaterial and c.material.shader.resource_path.ends_with("sunbeams.gdshader"):
					c.visible = false
				elif c is TextureRect:
					c.visible = false  # vignette
	var env: Environment = world.environment
	env.fog_enabled = false
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	env.tonemap_exposure = 1.0
	env.adjustment_enabled = false
	env.glow_intensity = 0.25  # fire and spells still bloom; the painting stays below the threshold
	env.ambient_light_color = Color(0.86, 0.84, 0.86)
	env.ambient_light_energy = 0.62
	var sun: DirectionalLight3D = world.sun
	sun.rotation_degrees = SUN_ROT
	sun.light_color = Color(1.0, 0.86, 0.66)
	sun.light_energy = 0.75
	sun.shadow_opacity = 1.0
	sun.shadow_blur = 0.7
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance = 160.0
	game.cam3d.attributes = null


func _shot(name: String) -> void:
	await get_tree().create_timer(0.6).timeout
	await get_tree().process_frame
	await get_tree().process_frame
	var dir := OS.get_environment("VT_SHOTS")
	if dir == "":
		dir = ProjectSettings.globalize_path("user://shots")
	DirAccess.make_dir_recursive_absolute(dir)
	get_viewport().get_texture().get_image().save_png(dir.path_join("po-%s.png" % name))
	print("shot ", name)


func _run() -> void:
	await get_tree().create_timer(1.5).timeout
	look(0, -3)
	await _shot("1-fight")
	look(-66, -6)
	await _shot("2-blue-base")
	look(40, -4, 0.6)
	await _shot("3-wide")
	look(-2, -1, 1.35)
	await _shot("4-close")
	look(-52, 9, 1.0)
	await _shot("5-mines")
	look(78, -10, 0.7)
	await _shot("6-red-keep")
	get_tree().quit()
