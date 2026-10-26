extends RefCounted
## Custom-drawn HUD widgets. They never take GUI mouse input: hud.gd dispatches raw multi-touch events to them
## (Godot's GUI only emulates a mouse for the first finger, so thumbs on the joystick and on ability buttons would clash).
## Touchable widgets implement hit(p), touch_down(idx, p), touch_move(idx, p), touch_up(idx, p).

const GOLD := UiArt.GOLD


# ------------------------------------------------------------------ Joystick
class Joystick extends Control:
	var radius := 92.0
	var base := Vector2.ZERO  # centre of the stick
	var knob := Vector2.ZERO
	var active := false
	var touch := -1
	var vec := Vector2.ZERO  # -1..1

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR

	func begin(idx: int, p: Vector2) -> void:
		active = true
		touch = idx
		base = p
		knob = p
		vec = Vector2.ZERO
		queue_redraw()

	func move(p: Vector2) -> void:
		var d := p - base
		if d.length() > radius:
			d = d.normalized() * radius
		knob = base + d
		vec = d / radius
		queue_redraw()

	func end() -> void:
		active = false
		touch = -1
		vec = Vector2.ZERO
		knob = base
		queue_redraw()

	func _draw() -> void:
		var a := 1.0 if active else 0.5
		draw_circle(base, radius + 6.0, Color(0.05, 0.03, 0.02, 0.28 * a + 0.1))
		draw_arc(base, radius, 0, TAU, 56, Color(1, 0.93, 0.75, 0.55 * a + 0.1), 5.0, true)
		draw_arc(base, radius - 26.0, 0, TAU, 40, Color(1, 0.93, 0.75, 0.18 * a), 3.0, true)
		# direction ticks
		for i in range(4):
			var ang := i * PI / 2.0
			draw_circle(base + Vector2(cos(ang), sin(ang)) * (radius - 13.0), 3.5, Color(1, 0.93, 0.75, 0.4 * a + 0.1))
		var kc := knob if active else base
		UiArt.draw_round(self, kc, 78.0, false, active, Color(1, 1, 1, 0.55 + 0.45 * a))


