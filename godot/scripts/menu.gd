extends Control
## Main menu, join dialog, lobby, hero gallery and settings. Talks to the server through the Net autoload.
## main.gd shows/hides it and reacts to Net.game_init (the match starting).

signal request_hide  # a match is starting

const TEAM_NAMES := ["DAWNGUARD", "DUSKBORN"]
const TEAM_COLORS := [["blue", "purple"], ["red", "yellow"]]

var screens := {}
var screen := "main"
var room: Dictionary = {}
var _quick := false
var _toast_lbl: Label
var _status_lbl: Label
var _status_dot: ColorRect
var _name_edit: LineEdit
var _hero_btn: Button
var _quick_btn: Button
var _net_buttons: Array = []
var _join_edit: LineEdit
var _join_err: Label
var _lobby_code: Label
var _lobby_teams: HBoxContainer
var _lobby_opts: VBoxContainer
var _lobby_start: Button
var _lobby_browser: HeroBrowser
var _gallery: HeroBrowser
var _busy_panel: Control
var _busy_lbl: Label
var _url_edit: LineEdit
var selected_hero := "aldric"
var _auto_hero_sent := false


func _ready() -> void:
	theme = UiArt.make_theme()
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_PASS
	selected_hero = str(Prefs.get_value("hero", "aldric"))
	if HeroesData.by_id(selected_hero).is_empty():
		selected_hero = "aldric"
	_add_vignette()
	_build_main()
	_build_join()
	_build_heroes()
	_build_settings()
	_build_lobby()
	_build_overlay()
	show_screen("main")
	Net.connected.connect(func(_p): _update_status())
	Net.disconnected.connect(_update_status)
	Net.room.connect(on_room)
	Net.error.connect(on_error)
	_update_status()
	var t := Timer.new()
	t.wait_time = 0.5
	t.autostart = true
	t.timeout.connect(_update_status)
	add_child(t)


func _add_vignette() -> void:
	var g := Gradient.new()
	g.set_color(0, Color(0, 0, 0, 0.0))
	g.set_color(1, Color(0.02, 0.01, 0.05, 0.78))
	g.set_offset(0, 0.45)
	g.set_offset(1, 1.0)
	var gt := GradientTexture2D.new()
	gt.gradient = g
	gt.fill = GradientTexture2D.FILL_RADIAL
	gt.fill_from = Vector2(0.5, 0.5)
	gt.fill_to = Vector2(1.0, 0.5)
	gt.width = 512
	gt.height = 288
	var tr := TextureRect.new()
	tr.texture = gt
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_SCALE
	tr.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	tr.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(tr)


func _screen(name: String) -> Control:
	var c := Control.new()
	c.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	c.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(c)
	screens[name] = c
	return c


func show_screen(name: String) -> void:
	screen = name
	for k in screens:
		screens[k].visible = k == name
	if name == "main":
		_refresh_main()


func _btn(text: String, min_size: Vector2, cb: Callable, variation := "") -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = min_size
	if variation != "":
		b.theme_type_variation = variation
	b.pressed.connect(cb)
	return b


