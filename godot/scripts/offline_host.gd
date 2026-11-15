class_name OfflineHost
extends RefCounted
## Offline play: the lobby and match run on this device in GDScript (res://offline/engine/), a port of the
## TypeScript server rules that tools/offline-parity.ts + offline/tests/parity.gd check tick by tick. Net.gd talks
## to it with the same JSON messages it sends a server, so the rest of the game cannot tell the difference.
## Nothing here depends on the platform: what runs in the desktop tests is exactly what runs on a phone.
##
## The match runs on its own thread, so a slow tick (a long path search during a siege) delays one snapshot
## instead of freezing the screen. The game thread only touches the mutex-guarded queues below.

const Rooms = preload("res://offline/engine/rooms.gd")
const Data = preload("res://offline/engine/data.gd")

var ready := false
var failed := ""  # why the host stopped; empty while fine
var stage := "starting"

var _rooms  # owned by the worker thread once it runs
var _thread: Thread
var _sem := Semaphore.new()
var _mutex := Mutex.new()
var _inbox: Array = []  # client messages (guarded)
var _outbox: Array = []  # server messages, already JSON-normalised (guarded)
var _pending_ms := 0.0  # real time not yet simulated (guarded)
var _pid := ""  # guarded until the worker connects it
var _opened := false  # guarded
var _quit := false  # guarded


## An offline host, or null when the game data is missing (then `why[0]` says so).
static func create(why: Array = [""]) -> OfflineHost:
	if Data.get_data().is_empty():
		why[0] = "the game data is missing (res://offline/data.json)"
		return null
	var h := OfflineHost.new()
	h._rooms = Rooms.new()
	h._thread = Thread.new()
	if h._thread.start(h._run) != OK:
		why[0] = "could not start the offline thread"
		return null
	h.ready = true
	h.stage = "ready"
	return h


func open(pid: String) -> void:
	_mutex.lock()
	_pid = pid
	_opened = true
	_mutex.unlock()
	_sem.post()


func send(msg: Dictionary) -> void:
	_mutex.lock()
	_inbox.append(msg)
	_mutex.unlock()


## Hands `delta` seconds of real time to the match and returns the server messages produced so far, in order.
func poll(delta: float) -> Array:
	_mutex.lock()
	_pending_ms += delta * 1000.0
	var out := _outbox
	_outbox = []
	_mutex.unlock()
	_sem.post()
	return out


func stop() -> void:
	if _thread:
		_mutex.lock()
		_quit = true
		_mutex.unlock()
		_sem.post()
		_thread.wait_to_finish()
		_thread = null
	ready = false


# ------------------------------------------------------------------ worker thread
func _run() -> void:
	var connected := false
	while true:
		_sem.wait()
		_mutex.lock()
		var quit := _quit
		var open_now := _opened and not connected
		var pid := _pid
		var msgs := _inbox
		_inbox = []
		var ms := _pending_ms
		_pending_ms = 0.0
		_mutex.unlock()
		if quit:
			break
		if open_now:
			connected = true
			_rooms.connect_client(pid)
		if not connected:
			# messages sent before open() wait for it, so they belong to the player
			_mutex.lock()
			_inbox = msgs + _inbox
			_pending_ms += ms
			_mutex.unlock()
			continue
		for m in msgs:
			_rooms.message(m)
		_rooms.advance(ms)
		if _rooms.outbox.size():
			# each message goes through JSON once: the game gets the same types (numbers as floats) as from a server
			var out := []
			for m in _rooms.outbox:
				out.append(JSON.parse_string(JSON.stringify(m)))
			_rooms.outbox = []
			_mutex.lock()
			_outbox.append_array(out)
			_mutex.unlock()
	_rooms.dispose()
	_rooms = null