# ------------------------------------------------------------------ circular buttons (abilities, attack, recall)
class CircleButton extends Control:
	var diameter := 92.0
	var red := false
	var pressed := false
	var disabled := false
	var label := ""  # initials or caption
	var sub := ""  # small caption below the label
	var key_hint := ""
	var icon: Texture2D
	var icon_scale := 1.0
	var cd := 0.0
	var cd_max := 1.0
	var badge := ""  # bottom-right badge (mana cost)
	var badge_bad := false
	var pips := 0  # rank pips filled
	var pips_max := 0
	var locked_text := ""
	var progress := 0.0  # 0..1 ring (recall)
	var targeting := ""
	var flash := 0.0
	var on_tap: Callable
	var on_aim_begin: Callable  # (button)
	var on_aim_move: Callable  # (button, offset Vector2)
	var on_aim_end: Callable  # (button, offset Vector2, cancelled)
	var aimable := false
	var _touch := -1
	var _origin := Vector2.ZERO
	var _dragging := false
	var _t := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR

	func centre() -> Vector2:
		return size / 2.0

	func hit(p: Vector2) -> bool:
		return (p - (global_position + centre())).length() <= diameter * 0.5 + 6.0

	func touch_down(idx: int, p: Vector2) -> void:
		_touch = idx
		_origin = p
		_dragging = false
		pressed = true
		flash = 1.0
		if aimable and not disabled and on_aim_begin.is_valid():
			on_aim_begin.call(self)
		queue_redraw()

	func touch_move(idx: int, p: Vector2) -> void:
		if idx != _touch:
			return
		var off := p - _origin
		if off.length() > 18.0:
			_dragging = true
		if _dragging and aimable and on_aim_move.is_valid():
			on_aim_move.call(self, off)

	func touch_up(idx: int, p: Vector2) -> void:
		if idx != _touch:
			return
		_touch = -1
		pressed = false
		var off := p - _origin
		if aimable and not disabled:
			if _dragging:
				if on_aim_end.is_valid():
					# dragging back onto the button cancels the cast
					on_aim_end.call(self, off, (p - (global_position + centre())).length() < diameter * 0.32)
			elif on_tap.is_valid():
				on_tap.call(self)
			if not _dragging and on_aim_end.is_valid():
				on_aim_end.call(self, Vector2.ZERO, true)
		elif on_tap.is_valid() and not _dragging:
			on_tap.call(self)
		_dragging = false
		queue_redraw()

	func _process(delta: float) -> void:
		_t += delta
		if flash > 0.0:
			flash = maxf(0.0, flash - delta * 4.0)
		if cd > 0.0 or flash > 0.0 or pressed or progress > 0.0:
			queue_redraw()

	func _draw() -> void:
		var c := centre()
		var ready := not disabled and cd <= 0.0 and locked_text == ""
		var mod := Color.WHITE
		if disabled or locked_text != "":
			mod = Color(0.62, 0.62, 0.68, 1)
		UiArt.draw_round(self, c, diameter, red, pressed, mod)
		# face
		if icon:
			var isz := diameter * 0.52 * icon_scale
			var asp := float(icon.get_width()) / maxf(1.0, float(icon.get_height()))
			var sz := Vector2(isz * minf(1.0, asp), isz * minf(1.0, 1.0 / asp))
			draw_texture_rect(icon, Rect2(c - sz / 2.0 + Vector2(0, -2 if not pressed else 2), sz), false, Color(1, 1, 1, 1) if ready or cd > 0.0 else Color(1, 1, 1, 0.7))
		if label != "":
			var fs := int(diameter * (0.34 if label.length() <= 2 else 0.26))
			UiArt.dtext_c(self, label, c + Vector2(0, -2 if not pressed else 2), fs, Color.WHITE if ready else Color(0.85, 0.85, 0.9), 5)
		if sub != "":
			UiArt.dtext_c(self, sub, c + Vector2(0, diameter * 0.30), 14, UiArt.CREAM, 3)
		# cooldown sweep
		if cd > 0.0:
			UiArt.dpie(self, c, diameter * 0.47, clampf(cd / maxf(0.01, cd_max), 0.0, 1.0), Color(0, 0, 0, 0.62))
			UiArt.dtext_c(self, str(int(ceil(cd))) if cd >= 1.0 else "%.1f" % cd, c, int(diameter * 0.34), Color.WHITE, 5)
		elif locked_text != "":
			UiArt.dtext_c(self, locked_text, c + Vector2(0, diameter * 0.04), int(diameter * 0.22), Color("ffd9a0"), 4)
		if progress > 0.0:
			draw_arc(c, diameter * 0.52, -PI / 2, -PI / 2 + TAU * progress, 40, UiArt.GOLD, 6.0, true)
		# ready flash
		if flash > 0.0:
			draw_arc(c, diameter * 0.5 + (1.0 - flash) * 14.0, 0, TAU, 40, Color(1, 1, 1, flash * 0.9), 4.0, true)
		# rank pips
		if pips_max > 0:
			var pw := 9.0
			var x0 := c.x - (pips_max * pw) / 2.0 + 1.0
			for i in range(pips_max):
				var pc := Vector2(x0 + i * pw + 3.5, c.y + diameter * 0.5 + 2.0)
				draw_circle(pc, 3.6, Color(0, 0, 0, 0.8))
				draw_circle(pc, 2.6, UiArt.GOLD if i < pips else Color(0.35, 0.3, 0.25, 0.9))
		# mana cost badge
		if badge != "":
			var bc := c + Vector2(diameter * 0.36, diameter * 0.34)
			draw_circle(bc, 15.0, Color(0.05, 0.1, 0.25, 0.92))
			draw_arc(bc, 15.0, 0, TAU, 20, UiArt.MANA if not badge_bad else UiArt.BAD, 2.5, true)
			UiArt.dtext_c(self, badge, bc, 15, Color("cfe6ff") if not badge_bad else UiArt.BAD, 3)
		if key_hint != "":
			UiArt.dtext(self, key_hint, c + Vector2(-diameter * 0.48, -diameter * 0.36), 15, Color("ffeab0"), HORIZONTAL_ALIGNMENT_LEFT, -1, 4)