# ------------------------------------------------------------------ main screen
func _build_main() -> void:
	var s := _screen("main")
	# logo ribbon
	var rib := PanelContainer.new()
	rib.add_theme_stylebox_override("panel", UiArt.sb(UiArt.ribbon(1), Vector4(110, 22, 110, 34)))
	s.add_child(rib)
	rib.set_anchors_preset(Control.PRESET_CENTER_TOP)
	rib.offset_top = 26
	rib.grow_horizontal = Control.GROW_DIRECTION_BOTH
	var logo := UiArt.label("BANNERFALL", 96, UiArt.GOLD, 16, HORIZONTAL_ALIGNMENT_CENTER)
	logo.add_theme_color_override("font_outline_color", Color("2a0d0b"))
	logo.add_theme_constant_override("shadow_offset_y", 6)
	logo.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.45))
	rib.add_child(logo)
	var tag := UiArt.label("Lane battles with friends", 26, UiArt.CREAM, 6, HORIZONTAL_ALIGNMENT_CENTER)
	s.add_child(tag)
	tag.set_anchors_preset(Control.PRESET_CENTER_TOP)
	tag.offset_top = 188
	tag.offset_left = -300
	tag.offset_right = 300
	# column
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	s.add_child(col)
	col.set_anchors_preset(Control.PRESET_CENTER)
	col.custom_minimum_size = Vector2(500, 0)
	col.grow_horizontal = Control.GROW_DIRECTION_BOTH
	col.grow_vertical = Control.GROW_DIRECTION_BOTH
	col.offset_top = 10
	var nr := HBoxContainer.new()
	nr.add_theme_constant_override("separation", 12)
	col.add_child(nr)
	nr.add_child(UiArt.label("Name", 26, UiArt.CREAM, 5))
	_name_edit = LineEdit.new()
	_name_edit.text = Net.player_name
	_name_edit.max_length = 16
	_name_edit.custom_minimum_size = Vector2(380, 56)
	_name_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name_edit.placeholder_text = "Your name"
	_name_edit.text_submitted.connect(func(_t): _commit_name())
	_name_edit.focus_exited.connect(_commit_name)
	nr.add_child(_name_edit)
	_quick_btn = _btn("QUICK BATTLE", Vector2(500, 92), _quick_battle)
	_quick_btn.add_theme_font_size_override("font_size", 40)
	col.add_child(_quick_btn)
	var r1 := HBoxContainer.new()
	r1.add_theme_constant_override("separation", 12)
	col.add_child(r1)
	var b_create := _btn("Create Room", Vector2(244, 72), _create_room)
	var b_join := _btn("Join Room", Vector2(244, 72), func(): _join_err.text = ""; show_screen("join"); _join_edit.grab_focus())
	r1.add_child(b_create)
	r1.add_child(b_join)
	var r2 := HBoxContainer.new()
	r2.add_theme_constant_override("separation", 12)
	col.add_child(r2)
	r2.add_child(_btn("Heroes", Vector2(244, 72), func(): _open_gallery()))
	r2.add_child(_btn("Settings", Vector2(244, 72), func(): _url_edit.text = Net.url; show_screen("settings")))
	_net_buttons = [_quick_btn, b_create, b_join]
	# hero chip (bottom right)
	_hero_btn = Button.new()
	_hero_btn.theme_type_variation = "ButtonSmall"
	_hero_btn.custom_minimum_size = Vector2(300, 84)
	_hero_btn.expand_icon = true
	_hero_btn.icon_alignment = HORIZONTAL_ALIGNMENT_LEFT
	_hero_btn.add_theme_constant_override("icon_max_width", 60)
	_hero_btn.add_theme_font_size_override("font_size", 22)
	_hero_btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_hero_btn.pressed.connect(_open_gallery)
	s.add_child(_hero_btn)
	_hero_btn.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_hero_btn.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_hero_btn.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_hero_btn.offset_right = -18
	_hero_btn.offset_bottom = -14
	_hero_btn.offset_left = -318
	_hero_btn.offset_top = -98
	# status (bottom left)
	var sr := HBoxContainer.new()
	sr.add_theme_constant_override("separation", 8)
	s.add_child(sr)
	sr.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	sr.grow_vertical = Control.GROW_DIRECTION_BEGIN
	sr.offset_left = 20
	sr.offset_bottom = -20
	sr.offset_top = -56
	sr.alignment = BoxContainer.ALIGNMENT_BEGIN
	_status_dot = ColorRect.new()
	_status_dot.custom_minimum_size = Vector2(16, 16)
	_status_dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	sr.add_child(_status_dot)
	_status_lbl = UiArt.label("", 20, UiArt.CREAM, 4)
	sr.add_child(_status_lbl)


func _refresh_main() -> void:
	var hd := HeroesData.by_id(selected_hero)
	_hero_btn.text = "  %s\n  %s" % [hd.get("name", ""), hd.get("role", "")]
	_hero_btn.icon = UiArt.gallery_portrait(selected_hero)
	_name_edit.text = Net.player_name


