extends Node2D
## One unit on the battlefield: animated Tiny Swords body, ground shadow, health bar, hero glow and name.

const V = preload("res://scripts/visuals.gd")

const F_DEAD := 1
const F_MOVING := 2
const F_STUNNED := 4
const F_STEALTH := 8
const F_AIRBORNE := 2048
const F_CARRYING := 32768

var id := 0
var team := 0
var kind := "minion"  # minion | hero
var body_id := "swordsman"
var color := "blue"
var is_me := false
var hero_name := ""
var level := 0

var target := Vector2.ZERO
var hp := 1.0
var max_hp := 1.0
var shield := 0.0
var flags := 0
var dead := false
var _attack_until := 0.0
var _flash := 0.0
var _body: AnimatedSprite2D
var _label: Label
var _scale := 1.0
var _feet := 30.0
var _bar_w := 34.0
var _hop := 0.0
var _aura: Sprite2D


func setup(p_id: int, p_team: int, p_kind: String, p_body: String, p_color: String, me: bool, name_text := "") -> void:
	id = p_id
	team = p_team
	kind = p_kind
	body_id = p_body
	color = p_color
	is_me = me
	hero_name = name_text
	var def: Dictionary = V.UNITS.get(body_id, V.UNITS["swordsman"])
	_scale = def.get("scale", 1.0) * (V.HERO_SCALE if kind == "hero" else 1.0)
	_feet = def.get("feet", 30.0)
	if kind == "hero":
		_aura = Sprite2D.new()
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 0.75))
		g.set_color(1, Color(1, 1, 1, 0))
		var gt := GradientTexture2D.new()
		gt.gradient = g
		gt.fill = GradientTexture2D.FILL_RADIAL
		gt.fill_from = Vector2(0.5, 0.5)
		gt.fill_to = Vector2(1, 0.5)
		gt.width = 128
		gt.height = 128
		_aura.texture = gt
		_aura.scale = Vector2(1.3, 0.55)
		_aura.modulate = (Color("7cff8a") if me else V.PLAYER_COLORS.get(color, Color.WHITE)) * Color(1.4, 1.4, 1.4, 0.8)
		var mat := CanvasItemMaterial.new()
		mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		_aura.material = mat
		add_child(_aura)
	_body = AnimatedSprite2D.new()
	_body.sprite_frames = Sprites.frames(body_id, color)
	_body.offset = Vector2(0, -_feet)
	_body.scale = Vector2.ONE * _scale
	_body.animation_finished.connect(_on_anim_done)
	add_child(_body)
	_play("idle")
	_bar_w = 60.0 if kind == "hero" else (70.0 if body_id == "giant" else 34.0)
	if kind == "hero":
		_label = Label.new()
		_label.text = hero_name
		_label.add_theme_font_size_override("font_size", 13)
		_label.add_theme_color_override("font_color", V.PLAYER_COLORS.get(color, Color.WHITE).lightened(0.35))
		_label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
		_label.add_theme_constant_override("outline_size", 5)
		_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_label.size = Vector2(160, 18)
		_label.position = Vector2(-80, -_feet * _scale - 92 * _scale * 0.5 - 30)
		add_child(_label)


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
	var p := V.to_px(snap[3], snap[4])
	if target.distance_to(p) > 300 or target == Vector2.ZERO:
		position = p
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
	if now_dead and not dead:
		dead = true
		_body.visible = false
	elif not now_dead and dead:
		dead = false
		_body.visible = true
	queue_redraw()


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
		_aura.modulate.a = 0.55 + 0.25 * sin(now * 4.0)
	# airborne hop and stun wobble
	var want_hop := 18.0 if (flags & F_AIRBORNE) != 0 else 0.0
	_hop = lerpf(_hop, want_hop, 1.0 - exp(-delta * 12.0))
	_body.position.y = -_hop
	_body.modulate = Color(1, 1, 1, 0.4 if (flags & F_STEALTH) != 0 else 1.0)
	if _flash > 0.0:
		_flash -= delta
		_body.modulate = Color(2.2, 2.2, 2.2, _body.modulate.a)
	if (flags & F_STUNNED) != 0:
		_body.rotation = sin(now * 18.0) * 0.08
	else:
		_body.rotation = 0.0


func _draw() -> void:
	if dead:
		return
	# soft ground shadow
	var rx := 20.0 * _scale * (1.6 if body_id == "giant" else 1.0)
	draw_set_transform(Vector2.ZERO, 0, Vector2(1, 0.42))
	draw_circle(Vector2.ZERO, rx, Color(0, 0, 0, 0.22))
	draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)
	if kind == "hero":
		var ring_col: Color = Color("7cff8a") if is_me else V.PLAYER_COLORS.get(color, Color.WHITE)
		draw_set_transform(Vector2.ZERO, 0, Vector2(1, 0.42))
		draw_arc(Vector2.ZERO, rx + 8, 0, TAU, 40, ring_col, 3.0)
		draw_set_transform(Vector2.ZERO, 0, Vector2.ONE)
	# health bar when hurt (always for heroes)
	if hp < max_hp or kind == "hero" or shield > 0:
		var top := -_feet * _scale - 70.0 * _scale
		var w := _bar_w
		var total := maxf(max_hp, hp + shield)
		draw_rect(Rect2(-w / 2 - 1, top - 1, w + 2, 7), Color(0, 0, 0, 0.75))
		var col: Color = Color("4ade80") if is_me else (V.TEAM_COLORS[team] if team < 2 else Color("facc15"))
		draw_rect(Rect2(-w / 2, top, w * hp / total, 5), col)
		if shield > 0:
			draw_rect(Rect2(-w / 2 + w * hp / total, top, w * shield / total, 5), Color(0.95, 0.95, 1.0))
		if kind == "hero":
			draw_string(ThemeDB.fallback_font, Vector2(-w / 2 - 18, top + 6), str(level), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color("ffd166"))