# ------------------------------------------------------------------ army training button
class ArmyButton extends Control:
	var unit_id := ""
	var color := "blue"
	var cost := 0
	var count := 0
	var queued := 0
	var progress := 0.0
	var state := "ok"  # ok | locked | gold | pop | full
	var reason := ""
	var key_hint := ""
	var trainer_icon: Texture2D
	var on_train: Callable  # (unit_id, count)
	var on_blocked: Callable  # (unit_id, reason)
	var held := false
	var _touch := -1
	var _down_t := 0.0
	var _fired_long := false
	var _flash := 0.0
	const LONG_PRESS := 0.42

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func hit(p: Vector2) -> bool:
		return Rect2(global_position, size).has_point(p)

	func touch_down(idx: int, _p: Vector2) -> void:
		_touch = idx
		held = true
		_down_t = 0.0
		_fired_long = false
		queue_redraw()

	func touch_move(_idx: int, _p: Vector2) -> void:
		pass

	func touch_up(idx: int, p: Vector2) -> void:
		if idx != _touch:
			return
		_touch = -1
		held = false
		if not _fired_long and Rect2(global_position, size).grow(14).has_point(p):
			_fire(1)
		queue_redraw()

	func _fire(n: int) -> void:
		_flash = 1.0
		if state in ["locked", "pop", "gold"] or state == "full":
			if on_blocked.is_valid():
				on_blocked.call(unit_id, reason)
			return
		if on_train.is_valid():
			on_train.call(unit_id, n)

	func _process(delta: float) -> void:
		if held:
			_down_t += delta
			if not _fired_long and _down_t >= LONG_PRESS:
				_fired_long = true
				_fire(5)
			queue_redraw()
		if _flash > 0.0:
			_flash = maxf(0.0, _flash - delta * 4.0)
			queue_redraw()

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		var locked := state == "locked"
		var blocked := state != "ok"
		var tile := "Button_Disable_9Slides.png" if locked else ("Button_Blue_9Slides_Pressed.png" if held else "Button_Blue_9Slides.png")
		var sbx := UiArt.sb_tile(UiArt.CC0 + "Buttons/" + tile, 26)
		sbx.draw(get_canvas_item(), r.grow_individual(0, 0, 0, 0))
		if _flash > 0.0:
			draw_rect(r.grow(-6), Color(1, 1, 1, 0.35 * _flash))
		var off := Vector2(0, 3 if held else 0)
		# unit icon
		var t := UiArt.unit_icon(unit_id, color)
		if t:
			var box := minf(size.x - 18.0, size.y - 40.0)
			var sz := UiArt.unit_icon_size(unit_id, box)
			var pos := Vector2(size.x / 2.0 - sz.x / 2.0, 10.0 + (box - sz.y) + (box * 0.0)) + off
			draw_texture_rect(t, Rect2(pos, sz), false, Color(0.55, 0.55, 0.6, 0.8) if locked else Color.WHITE)
		# cost line
		var cc := UiArt.coin()
		var cost_col := UiArt.GOLD if state not in ["gold"] else UiArt.BAD
		if locked:
			cost_col = Color(0.75, 0.7, 0.6)
		var cy := size.y - 17.0 + off.y
		UiArt.dtext(self, str(cost), Vector2(size.x / 2.0 - 2.0, cy + 6.0), 17, cost_col, HORIZONTAL_ALIGNMENT_LEFT, -1, 3)
		var tw := UiArt.font().get_string_size(str(cost), HORIZONTAL_ALIGNMENT_LEFT, -1, 17).x
		var cx := size.x / 2.0 - 2.0 - 8.0 - tw / 2.0 + 1.0
		draw_texture_rect(cc, Rect2(Vector2(cx - 9.0 + 0.0, cy - 9.0) - Vector2(tw / 2.0 - tw / 2.0, 0), Vector2(18, 18)), false, Color.WHITE if not locked else Color(0.7, 0.7, 0.7))
		# lock + needed building
		if locked:
			if trainer_icon:
				var ts := Vector2(30, 30) * 1.0
				draw_texture_rect(trainer_icon, Rect2(Vector2(size.x - ts.x - 5, 5), ts), false, Color(1, 1, 1, 0.9))
			UiArt.dtext(self, "LOCKED", Vector2(0, size.y * 0.55), 14, Color("ffd9a0"), HORIZONTAL_ALIGNMENT_CENTER, size.x, 3)
		# owned count badge (top left)
		if count > 0:
			var bc := Vector2(15, 15)
			draw_circle(bc, 13, Color(0.08, 0.05, 0.03, 0.9))
			draw_arc(bc, 13, 0, TAU, 20, UiArt.CREAM, 2.0, true)
			UiArt.dtext_c(self, str(count), bc, 15, Color.WHITE, 0)
		# queue badge + progress
		if queued > 0:
			var qc := Vector2(size.x - 15, 15)
			draw_circle(qc, 14, Color(0.9, 0.62, 0.15, 0.97))
			draw_arc(qc, 14, 0, TAU, 20, Color(0.2, 0.1, 0.02), 2.0, true)
			UiArt.dtext_c(self, "+%d" % queued, qc, 15, Color("2a1704"), 0)
			var bw := size.x - 20.0
			draw_rect(Rect2(10, size.y - 8, bw, 6), Color(0, 0, 0, 0.6))
			draw_rect(Rect2(10, size.y - 8, bw * progress, 6), UiArt.GOLD)
		if key_hint != "":
			UiArt.dtext(self, key_hint, Vector2(5, size.y - 22), 12, Color(1, 1, 1, 0.55), HORIZONTAL_ALIGNMENT_LEFT, -1, 2)
		# long press ring
		if held and not _fired_long and _down_t > 0.08:
			var c := size / 2.0
			draw_arc(c, minf(size.x, size.y) * 0.46, -PI / 2, -PI / 2 + TAU * clampf(_down_t / LONG_PRESS, 0.0, 1.0), 32, Color(1, 0.95, 0.5, 0.95), 5.0, true)
			UiArt.dtext_c(self, "x5", c + Vector2(0, -4), 26, Color("fff2b0"), 5)
		if blocked and not locked and state == "full":
			pass