func _commit_name() -> void:
	var n := _name_edit.text.strip_edges()
	if n == "":
		n = "Hero"
	Net.player_name = n
	Net.save()


func _update_status() -> void:
	if _status_lbl == null:
		return
	var online := Net.is_open()
	_status_dot.color = Color("7be08a") if online else Color("ff7a6b")
	_status_lbl.text = ("Online  %s" % Net.url) if online else ("Connecting to %s ..." % Net.url)
	for b in _net_buttons:
		b.disabled = not online


func _open_gallery() -> void:
	_gallery.set_state(selected_hero, {})
	show_screen("heroes")


func _quick_battle() -> void:
	_commit_name()
	_quick = true
	_auto_hero_sent = true
	_set_busy("Raising the banners...")
	Net.send({"t": "create", "name": Net.player_name})


func _create_room() -> void:
	_commit_name()
	_quick = false
	_auto_hero_sent = false
	Net.send({"t": "create", "name": Net.player_name})


func _set_busy(text: String) -> void:
	_busy_lbl.text = text
	_busy_panel.visible = text != ""


# ------------------------------------------------------------------ join screen
func _build_join() -> void:
	var s := _screen("join")
	var cc := CenterContainer.new()
	cc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	s.add_child(cc)
	var p := PanelContainer.new()
	p.custom_minimum_size = Vector2(560, 0)
	cc.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	p.add_child(v)
	v.add_child(UiArt.label("Join a room", 44, UiArt.INK, 0, HORIZONTAL_ALIGNMENT_CENTER))
	v.add_child(UiArt.label("Enter the 4-letter room code", 24, UiArt.INK_SOFT, 0, HORIZONTAL_ALIGNMENT_CENTER))
	_join_edit = LineEdit.new()
	_join_edit.max_length = 4
	_join_edit.alignment = HORIZONTAL_ALIGNMENT_CENTER
	_join_edit.add_theme_font_size_override("font_size", 64)
	_join_edit.custom_minimum_size = Vector2(320, 96)
	_join_edit.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_join_edit.placeholder_text = "ABCD"
	_join_edit.text_changed.connect(func(t): _join_edit.text = t.to_upper(); _join_edit.caret_column = t.length())
	_join_edit.text_submitted.connect(func(_t): _do_join())
	v.add_child(_join_edit)
	_join_err = UiArt.label("", 22, Color("b3261e"), 0, HORIZONTAL_ALIGNMENT_CENTER)
	_join_err.custom_minimum_size = Vector2(0, 28)
	v.add_child(_join_err)
	var h := HBoxContainer.new()
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	h.add_theme_constant_override("separation", 16)
	v.add_child(h)
	h.add_child(_btn("Back", Vector2(200, 68), func(): show_screen("main"), "ButtonRed"))
	h.add_child(_btn("Join", Vector2(240, 68), _do_join))


func _do_join() -> void:
	var code := _join_edit.text.strip_edges().to_upper()
	if code.length() < 4:
		_join_err.text = "The code has 4 letters"
		return
	_commit_name()
	_quick = false
	_auto_hero_sent = false
	_join_err.text = ""
	Net.send({"t": "join", "code": code, "name": Net.player_name})


# ------------------------------------------------------------------ heroes gallery
func _build_heroes() -> void:
	var s := _screen("heroes")
	var m := MarginContainer.new()
	m.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		m.add_theme_constant_override("margin_" + side, 16)
	s.add_child(m)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	m.add_child(v)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 16)
	v.add_child(top)
	top.add_child(_btn("Back", Vector2(170, 64), func(): show_screen("main"), "ButtonRed"))
	var rib := PanelContainer.new()
	rib.add_theme_stylebox_override("panel", UiArt.sb(UiArt.ribbon(0), Vector4(70, 12, 70, 22)))
	rib.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(rib)
	rib.add_child(UiArt.label("THE HEROES OF BANNERFALL", 38, UiArt.CREAM, 7, HORIZONTAL_ALIGNMENT_CENTER))
	top.add_child(Control.new())
	top.get_child(2).custom_minimum_size = Vector2(170, 0)
	_gallery = HeroBrowser.new()
	_gallery.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_gallery.custom_minimum_size = Vector2(0, 500)
	_gallery.hero_picked.connect(func(id):
		selected_hero = id
		Prefs.set_value("hero", id)
		_gallery.set_state(id, {})
		toast("Your hero: %s" % HeroesData.by_id(id).name))
	v.add_child(_gallery)


