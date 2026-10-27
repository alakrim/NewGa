extends Node
## WebSocket client for the Bannerfall server (same JSON protocol as the web client, see src/shared/protocol.ts).

signal connected(pid: String)
signal disconnected()
signal room(info: Dictionary)
signal game_init(init: Dictionary)
signal snapshot(snap: Dictionary)
signal chat(line: Dictionary)
signal replay(data: Dictionary)
signal error(msg: String)

const SAVE_PATH := "user://net.cfg"

var url := "ws://127.0.0.1:8787/ws"
var pid := ""
var player_name := "Hero"
var rtt_ms := 0.0
var last_room: Dictionary = {}
var init_data: Dictionary = {}

var _ws := WebSocketPeer.new()
var _state := WebSocketPeer.STATE_CLOSED
var _ping_timer := 0.0
var _retry_at := -1.0
var _want_open := false
var _saved_url := ""  # the url to persist; a --server= override is for this run only


func _ready() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(SAVE_PATH) == OK:
		url = cfg.get_value("net", "url", url)
		pid = cfg.get_value("net", "pid", "")
		player_name = cfg.get_value("net", "name", player_name)
	_saved_url = url
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--server="):
			url = arg.substr(9)


## Sets the server address chosen by the player and remembers it.
func set_url(u: String) -> void:
	url = u
	_saved_url = u
	save()


func save() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("net", "url", _saved_url)
	cfg.set_value("net", "pid", pid)
	cfg.set_value("net", "name", player_name)
	cfg.save(SAVE_PATH)


func connect_to_server() -> void:
	_want_open = true
	var full := url + ("?pid=" + pid.uri_encode() if pid != "" else "")
	_ws = WebSocketPeer.new()
	_ws.inbound_buffer_size = 4 * 1024 * 1024
	var err := _ws.connect_to_url(full)
	if err != OK:
		error.emit("Could not reach the server at %s" % url)
		_retry_at = Time.get_ticks_msec() / 1000.0 + 3.0


func is_open() -> bool:
	return _state == WebSocketPeer.STATE_OPEN


func close() -> void:
	_want_open = false
	_ws.close()


func send(msg: Dictionary) -> void:
	if _ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		_ws.send_text(JSON.stringify(msg))


## In-game command (see `Command` in protocol.ts), e.g. {"c": "train", "unit": "archer"}.
func cmd(command: Dictionary) -> void:
	send({"t": "cmd", "cmd": command})


func _process(delta: float) -> void:
	_ws.poll()
	var st := _ws.get_ready_state()
	if st != _state:
		_state = st
		if st == WebSocketPeer.STATE_CLOSED:
			disconnected.emit()
			if _want_open:
				_retry_at = Time.get_ticks_msec() / 1000.0 + 2.0
	if st == WebSocketPeer.STATE_OPEN:
		while _ws.get_available_packet_count() > 0:
			_handle(_ws.get_packet().get_string_from_utf8())
		_ping_timer -= delta
		if _ping_timer <= 0.0:
			_ping_timer = 2.0
			send({"t": "ping", "ts": Time.get_ticks_msec()})
	elif st == WebSocketPeer.STATE_CLOSED and _want_open and _retry_at > 0.0 and Time.get_ticks_msec() / 1000.0 > _retry_at:
		_retry_at = -1.0
		connect_to_server()


func _handle(text: String) -> void:
	var m = JSON.parse_string(text)
	if typeof(m) != TYPE_DICTIONARY:
		return
	match m.get("t", ""):
		"welcome":
			pid = m.pid
			save()
			connected.emit(pid)
		"room":
			last_room = m.room
			room.emit(m.room)
		"init":
			init_data = m.init
			game_init.emit(m.init)
		"snap":
			snapshot.emit(m.s)
		"chat":
			chat.emit(m)
		"replay":
			replay.emit(m.replay)
		"pong":
			rtt_ms = Time.get_ticks_msec() - float(m.ts)
		"error":
			error.emit(m.msg)