# ------------------------------------------------------------------ stance toggle / generic pill button
class PillButton extends Control:
	var label := ""
	var icon: Texture2D
	var on := false
	var pulse := false  # waiting for a battlefield tap (rally point)
	var red := false
	var disabled := false
	var key_hint := ""
	var held := false
	var on_tap: Callable
	var _touch := -1
	var _t := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR

	func hit(p: Vector2) -> bool:
		return Rect2(global_position, size).has_point(p)

	func touch_down(idx: int, _p: Vector2) -> void:
		_touch = idx
		held = true
		queue_redraw()

	func touch_move(_idx: int, _p: Vector2) -> void:
		pass

	func touch_up(idx: int, p: Vector2) -> void:
		if idx != _touch:
			return
		_touch = -1
		held = false
		if Rect2(global_position, size).grow(16).has_point(p) and on_tap.is_valid():
			on_tap.call(self)
		queue_redraw()

	func _process(delta: float) -> void:
		_t += delta
		if pulse:
			queue_redraw()

	func _draw() -> void:
		var tile := "Button_Hover_9Slides.png" if on else ("Button_Disable_9Slides.png" if disabled else ("Button_Blue_9Slides_Pressed.png" if held else ("Button_Red_9Slides.png" if red else "Button_Blue_9Slides.png")))
		var sbx := UiArt.sb_tile(UiArt.CC0 + "Buttons/" + tile, 26)
		sbx.draw(get_canvas_item(), Rect2(Vector2.ZERO, size))
		var off := Vector2(0, 2 if held else 0)
		var ic_sz := 30.0
		var tw := UiArt.font().get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 19).x if label != "" else 0.0
		var total := (ic_sz if icon else 0.0) + (6.0 if icon and label != "" else 0.0) + tw
		var x := (size.x - total) / 2.0
		var cy := (size.y - 8.0) / 2.0 + off.y
		if icon:
			draw_texture_rect(icon, Rect2(Vector2(x, cy - ic_sz / 2.0), Vector2(ic_sz, ic_sz)), false, Color(1, 0.96, 0.8) if on else Color(0.92, 0.95, 1.0))
			x += ic_sz + 6.0
		if label != "":
			UiArt.dtext(self, label, Vector2(x, cy + 7.0), 19, Color("fff7d6") if on else Color.WHITE, HORIZONTAL_ALIGNMENT_LEFT, -1, 4)
		if key_hint != "":
			UiArt.dtext(self, key_hint, Vector2(size.x - 18, 15), 12, Color(1, 1, 1, 0.5), HORIZONTAL_ALIGNMENT_LEFT, -1, 2)
		if pulse:
			var a := 0.5 + 0.5 * sin(_t * 8.0)
			draw_rect(Rect2(Vector2.ZERO, size).grow(-3), Color(1, 0.9, 0.3, 0.25 * a), false, 3.0)