# ------------------------------------------------------------------ settings
func _build_settings() -> void:
	var s := _screen("settings")
	var cc := CenterContainer.new()
	cc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	s.add_child(cc)
	var p := PanelContainer.new()
	p.custom_minimum_size = Vector2(760, 0)
	cc.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	p.add_child(v)
	v.add_child(UiArt.label("Settings", 44, UiArt.INK, 0, HORIZONTAL_ALIGNMENT_CENTER))
	v.add_child(UiArt.label("Server address", 22, UiArt.INK_SOFT, 0))
	var ur := HBoxContainer.new()
	v.add_child(ur)
	_url_edit = LineEdit.new()
	_url_edit.text = Net.url
	_url_edit.custom_minimum_size = Vector2(0, 56)
	_url_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_url_edit.add_theme_font_size_override("font_size", 24)
	ur.add_child(_url_edit)
	ur.add_child(_btn("Connect", Vector2(180, 60), _apply_url, "ButtonSmall"))
	for def in [["Music", "music"], ["Effects", "sfx"]]:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 16)
		v.add_child(row)
		var l := UiArt.label(def[0], 24, UiArt.INK, 0)
		l.custom_minimum_size = Vector2(130, 0)
		row.add_child(l)
		var sl := HSlider.new()
		sl.min_value = 0.0
		sl.max_value = 1.0
		sl.step = 0.05
		sl.value = float(Prefs.get_value(def[1], 0.8))
		sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sl.custom_minimum_size = Vector2(0, 40)
		var key: String = def[1]
		sl.value_changed.connect(func(val):
			Prefs.set_value(key, val)
			if key == "music":
				AudioServer.set_bus_volume_db(0, linear_to_db(maxf(0.001, val))))
		row.add_child(sl)
	var cr := UiArt.label("Art: Tiny Swords by Pixel Frog.  Font: Pixelify Sans (SIL OFL).\nIcons by Lorc and Delapouite, game-icons.net, CC BY 3.0.", 18, UiArt.INK_SOFT, 0)
	cr.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(cr)
	var h := HBoxContainer.new()
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_child(h)
	h.add_child(_btn("Back", Vector2(240, 68), func(): show_screen("main"), "ButtonRed"))


func _apply_url() -> void:
	var u := _url_edit.text.strip_edges()
	if not (u.begins_with("ws://") or u.begins_with("wss://")):
		toast("The address must start with ws:// or wss://")
		return
	Net.url = u
	Net.save()
	Net.close()
	Net.connect_to_server()
	toast("Connecting...")


# ------------------------------------------------------------------ lobby
func _build_lobby() -> void:
	var s := _screen("lobby")
	var m := MarginContainer.new()
	m.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		m.add_theme_constant_override("margin_" + side, 14)
	s.add_child(m)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	m.add_child(v)
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 14)
	v.add_child(top)
	top.add_child(_btn("Leave", Vector2(170, 70), _leave_room, "ButtonRed"))
	var sp1 := Control.new()
	sp1.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(sp1)
	var rib := PanelContainer.new()
	rib.add_theme_stylebox_override("panel", UiArt.sb(UiArt.ribbon(0), Vector4(80, 10, 80, 22)))
	top.add_child(rib)
	var rh := HBoxContainer.new()
	rh.add_theme_constant_override("separation", 14)
	rib.add_child(rh)
	rh.add_child(UiArt.label("ROOM", 28, Color("cfe6ff"), 5))
	_lobby_code = UiArt.label("----", 56, UiArt.GOLD, 9)
	rh.add_child(_lobby_code)
	rh.add_child(_btn("Share", Vector2(120, 56), _share_code, "ButtonSmall"))
	var sp2 := Control.new()
	sp2.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(sp2)
	_lobby_start = _btn("START", Vector2(240, 70), _lobby_action)
	_lobby_start.add_theme_font_size_override("font_size", 34)
	top.add_child(_lobby_start)
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 14)
	v.add_child(body)
	var left := VBoxContainer.new()
	left.custom_minimum_size = Vector2(420, 0)
	left.add_theme_constant_override("separation", 8)
	body.add_child(left)
	_lobby_teams = HBoxContainer.new()
	_lobby_teams.add_theme_constant_override("separation", 10)
	left.add_child(_lobby_teams)
	_lobby_opts = VBoxContainer.new()
	_lobby_opts.add_theme_constant_override("separation", 6)
	left.add_child(_lobby_opts)
	_lobby_browser = HeroBrowser.new()
	_lobby_browser.instant = true
	_lobby_browser.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_lobby_browser.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_lobby_browser.hero_picked.connect(func(id):
		Net.send({"t": "hero", "heroId": id})
		selected_hero = id
		Prefs.set_value("hero", id))
	body.add_child(_lobby_browser)


