extends RefCounted
## Offline lobby and match loop for the one local player: a port of the single-client path of
## src/server/rooms.ts (create, hero pick, bots, start, commands, end of match, back to the lobby). It answers the
## client's protocol messages with the same server messages a real server would send.

const Game = preload("res://offline/engine/game.gd")
const Data = preload("res://offline/engine/data.gd")
const TICK_MS := 50.0

var D: Dictionary
var outbox: Array = []
var pid := ""
var name_ := "Hero"
var room = null  # Dictionary or null
var game = null
var _loop := false
var _ended_at := -1.0
var _clock_ms := 0.0
var _acc_ms := 0.0
var _rng := RandomNumberGenerator.new()


func _init() -> void:
	D = Data.get_data()
	_rng.randomize()


func _new_id() -> String:
	const A := "abcdefghijklmnopqrstuvwxyz0123456789"
	var s := ""
	for i in 8:
		s += A[_rng.randi_range(0, A.length() - 1)]
	return s


func _send(m: Dictionary) -> void:
	outbox.append(m)


func connect_client(want: String) -> void:
	var valid := want.length() >= 6 and want.length() <= 16 and not want.begins_with("bot-")
	pid = want if valid else _new_id()
	_send({"t": "welcome", "pid": pid})
	if room != null:
		_broadcast_room()
		if game != null:
			_send({"t": "init", "init": game.init_msg(pid)})


func _info() -> Dictionary:
	return {"code": room.code, "host": room.host, "slots": room.slots.duplicate(true), "started": game != null, "fillBots": room.fillBots, "teamSize": room.teamSize, "mode": "frontline"}


func _broadcast_room() -> void:
	_send({"t": "room", "room": _info()})


func _team_count(team: int) -> int:
	var n := 0
	for s in room.slots:
		if int(s.team) == team:
			n += 1
	return n


func _clean(n) -> String:
	var s := str(n).strip_edges().left(16) if n is String else "Hero"
	return s if s != "" else "Hero"


func _stop_game() -> void:
	if game != null:
		game.dispose()
	game = null
	_loop = false
	_ended_at = -1.0


## Advances the match clock by `ms` real milliseconds (at most 250 per call, so a stalled app does not replay
## minutes at once) and runs the 20 Hz match loop.
func advance(ms: float) -> void:
	_acc_ms += clampf(ms, 0.0, 250.0)
	while _acc_ms >= TICK_MS:
		_acc_ms -= TICK_MS
		_clock_ms += TICK_MS
		if _loop:
			_tick()


func _tick() -> void:
	var g = game
	g.step()
	var team := 0
	for p in g.players:
		if p.playerId == pid:
			team = int(p.team)
	_send({"t": "snap", "s": g.snapshot(pid, team)})
	g.flush_events()
	if g.winner != null:
		if _ended_at < 0:
			_ended_at = _clock_ms
			_send({"t": "replay", "replay": g.replay()})
		elif _clock_ms - _ended_at > 3000:
			_loop = false


func message(m: Dictionary) -> void:
	match str(m.get("t", "")):
		"create":
			name_ = _clean(m.get("name", "Hero"))
			_stop_game()
			room = {"code": "SOLO", "host": pid, "slots": [{"pid": pid, "name": name_, "team": 0, "heroId": null, "bot": false, "ready": false}],
				"autoBots": [], "fillBots": true, "teamSize": 2}
			_broadcast_room()
			return
		"join":
			_send({"t": "error", "msg": "Offline play has no rooms to join: switch to Online in the main menu."})
			return
		"leave":
			_stop_game()
			room = null
			_send({"t": "room", "room": {"code": "", "host": "", "slots": [], "started": false, "fillBots": false, "teamSize": 0, "mode": "frontline"}})
			return
		"ping":
			_send({"t": "pong", "ts": m.get("ts", 0)})
			return
	if room == null:
		return
	var slot = null
	for s in room.slots:
		if s.pid == pid:
			slot = s
	match str(m.get("t", "")):
		"team":
			var t := int(m.get("team", -1))
			if game != null or slot == null or int(slot.team) == t or (t != 0 and t != 1) or _team_count(t) >= 2:
				return
			slot.team = t
		"hero":
			var hid := str(m.get("heroId", ""))
			if game != null or slot == null or not D.hero_by_id.has(hid):
				return
			slot.heroId = hid
		"ready":
			if slot:
				slot.ready = bool(m.get("ready", false))
		"addBot":
			var t := int(m.get("team", -1))
			if game != null or (t != 0 and t != 1) or _team_count(t) >= 2:
				return
			var n := 1
			for s in room.slots:
				if s.bot:
					n += 1
			room.slots.append({"pid": "bot-" + _new_id(), "name": "Bot %d" % n, "team": t, "heroId": null, "bot": true, "ready": true})
		"removeBot":
			if game != null:
				return
			var keep := []
			for s in room.slots:
				if not (s.bot and s.pid == str(m.get("pid", ""))):
					keep.append(s)
			room.slots = keep
		"fillBots":
			if game != null:
				return
			room.fillBots = bool(m.get("on", true))
			if m.get("teamSize", null) != null:
				room.teamSize = clampi(int(m.teamSize), 1, 2)
		"mode":
			if m.get("mode", "frontline") != "frontline":
				_send({"t": "error", "msg": "Offline play is Frontline only."})
		"start":
			if game != null:
				return
			_start_game()
			return
		"lobbyReturn":
			if game == null or game.winner == null:
				return
			_stop_game()
			var keep := []
			for s in room.slots:
				if not (s.bot and room.autoBots.has(s.pid)):
					keep.append(s)
			room.slots = keep
			room.autoBots = []
			for s in room.slots:
				s.ready = false
		"cmd":
			var c = m.get("cmd", null)
			if game != null and c is Dictionary:
				game.command(pid, c)
			return
		"chat":
			var text := str(m.get("text", "")).left(200).strip_edges()
			if text != "":
				_send({"t": "chat", "from": name_, "text": text, "team": bool(m.get("team", false)), "teamId": int(slot.team) if slot else 0})
			return
	_broadcast_room()


func _start_game() -> void:
	var taken := {}
	for s in room.slots:
		if s.heroId != null:
			taken[s.heroId] = true
	if room.fillBots:
		var size := mini(2, maxi(int(room.teamSize), maxi(_team_count(0), _team_count(1))))
		for team in [0, 1]:
			var n := 1
			while _team_count(team) < size:
				var bid := "bot-" + _new_id()
				room.autoBots.append(bid)
				room.slots.append({"pid": bid, "name": "Bot %s %d" % ["Dawn" if team == 0 else "Dusk", n], "team": team, "heroId": null, "bot": true, "ready": true})
				n += 1
	for s in room.slots:
		if s.heroId == null:
			var free := []
			for h in D.heroes:
				if not taken.has(h.id):
					free.append(h.id)
			if free.is_empty():
				for h in D.heroes:
					free.append(h.id)
			s.heroId = free[_rng.randi_range(0, free.size() - 1)]
			taken[s.heroId] = true
	var setups := []
	for s in room.slots:
		setups.append({"pid": s.pid, "name": s.name, "team": int(s.team), "heroId": s.heroId, "bot": bool(s.bot)})
	game = Game.new(setups, _rng.randi_range(0, 999999999))
	_ended_at = -1.0
	_send({"t": "init", "init": game.init_msg(pid)})
	_broadcast_room()
	_loop = true


func dispose() -> void:
	_stop_game()