# ------------------------------------------------------------------ keep health bar (Tiny Swords BigBar frame)
class KeepBar extends Control:
	var frac := 1.0
	var shown := 1.0
	var col := Color("3d8bfd")
	var label := ""
	var value_text := ""
	var align_right := false
	var low_flash := 0.0
	var _t := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(300, 56)

	func set_value(f: float, txt: String) -> void:
		if absf(f - frac) > 0.0001 or txt != value_text:
			frac = f
			value_text = txt
			queue_redraw()

	func _process(delta: float) -> void:
		_t += delta
		if absf(shown - frac) > 0.002:
			shown = lerpf(shown, frac, 1.0 - exp(-delta * 8.0))
			queue_redraw()
		elif frac < 0.3:
			queue_redraw()

	func _draw() -> void:
		var d := UiArt.bar_base_big()
		var s := UiArt.sb(d)
		var h := minf(size.y, 56.0)
		var r := Rect2(0, size.y - h, size.x, h)
		s.draw(get_canvas_item(), r)
		# fill inside the frame
		var inner := Rect2(r.position.x + d.l - 6, r.position.y + 14, r.size.x - d.l - d.r + 12, r.size.y - 26)
		var w := inner.size.x * clampf(shown, 0.0, 1.0)
		var fc := col
		if frac < 0.3:
			fc = col.lerp(Color.WHITE, 0.25 + 0.2 * sin(_t * 8.0))
		if align_right:
			var fr := Rect2(inner.end.x - w, inner.position.y, w, inner.size.y)
			draw_rect(fr, fc)
			draw_rect(Rect2(fr.position, Vector2(fr.size.x, fr.size.y * 0.4)), Color(1, 1, 1, 0.22))
		else:
			var fr2 := Rect2(inner.position, Vector2(w, inner.size.y))
			draw_rect(fr2, fc)
			draw_rect(Rect2(fr2.position, Vector2(fr2.size.x, fr2.size.y * 0.4)), Color(1, 1, 1, 0.22))
		UiArt.dtext(self, value_text, Vector2(0, inner.position.y + inner.size.y * 0.5 + 7), 17, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, size.x, 4)
		if label != "":
			UiArt.dtext(self, label, Vector2(10 if not align_right else 0, r.position.y - 4), 19, Color("fff1cf"), HORIZONTAL_ALIGNMENT_LEFT if not align_right else HORIZONTAL_ALIGNMENT_RIGHT, size.x - (10 if align_right else 0), 5)


# ------------------------------------------------------------------ slim resource bar (hero hp / mana / xp)
class SlimBar extends Control:
	var frac := 1.0
	var shield := 0.0
	var col := Color("e5484d")
	var text_value := ""
	var shown := 1.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(180, 20)

	func set_value(f: float, txt: String, sh := 0.0) -> void:
		if absf(f - frac) > 0.0005 or txt != text_value or absf(sh - shield) > 0.0005:
			frac = f
			shield = sh
			text_value = txt
			queue_redraw()

	func _process(delta: float) -> void:
		if absf(shown - frac) > 0.003:
			shown = lerpf(shown, frac, 1.0 - exp(-delta * 10.0))
			queue_redraw()

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		draw_rect(r, UiArt.OUTLINE)
		var inner := r.grow(-2)
		draw_rect(inner, Color(0.14, 0.1, 0.07))
		draw_rect(Rect2(inner.position, Vector2(inner.size.x * clampf(shown, 0.0, 1.0), inner.size.y)), col)
		draw_rect(Rect2(inner.position, Vector2(inner.size.x * clampf(shown, 0.0, 1.0), inner.size.y * 0.4)), Color(1, 1, 1, 0.2))
		if shield > 0.0:
			draw_rect(Rect2(inner.position.x + inner.size.x * clampf(shown, 0.0, 1.0), inner.position.y, inner.size.x * minf(shield, 1.0 - shown), inner.size.y), Color(0.95, 0.95, 1.0, 0.9))
		if text_value != "":
			UiArt.dtext(self, text_value, Vector2(0, size.y * 0.5 + 5.5), 14, Color.WHITE, HORIZONTAL_ALIGNMENT_CENTER, size.x, 3)