func _my_slot() -> Dictionary:
	for s in room.get("slots", []):
		if s.pid == Net.pid:
			return s
	return {}


func _is_host() -> bool:
	return room.get("host", "") == Net.pid


func _leave_room() -> void:
	Net.send({"t": "leave"})
	_quick = false


func _share_code() -> void:
	DisplayServer.clipboard_set("Join my Bannerfall match! Room code: %s" % room.get("code", ""))
	toast("Room code copied: %s" % room.get("code", ""))


func _lobby_action() -> void:
	if _is_host():
		Net.send({"t": "start"})
	else:
		var me := _my_slot()
		Net.send({"t": "ready", "ready": not bool(me.get("ready", false))})


func on_room(info: Dictionary) -> void:
	room = info
	if info.get("code", "") == "":
		_quick = false
		_set_busy("")
		if screen == "lobby":
			show_screen("main")
		return
	if info.get("started", false):
		_set_busy("")
		return
	if _quick:
		_quick_step(info)
		return
	_set_busy("")
	if screen != "lobby":
		show_screen("lobby")
	_refresh_lobby()


func _quick_step(info: Dictionary) -> void:
	if info.mode != "frontline":
		Net.send({"t": "mode", "mode": "frontline"})
		return
	if not info.fillBots or int(info.teamSize) != 2:
		Net.send({"t": "fillBots", "on": true, "teamSize": 2})
		return
	_quick = false
	Net.send({"t": "hero", "heroId": selected_hero})
	Net.send({"t": "start"})


func on_error(msg: String) -> void:
	if screen == "join":
		_join_err.text = msg
	_set_busy("")
	if _quick:
		_quick = false
	toast(msg)


func _team_cap() -> int:
	return 2


