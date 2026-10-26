class_name EndScreen
extends Control
## Victory / defeat overlay with the scoreboard.

signal leave_pressed
signal again_pressed

var _again_slot: HBoxContainer
var _is_host := false


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)


func show_result(snap: Dictionary, init: Dictionary, my_team: int, host: bool) -> void:
	for c in get_children():
		c.queue_free()
	var won: bool = int(snap.winner) == my_team
	var dim := ColorRect.new()
	dim.color = Color(0.03, 0.02, 0.05, 0.72)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(dim)
	var center := CenterContainer.new()
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", -26)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	center.add_child(col)
	# ribbon title
	var rib := PanelContainer.new()
	rib.add_theme_stylebox_override("panel", UiArt.sb(UiArt.ribbon(0 if won else 1), Vector4(60, 18, 60, 30)))
	rib.custom_minimum_size = Vector2(520, 110)
	rib.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var tl := UiArt.label("VICTORY" if won else "DEFEAT", 64, Color("fff1cf") if won else Color("ffd6c9"), 10, HORIZONTAL_ALIGNMENT_CENTER)
	rib.add_child(tl)
	col.add_child(rib)
	rib.z_index = 2
	var panel := PanelContainer.new()
	panel.theme_type_variation = ""
	col.add_child(panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	panel.add_child(v)
	var win_team := int(snap.winner)
	var tname: String = "Dawnguard" if win_team == 0 else "Duskborn"
	var mins := int(float(snap.get("time", 0)) / 60.0)
	var secs := int(float(snap.get("time", 0))) % 60
	var sub := UiArt.label("The %s destroyed the enemy keep after %d:%02d." % [tname, mins, secs], 24, UiArt.INK, 0, HORIZONTAL_ALIGNMENT_CENTER)
	sub.custom_minimum_size = Vector2(760, 0)
	v.add_child(UiArt.label("", 14, UiArt.INK, 0))
	v.add_child(sub)
	var teams := HBoxContainer.new()
	teams.add_theme_constant_override("separation", 24)
	v.add_child(teams)
	var fl: Dictionary = snap.get("fl", {})
	for t in [0, 1]:
		var tv := VBoxContainer.new()
		tv.add_theme_constant_override("separation", 6)
		tv.custom_minimum_size = Vector2(370, 0)
		teams.add_child(tv)
		var tcol: Color = UiArt.PLAYER_COL["blue" if t == 0 else "red"]
		var th := UiArt.label("Dawnguard" if t == 0 else "Duskborn", 28, tcol.lightened(0.1), 0)
		th.add_theme_color_override("font_color", tcol.darkened(0.15))
		tv.add_child(th)
		for b in snap.get("board", []):
			if int(b.team) != t:
				continue
			var p: Dictionary = {}
			for pl in fl.get("players", []):
				if pl.pid == b.pid:
					p = pl
			var pc: String = p.get("color", "blue" if t == 0 else "red")
			var row := PanelContainer.new()
			row.theme_type_variation = "PanelPaper"
			var rh := HBoxContainer.new()
			rh.add_theme_constant_override("separation", 12)
			row.add_child(rh)
			rh.add_child(UiArt.tex_rect(UiArt.hero_portrait(b.hero, pc), Vector2(60, 60)))
			var nv := VBoxContainer.new()
			nv.add_theme_constant_override("separation", 0)
			nv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var nm := UiArt.label(str(b.name) + ("  (bot)" if b.bot else ""), 24, UiArt.PLAYER_COL.get(pc, Color.WHITE).darkened(0.25), 0)
			nv.add_child(nm)
			var hd := HeroesData.by_id(b.hero)
			nv.add_child(UiArt.label("%s  -  level %d" % [hd.get("name", b.hero), int(b.lvl)], 18, UiArt.INK_SOFT, 0))
			rh.add_child(nv)
			var st := UiArt.label("%d / %d / %d" % [int(b.k), int(b.d), int(b.a)], 26, UiArt.INK, 0, HORIZONTAL_ALIGNMENT_RIGHT)
			st.tooltip_text = "Kills / deaths / assists"
			rh.add_child(st)
			tv.add_child(row)
	var hint := UiArt.label("kills / deaths / assists", 16, UiArt.INK_SOFT, 0, HORIZONTAL_ALIGNMENT_CENTER)
	v.add_child(hint)
	var btns := HBoxContainer.new()
	btns.alignment = BoxContainer.ALIGNMENT_CENTER
	btns.add_theme_constant_override("separation", 20)
	v.add_child(btns)
	var leave := Button.new()
	leave.text = "Back to menu"
	leave.theme_type_variation = "ButtonRed"
	leave.custom_minimum_size = Vector2(260, 72)
	leave.pressed.connect(func(): leave_pressed.emit())
	btns.add_child(leave)
	_again_slot = btns
	set_host(host)


func set_host(host: bool) -> void:
	_is_host = host
	if _again_slot == null:
		return
	for c in _again_slot.get_children():
		if c.name == "again":
			c.queue_free()
	if host:
		var b := Button.new()
		b.name = "again"
		b.text = "Play again"
		b.custom_minimum_size = Vector2(260, 72)
		b.pressed.connect(func(): again_pressed.emit())
		_again_slot.add_child(b)
	else:
		var l := UiArt.label("Waiting for the host...", 22, UiArt.INK_SOFT, 0)
		l.name = "again"
		_again_slot.add_child(l)