# ------------------------------------------------------------------ lane minimap
class Minimap extends Control:
	const MIN_X := -96.0
	const MAX_X := 96.0
	var units: Array = []  # {x, z, team, kind, color, mine, miner}
	var banners: Array = []  # [key, owner, progress, capturing]
	var castles: Array = []  # {x, z, team, hp}
	var cam_x0 := 0.0
	var cam_x1 := 0.0
	var locked := true
	var rally_x := 0.0
	var rally_col := Color.WHITE
	var picking := false
	var on_seek: Callable  # (world_x)
	var on_lock: Callable
	var on_pick: Callable  # (world_x) while picking a rally point
	var _touch := -1
	var _last_tap := -10.0
	var _t := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(560, 64)

	func hit(p: Vector2) -> bool:
		return Rect2(global_position, size).has_point(p)

	func _x(wx: float) -> float:
		return 8.0 + (wx - MIN_X) / (MAX_X - MIN_X) * (size.x - 16.0)

	func _wx(px: float) -> float:
		return MIN_X + (px - 8.0) / (size.x - 16.0) * (MAX_X - MIN_X)

	func _y(wz: float) -> float:
		return 8.0 + (wz + 24.0) / 40.0 * (size.y - 16.0)

	func touch_down(idx: int, p: Vector2) -> void:
		_touch = idx
		var lx := p.x - global_position.x
		if picking and on_pick.is_valid():
			on_pick.call(_wx(lx))
			return
		var now := Time.get_ticks_msec() / 1000.0
		if now - _last_tap < 0.38 and on_lock.is_valid():
			on_lock.call()
		elif on_seek.is_valid():
			on_seek.call(_wx(lx))
		_last_tap = now

	func touch_move(idx: int, p: Vector2) -> void:
		if idx == _touch and not picking and on_seek.is_valid():
			on_seek.call(_wx(p.x - global_position.x))

	func touch_up(idx: int, _p: Vector2) -> void:
		if idx == _touch:
			_touch = -1

	func _process(delta: float) -> void:
		_t += delta
		if picking:
			queue_redraw()

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		draw_rect(r, UiArt.OUTLINE)
		var inner := r.grow(-3)
		draw_rect(inner, Color("42693b"))
		# lane
		var ly0 := _y(-8.0)
		var ly1 := _y(9.0)
		draw_rect(Rect2(inner.position.x, ly0, inner.size.x, ly1 - ly0), Color("c7a56a"))
		# team halves
		var mx := _x(0.0)
		draw_rect(Rect2(inner.position.x, inner.position.y, mx - inner.position.x, inner.size.y), Color(0.24, 0.55, 1.0, 0.13))
		draw_rect(Rect2(mx, inner.position.y, inner.end.x - mx, inner.size.y), Color(0.9, 0.28, 0.3, 0.13))
		draw_line(Vector2(mx, inner.position.y), Vector2(mx, inner.end.y), Color(1, 1, 1, 0.2), 1.0)
		draw_rect(r, Color("f1dba5"), false, 3.0)
		# outposts
		for b in banners:
			var spot := {"west": -34.0, "heart": 0.0, "east": 34.0}.get(b[0], 0.0) as float
			var bx := _x(spot)
			var col := Color("9aa0ad")
			var owner := int(b[1])
			if owner >= 0:
				col = UiArt.PLAYER_COL["blue" if owner == 0 else "red"]
			draw_rect(Rect2(bx - 1, ly0 - 4, 3, 30), Color("1d1410"))
			draw_rect(Rect2(bx + 2, ly0 - 4, 13, 11), Color("1d1410"))
			draw_rect(Rect2(bx + 2, ly0 - 3, 11, 9), col)
			if int(b[3]) >= 0 and float(b[2]) > 0.0:
				var cc: Color = UiArt.PLAYER_COL["blue" if int(b[3]) == 0 else "red"]
				draw_rect(Rect2(bx + 2, ly0 - 3 + 9.0 * (1.0 - float(b[2])), 11, 9.0 * float(b[2])), cc)
		# castles
		for c in castles:
			var cp := Vector2(_x(c.x), _y(c.z))
			var cc2: Color = UiArt.PLAYER_COL["blue" if c.team == 0 else "red"]
			draw_rect(Rect2(cp - Vector2(9, 9), Vector2(18, 18)), UiArt.OUTLINE)
			draw_rect(Rect2(cp - Vector2(7, 7), Vector2(14, 14)), cc2)
			draw_rect(Rect2(cp - Vector2(7, 7), Vector2(14, 5)), Color(1, 1, 1, 0.3))
		# units
		var mine_pos := Vector2(-1000, 0)
		for u in units:
			var up := Vector2(_x(u.x), _y(u.z))
			if u.kind == "hero":
				if u.mine:
					mine_pos = up
					continue
				draw_circle(up, 6.0, UiArt.OUTLINE)
				draw_circle(up, 4.5, u.color)
			else:
				var s := 2.5 if u.miner else 3.5
				draw_rect(Rect2(up - Vector2(s, s) / 2.0, Vector2(s, s)), u.color)
		if mine_pos.x > -999:
			draw_circle(mine_pos, 8.0, Color(1, 1, 1, 0.9))
			draw_circle(mine_pos, 6.0, UiArt.OUTLINE)
			draw_circle(mine_pos, 4.5, Color("7cff8a"))
		# rally
		if rally_x != 0.0:
			var rx := _x(rally_x)
			draw_line(Vector2(rx, 4), Vector2(rx, size.y - 4), rally_col, 2.0)
			draw_rect(Rect2(rx, 4, 10, 8), rally_col)
		# camera window
		var x0 := clampf(_x(cam_x0), 3.0, size.x - 3.0)
		var x1 := clampf(_x(cam_x1), 3.0, size.x - 3.0)
		draw_rect(Rect2(x0, 3, maxf(6.0, x1 - x0), size.y - 6), Color(1, 1, 1, 0.95 if locked else 1.0), false, 2.0)
		if not locked:
			draw_rect(Rect2(x0, 3, maxf(6.0, x1 - x0), size.y - 6), Color(1, 0.9, 0.4, 0.12))
		if picking:
			var a := 0.55 + 0.45 * sin(_t * 8.0)
			draw_rect(r.grow(-1), Color(1, 0.9, 0.3, a), false, 3.0)
			UiArt.dtext_c(self, "Tap to place rally point", Vector2(size.x / 2.0, size.y / 2.0), 20, Color("fff2b0"), 5)