func _refresh_lobby() -> void:
	_lobby_code.text = room.get("code", "----")
	var me := _my_slot()
	# auto-pick my saved hero the first time
	if not _auto_hero_sent and not me.is_empty() and (me.get("heroId") == null or me.get("heroId") == ""):
		_auto_hero_sent = true
		var taken := false
		for s in room.slots:
			if s.team == me.team and s.heroId == selected_hero and s.pid != me.pid:
				taken = true
		if not taken:
			Net.send({"t": "hero", "heroId": selected_hero})
	# teams
	for c in _lobby_teams.get_children():
		c.queue_free()
	var per_team := {0: [], 1: []}
	for s in room.slots:
		per_team[int(s.team)].append(s)
	var fill: bool = room.get("fillBots", false)
	var size_n: int = int(room.get("teamSize", 2))
	for t in [0, 1]:
		var col := VBoxContainer.new()
		col.add_theme_constant_override("separation", 6)
		col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_lobby_teams.add_child(col)
		var hd := PanelContainer.new()
		hd.add_theme_stylebox_override("panel", UiArt.sb(UiArt.ribbon(0 if t == 0 else 1), Vector4(52, 6, 52, 18)))
		col.add_child(hd)
		hd.add_child(UiArt.label(TEAM_NAMES[t], 24, UiArt.CREAM, 5, HORIZONTAL_ALIGNMENT_CENTER))
		var shown: int = maxi(per_team[t].size(), size_n if fill else _team_cap())
		shown = mini(shown, _team_cap())
		for i in range(shown):
			var slot: Dictionary = per_team[t][i] if i < per_team[t].size() else {}
			col.add_child(_slot_card(t, i, slot, fill))
	# options
	for c in _lobby_opts.get_children():
		c.queue_free()
	var host := _is_host()
	var pn := PanelContainer.new()
	pn.theme_type_variation = "PanelDark"
	_lobby_opts.add_child(pn)
	var ov := VBoxContainer.new()
	ov.add_theme_constant_override("separation", 6)
	pn.add_child(ov)
	ov.add_child(UiArt.label("Match options", 22, UiArt.GOLD, 4))
	var r1 := HBoxContainer.new()
	r1.add_theme_constant_override("separation", 8)
	ov.add_child(r1)
	r1.add_child(UiArt.label("Team size", 20, UiArt.CREAM, 3))
	for n in [1, 2]:
		var b := Button.new()
		b.text = str(n)
		b.theme_type_variation = "ButtonSmall"
		b.toggle_mode = true
		b.button_pressed = size_n == n
		b.disabled = not host
		b.custom_minimum_size = Vector2(70, 56)
		var nn: int = n
		b.pressed.connect(func(): Net.send({"t": "fillBots", "on": fill, "teamSize": nn}))
		r1.add_child(b)
	var bots := Button.new()
	bots.text = "Fill with bots: %s" % ("ON" if fill else "OFF")
	bots.theme_type_variation = "ButtonSmall"
	bots.disabled = not host
	bots.custom_minimum_size = Vector2(0, 56)
	bots.pressed.connect(func(): Net.send({"t": "fillBots", "on": not fill, "teamSize": size_n}))
	ov.add_child(bots)
	if not host:
		ov.add_child(UiArt.label("The host chooses the options.", 16, UiArt.MUTED, 2))
	# start / ready
	if host:
		_lobby_start.text = "START"
		var ok: bool = fill or (not per_team[0].is_empty() and not per_team[1].is_empty())
		_lobby_start.disabled = not ok
	else:
		var rdy: bool = me.get("ready", false)
		_lobby_start.text = "READY" if not rdy else "WAITING..."
		_lobby_start.disabled = false
	# hero picker state
	var locked := {}
	for s in room.slots:
		if s.pid != Net.pid and s.heroId != null and s.heroId != "" and not me.is_empty() and s.team == me.team:
			locked[s.heroId] = _slot_color(int(s.team), per_team[int(s.team)].find(s))
	_lobby_browser.set_state(str(me.get("heroId", "")) if me.get("heroId") != null else "", locked)


func _slot_color(team: int, idx: int) -> String:
	return TEAM_COLORS[team][clampi(idx, 0, 1)]


