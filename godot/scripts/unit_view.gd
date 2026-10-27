extends Node3D
## One unit on the HD-2D battlefield: an animated Tiny Swords sprite standing in the 3D world with a real
## shadow, a soft contact shadow, and a pulsing aura under heroes. Health bars and names are drawn by the
## game's screen overlay from `hp`, `max_hp`, `shield`, `level` and `head_height()`.

const V = preload("res://scripts/visuals.gd")
const W3 = preload("res://scripts/world3d.gd")

const F_DEAD := 1
const F_MOVING := 2
const F_STUNNED := 4
const F_STEALTH := 8
const F_AIRBORNE := 2048
const F_CARRYING := 32768
const UNIT_SCALE := 1.15

var id := 0
var team := 0
var kind := "minion"  # minion | hero
var body_id := "swordsman"
var color := "blue"
var is_me := false
var hero_name := ""
var level := 0

var target := Vector3.ZERO
var hp := 1.0
var max_hp := 1.0
var shield := 0.0
var flags := 0
var dead := false
var _attack_until := 0.0
var _flash := 0.0
var _body: AnimatedSprite3D
var _aura: Sprite3D
var _scale := 1.0
var _frame_h := 192.0
var _hop := 0.0
var _placed := false

## Position in the 2D "px" space the HUD works in (32 px per sim unit, y = sim z).
var px: Vector2:
	get:
		return Vector2(position.x, position.z) * V.PX


static func flat_sprite(tex: Texture2D, size_units: float, col: Color, additive: bool) -> Sprite3D:
	var s := Sprite3D.new()
	s.texture = tex
	s.axis = Vector3.Axis.AXIS_Y
	s.pixel_size = size_units / maxf(1.0, tex.get_width())
	s.modulate = col
	s.shaded = false
	s.transparent = true
	s.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	s.position.y = 0.03
	if additive:
		var m := StandardMaterial3D.new()
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		m.albedo_texture = tex
		m.vertex_color_use_as_albedo = true
		s.material_override = m
	return s


func setup(p_id: int, p_team: int, p_kind: String, p_body: String, p_color: String, me: bool, name_text := "") -> void:
	id = p_id
	team = p_team
	kind = p_kind
	body_id = p_body
	color = p_color
	is_me = me
	hero_name = name_text
	var def: Dictionary = V.UNITS.get(body_id, V.UNITS["swordsman"])
	_scale = def.get("scale", 1.0) * (V.HERO_SCALE if kind == "hero" else 1.0) * UNIT_SCALE
	_frame_h = float(def.get("frame", Vector2i(192, 192)).y)
	var glow: Texture2D = load(W3.HD + "glow.png")
	# contact shadow keeps feet planted even when the sun shadow falls far behind
	var w := (1.5 if body_id == "giant" else 0.95) * _scale
	add_child(flat_sprite(glow, w * 1.6, Color(0, 0, 0, 0.42), false))
	if kind == "hero":
		var c: Color = Color("7cff8a") if me else V.PLAYER_COLORS.get(color, Color.WHITE)
		_aura = flat_sprite(glow, 3.4 * _scale, c * Color(1.6, 1.6, 1.6, 0.8), true)
		add_child(_aura)
	_body = AnimatedSprite3D.new()
	_body.sprite_frames = Sprites.frames(body_id, color)
	W3.standee(_body, _frame_h, _frame_h / 2.0 - def.get("feet", 30.0), _scale)
	_body.animation_finished.connect(_on_anim_done)
	add_child(_body)
	_play("idle")


## Height above the feet where the health bar sits (world units).
func head_height() -> float:
	return _frame_h * 0.36 * W3.PIX * _scale * cos(W3.TILT) + 0.45


func _play(anim: String) -> void:
	if _body.sprite_frames and _body.sprite_frames.has_animation(anim):
		if _body.animation != anim or not _body.is_playing():
			_body.play(anim)
	elif _body.sprite_frames and _body.sprite_frames.has_animation("idle") and _body.animation != "idle":
		_body.play("idle")


func play_attack(face_x: float) -> void:
	if dead:
		return
	if absf(face_x) > 0.01:
		_body.flip_h = face_x < 0
	var a := "attack"
	if body_id == "swordsman" and randf() < 0.5:
		a = "attack2"
	if _body.sprite_frames.has_animation(a):
		_body.play(a)
		_body.frame = 0
		_attack_until = Time.get_ticks_msec() / 1000.0 + 1.2


func hit() -> void:
	_flash = 0.12


func _on_anim_done() -> void:
	if _body.animation.begins_with("attack"):
		_attack_until = 0.0


func apply(snap: Array) -> void:
	# [id, vis, team, x, z, facing, hp, maxHp, shield, flags, level]
	var x := float(snap[3])
	var z := float(snap[4])
	var p := Vector3(x, W3.ground_y(x, z), z)
	if not _placed or target.distance_to(p) > 10.0:
		position = p
		_placed = true
	target = p
	hp = snap[6]
	max_hp = maxf(1.0, snap[7])
	shield = snap[8]
	flags = int(snap[9])
	level = int(snap[10])
	var face := sin(float(snap[5]))
	if absf(face) > 0.2 and Time.get_ticks_msec() / 1000.0 > _attack_until:
		_body.flip_h = face < 0
	var now_dead := (flags & F_DEAD) != 0
	if now_dead != dead:
		dead = now_dead
		visible = not dead


func _process(delta: float) -> void:
	position = position.lerp(target, 1.0 - exp(-delta * (22.0 if is_me else 14.0)))
	if dead:
		return
	var now := Time.get_ticks_msec() / 1000.0
	var moving := (flags & F_MOVING) != 0
	var carrying := (flags & F_CARRYING) != 0
	if now > _attack_until:
		if carrying:
			_play("carry_run" if moving else "carry_idle")
		else:
			_play("run" if moving else "idle")
	if _aura:
		_aura.modulate.a = 0.5 + 0.25 * sin(now * 4.0)
	var want_hop := 0.6 if (flags & F_AIRBORNE) != 0 else 0.0
	_hop = lerpf(_hop, want_hop, 1.0 - exp(-delta * 12.0))
	_body.position.y = _hop
	var stealth := (flags & F_STEALTH) != 0
	var cut := SpriteBase3D.ALPHA_CUT_DISABLED if stealth else SpriteBase3D.ALPHA_CUT_DISCARD
	if _body.alpha_cut != cut:
		_body.alpha_cut = cut
	var m := Color(1, 1, 1, 0.4 if stealth else 1.0)
	if _flash > 0.0:
		_flash -= delta
		m = Color(2.6, 2.4, 2.2, m.a)
	_body.modulate = m
	_body.rotation.z = sin(now * 18.0) * 0.08 if (flags & F_STUNNED) != 0 else 0.0