# ------------------------------------------------------------------ player chip (name, stance, level)
class Chip extends Control:
	var pname := ""
	var color := "blue"
	var stance := "defend"
	var lvl := 0
	var pop := 0
	var dead := false
	var mine := false
	var bot := false
	var align_right := false

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(150, 30)
		texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR

	func set_info(d: Dictionary) -> void:
		var key := str(d)
		if key == str(get_meta("k", "")):
			return
		set_meta("k", key)
		pname = d.name
		color = d.color
		stance = d.stance
		lvl = d.lvl
		pop = d.pop
		dead = d.dead
		mine = d.mine
		bot = d.bot
		queue_redraw()

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		var col: Color = UiArt.PLAYER_COL.get(color, Color.WHITE)
		draw_rect(r, Color(0.07, 0.05, 0.03, 0.72))
		draw_rect(Rect2(0, 0, 5, size.y), col)
		if mine:
			draw_rect(r, Color(1, 0.93, 0.6, 0.9), false, 2.0)
		var x := 12.0
		var icon := UiArt.stance_icon("garrison" if dead else stance)
		if dead:
			UiArt.dtext(self, "X", Vector2(x, 21), 18, UiArt.BAD, HORIZONTAL_ALIGNMENT_LEFT, -1, 3)
		elif icon:
			draw_texture_rect(icon, Rect2(x, 4, 22, 22), false, col.lightened(0.5))
		x += 28.0
		var nm := pname if pname.length() <= 9 else pname.substr(0, 8) + "."
		UiArt.dtext(self, nm, Vector2(x, 21), 16, Color(1, 1, 1, 0.55 if dead else 1.0), HORIZONTAL_ALIGNMENT_LEFT, -1, 3)
		if lvl > 0:
			UiArt.dtext(self, str(lvl), Vector2(size.x - 24, 21), 15, UiArt.GOLD, HORIZONTAL_ALIGNMENT_RIGHT, 20, 3)


# ------------------------------------------------------------------ top-centre timer + outpost pips
class TimerPlate extends Control:
	var time_text := "0:00"
	var banners: Array = []  # [key, owner, progress, capturing]
	var _t := 0.0

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		custom_minimum_size = Vector2(300, 58)

	func set_state(t: String, b: Array) -> void:
		if t != time_text or str(b) != str(banners):
			time_text = t
			banners = b
			queue_redraw()

	func _draw() -> void:
		var d := UiArt.ribbon(4)
		var s := UiArt.sb(d)
		s.draw(get_canvas_item(), Rect2(Vector2.ZERO, size))
		UiArt.dtext(self, time_text, Vector2(0, size.y * 0.5 + 11), 32, Color("fff1cf"), HORIZONTAL_ALIGNMENT_CENTER, size.x * 0.56 + 6, 5)
		var names := ["west", "heart", "east"]
		for i in range(banners.size()):
			var b: Array = banners[i]
			var c := Vector2(size.x * 0.64 + 44.0 + i * 0.0, size.y / 2.0 - 2.0)
			c.x = size.x * 0.62 + i * 34.0 + 18.0
			var owner := int(b[1])
			var col := Color("9aa0ad") if owner < 0 else UiArt.PLAYER_COL["blue" if owner == 0 else "red"]
			draw_circle(c, 13.0, UiArt.OUTLINE)
			draw_circle(c, 10.5, col)
			if int(b[3]) >= 0 and float(b[2]) > 0.0:
				var cc: Color = UiArt.PLAYER_COL["blue" if int(b[3]) == 0 else "red"]
				UiArt.dpie(self, c, 10.0, float(b[2]), cc)
			draw_arc(c, 13.0, 0, TAU, 20, Color("f1dba5"), 2.0, true)
			if names[i] == "heart":
				draw_circle(c, 3.0, Color(1, 1, 1, 0.85))