func _slot_card(team: int, idx: int, slot: Dictionary, fill: bool) -> Control:
	var p := PanelContainer.new()
	p.theme_type_variation = "PanelPaper"
	p.custom_minimum_size = Vector2(0, 150)
	var color := _slot_color(team, idx)
	var host := _is_host()
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	p.add_child(v)
	if slot.is_empty():
		var tex := UiArt.tex_rect(UiArt.avatar(int(UiArt.COLOR_AVATAR_BASE[color]) + 3), Vector2(64, 64))
		tex.modulate = Color(1, 1, 1, 0.35 if not fill else 0.55)
		var hb := HBoxContainer.new()
		hb.add_theme_constant_override("separation", 8)
		v.add_child(hb)
		hb.add_child(tex)
		var vv := VBoxContainer.new()
		vv.add_theme_constant_override("separation", 0)
		hb.add_child(vv)
		vv.add_child(UiArt.label("Bot" if fill else "Open slot", 22, UiArt.INK_SOFT, 0))
		vv.add_child(UiArt.label("fills in on start" if fill else "waiting...", 15, UiArt.INK_SOFT, 0))
		if not fill:
			var me := _my_slot()
			var br := HBoxContainer.new()
			br.add_theme_constant_override("separation", 6)
			v.add_child(br)
			if not me.is_empty() and int(me.team) != team:
				br.add_child(_btn("Sit here", Vector2(0, 52), func(): Net.send({"t": "team", "team": team}), "ButtonSmall"))
			if host:
				br.add_child(_btn("+ Bot", Vector2(0, 52), func(): Net.send({"t": "addBot", "team": team}), "ButtonSmall"))
		return p
	var hid: String = slot.heroId if slot.heroId != null else ""
	var hb2 := HBoxContainer.new()
	hb2.add_theme_constant_override("separation", 8)
	v.add_child(hb2)
	var port: Texture2D = UiArt.hero_portrait(hid, color) if hid != "" else UiArt.avatar(int(UiArt.COLOR_AVATAR_BASE[color]) + 3)
	hb2.add_child(UiArt.tex_rect(port, Vector2(68, 68)))
	var nv := VBoxContainer.new()
	nv.add_theme_constant_override("separation", 0)
	nv.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hb2.add_child(nv)
	var nm := str(slot.name)
	var nl := UiArt.label(nm, 22, UiArt.PLAYER_COL[color].darkened(0.3), 0)
	nl.clip_text = true
	nl.custom_minimum_size = Vector2(80, 0)
	nv.add_child(nl)
	var hero_name: String = HeroesData.by_id(hid).get("name", "Choosing...") if hid != "" else "Choosing..."
	nv.add_child(UiArt.label(hero_name, 17, UiArt.INK_SOFT, 0))
	var tags := HBoxContainer.new()
	tags.add_theme_constant_override("separation", 6)
	v.add_child(tags)
	if slot.pid == room.get("host", ""):
		tags.add_child(_mini_tag("HOST", Color("e8b923")))
	if slot.bot:
		tags.add_child(_mini_tag("BOT", Color("9aa0ad")))
	if slot.pid == Net.pid:
		tags.add_child(_mini_tag("YOU", Color("7be08a")))
	if slot.ready and slot.pid != room.get("host", ""):
		tags.add_child(_mini_tag("READY", Color("7be08a")))
	if host and slot.bot:
		var pid: String = slot.pid
		tags.add_child(_btn("X", Vector2(48, 40), func(): Net.send({"t": "removeBot", "pid": pid}), "ButtonRed"))
	return p


func _mini_tag(text: String, col: Color) -> Control:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", UiArt.sb_flat(col, 6))
	var l := UiArt.label(text, 14, Color("1d1410"), 0)
	p.add_child(l)
	return p


# ------------------------------------------------------------------ overlays
func _build_overlay() -> void:
	_toast_lbl = UiArt.label("", 26, UiArt.CREAM, 6, HORIZONTAL_ALIGNMENT_CENTER)
	add_child(_toast_lbl)
	_toast_lbl.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_toast_lbl.offset_left = -400
	_toast_lbl.offset_right = 400
	_toast_lbl.offset_top = -110
	_toast_lbl.offset_bottom = -70
	_toast_lbl.modulate.a = 0.0
	_busy_panel = ColorRect.new()
	_busy_panel.color = Color(0, 0, 0, 0.55)
	_busy_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_busy_panel)
	_busy_lbl = UiArt.label("", 44, UiArt.GOLD, 9, HORIZONTAL_ALIGNMENT_CENTER)
	_busy_lbl.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_busy_lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_busy_panel.add_child(_busy_lbl)
	_busy_panel.visible = false


func toast(text: String) -> void:
	_toast_lbl.text = text
	_toast_lbl.modulate.a = 1.0
	var tw := create_tween()
	tw.tween_interval(2.2)
	tw.tween_property(_toast_lbl, "modulate:a", 0.0, 0.5)


## main.gd: back from a finished match.
func back_from_game() -> void:
	_quick = false
	_set_busy("")
	if room.get("code", "") != "" and not room.get("started", false):
		show_screen("lobby")
		_refresh_lobby()
	else:
		show_screen("main")