# ------------------------------------------------------------------ world-space overlay (aim indicator + rally flag), child of the game node
class WorldOverlay extends Node2D:
	var aim_on := false
	var kind := "point"
	var hero := Vector2.ZERO  # px
	var range_px := 0.0
	var radius_px := 0.0
	var aim_pt := Vector2.ZERO  # px
	var dir := Vector2.RIGHT
	var has_target := false
	var col := Color("ffffff")
	var rally_on := false
	var rally_px := 0.0
	var rally_col := Color.WHITE
	var picking := false
	var _t := 0.0

	func _init() -> void:
		z_index = 12

	func _process(delta: float) -> void:
		_t += delta
		if aim_on or rally_on or picking:
			queue_redraw()

	func _draw() -> void:
		if rally_on:
			var x := rally_px
			for i in range(0, 17):
				var y0 := -8.0 * 32.0 + i * 34.0
				draw_line(Vector2(x, y0), Vector2(x, y0 + 16.0), Color(rally_col.r, rally_col.g, rally_col.b, 0.35), 3.0)
			var base := Vector2(x, 12.0)
			draw_line(base, base + Vector2(0, -78), Color("2b1d12"), 5.0)
			draw_line(base, base + Vector2(0, -78), Color("c9a36a"), 3.0)
			var wave := sin(_t * 4.0) * 3.0
			var pts := PackedVector2Array([base + Vector2(2, -78), base + Vector2(44, -70 + wave), base + Vector2(34, -58 - wave), base + Vector2(44, -46 + wave), base + Vector2(2, -40)])
			draw_colored_polygon(pts, rally_col)
			draw_polyline(pts, Color("2b1d12"), 2.0)
		if not aim_on:
			return
		var pulse := 0.65 + 0.35 * sin(_t * 9.0)
		var c := col
		# range ring
		if range_px > 0.0:
			draw_arc(hero, range_px, 0, TAU, 72, Color(1, 1, 1, 0.55), 3.0, true)
			draw_circle(hero, range_px, Color(1, 1, 1, 0.05))
		match kind:
			"direction":
				var len_px := maxf(range_px, 60.0)
				var half := maxf(radius_px, 26.0)
				var a := hero
				var b := hero + dir * len_px
				var perp := Vector2(-dir.y, dir.x)
				var poly := PackedVector2Array([a + perp * half, b + perp * half, b - perp * half, a - perp * half])
				draw_colored_polygon(poly, Color(c.r, c.g, c.b, 0.22))
				draw_polyline(PackedVector2Array([a + perp * half, b + perp * half, b - perp * half, a - perp * half, a + perp * half]), Color(c.r, c.g, c.b, 0.8), 2.5)
				var tip := b + dir * 26.0
				draw_colored_polygon(PackedVector2Array([tip, b + perp * 24.0, b - perp * 24.0]), Color(c.r, c.g, c.b, 0.9 * pulse))
			"point":
				draw_line(hero, aim_pt, Color(c.r, c.g, c.b, 0.6), 3.0)
				var rr := maxf(radius_px, 22.0)
				draw_circle(aim_pt, rr, Color(c.r, c.g, c.b, 0.25))
				draw_arc(aim_pt, rr, 0, TAU, 48, Color(c.r, c.g, c.b, 0.95), 3.5, true)
				draw_arc(aim_pt, rr * 0.45 * pulse + 4.0, 0, TAU, 24, Color(1, 1, 1, 0.8), 2.0, true)
			"enemy", "ally", "unit":
				draw_line(hero, aim_pt, Color(c.r, c.g, c.b, 0.55), 3.0)
				if has_target:
					draw_arc(aim_pt, 34.0 + 3.0 * pulse, 0, TAU, 32, Color(c.r, c.g, c.b, 1.0), 4.0, true)
					draw_arc(aim_pt, 24.0, 0, TAU, 32, Color(1, 1, 1, 0.7), 2.0, true)
				else:
					draw_arc(aim_pt, 22.0, 0, TAU, 24, Color(1, 1, 1, 0.5), 2.0, true)
			"self":
				draw_arc(hero, 40.0 + 6.0 * pulse, 0, TAU, 32, Color(c.r, c.g, c.b, 0.9), 4.0, true)
