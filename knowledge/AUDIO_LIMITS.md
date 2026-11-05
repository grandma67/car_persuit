# Audio limits: what browsers allow and what it costs

Read before touching `audio/CarAudio.ts`'s start-up, `Game.audioUnlocked` or the splash's gesture. Target:
**Chrome on Windows and Android.** Every number here was measured on a Mac (headless Chrome, 2026-11-06);
nothing has run on Windows or a real Android device. "Source" = read, not tested.

## How the game starts audio

1. **Loading** (`main.ts` → `CarAudio.prepare()`): `new AudioContext()`, empty. It starts `suspended`.
2. **First real gesture** (`onGesture`, or `unlock()` from the splash, Start, Retry): `init()` builds the sounds
   on that context and starts their sources, then `resume()`.
3. One context for the page: `GameShell` carries it through Retry and New city. Pause is `suspend()`, and a
   hidden tab pauses the game (`visibilitychange`), so backgrounding the page silences it.

`this.ctx` means "the sounds are built": every method guards on it, so the bare context lives in `early`
until `init`. Never put an unbuilt context in `ctx`.

Which gesture comes first depends on how the page opened:

| Opened | First gesture | |
|---|---|---|
| First visit in a tab | dismissing "press any key" / "tap to continue" | most players |
| Reload (`cp-splash-seen` set), or `?debug` | Start, or any key or tap on the menu | every `check:browser` run |
| Retry, New city | already unlocked | |

So a stall in `init` lands on the splash for most players, on Start only after a reload.

## What it costs (measured)

| | Blocks the page | Note |
|---|---|---|
| `new AudioContext()` | **~70 ms** at any CPU speed (`--throttle 4` too) | same muted or not; the browser, not our code |
| With `latencyHint: 'playback'` | same | no help |
| `resume()` on a prepared context | **0.2–0.4 ms** | running ~65 ms later, in the background |
| `init()`, building the sounds | ~1 ms on a Mac, ~12 ms throttled | stays in the gesture |

First gesture's slowest frame, main → `prepare()` (3 runs each, `check:audio`):

| | Before | After |
|---|---|---|
| Desktop, dismissing the splash | 78–90 ms | 18–19 ms |
| Phone (emulated), dismissing the splash | 78–113 ms | 18–30 ms |
| Desktop, reload, Start | 80–92 ms | 18 ms |
| Phone (emulated), Start | 57–71 ms | 20–22 ms, once 65 ms (not traced) |

Frames in the seconds after loading reach 111 ms with no input at all, so `check:audio` reads `idleGapMs` first.
Time a press only after a pause.

Source: the Web Audio spec calls contexts "expensive objects" that may need a high-priority thread and a
low-latency system stream, so expect it to differ by device; nobody publishes numbers for Chrome. Restarting a
paused system stream is far cheaper than opening one (about 200× on Windows, Firefox's figure).

## What a browser allows

- A context made without activation starts `suspended`. **Empty, it logs nothing.** Starting a source on it logs
  "The AudioContext was not allowed to start" (measured: one per source, 13–22 on our graph).
- Chrome allows making it at load and resuming on a gesture (Chrome's autoplay guide); `start()` on a connected
  node during a gesture resumes it too. A site the user plays a lot may be allowed to run at once: the context
  is then `running` and silent until the gesture.
- **Activation events** (MDN): `keydown` except Escape and some others (Caps Lock, Num Lock…), `mousedown`,
  `pointerdown` **with a mouse only**, `pointerup` **for touch and pen only**, `touchend`. So on Android a
  tap's `pointerdown` is no activation: `resume()` there does nothing. `CarAudio` listens to both, and
  `unlock()` won't build the sounds without activation, because the splash calls it on `pointerdown`.
- Activation runs out after a browser-chosen timeout (no fixed figure in MDN); sticky activation lasts the session.
  Only an unbuilt context needs it in `unlock()`; Retry's late call finds the sounds built.
- `state`: `suspended` (our `suspend()` or autoplay), `running`, `closed`, `interrupted` (something outside the
  page; the browser decides when it ends). A resume during an interruption goes to `interrupted`.
- No limit on open contexts in the spec. Chrome before 66 allowed six per tab. We use one.

## Chrome on Windows and Android (sources, untested)

- Sample rate follows the output device (commonly 44.1 or 48 kHz). Never hard-code it: `createNoiseBuffer` uses
  `ctx.sampleRate`.
- `outputLatency` changes with the device, by a lot for Bluetooth against wired, and reads 0 while suspended.
  Don't time anything to it. Windows buffers around 10 ms (a partial source).
- Chrome stops the system stream after 35 s of silence and restarts it on sound. It doesn't apply with an
  `AudioWorkletNode` in the graph; we have none, so keep it that way or check.
- Android: `resume()` in a gesture is what unlocks (howler's comment, Chrome ≥ 55). Howler also plays a one-sample
  silent buffer on the gesture; we don't need it so far.
- Not found anywhere: what an Android phone call or audio focus loss does to a running context. The game has
  no `statechange` handling, so a context stopped from outside stays stopped until `resume()`: the next pause
  and unpause, or mute.

iOS isn't the target. For later: the context must resume inside the gesture, not in a `.then`; `touchstart` reportedly
fails on some versions; vibrate mode blocks Web Audio; one unconfirmed report of re-locking after 5 s on iOS 18.5.

## How to test it

`npm run check:audio` (~1 min, `--ref main` for a before): fresh Chrome per case, real keys and touches through
the debugger protocol, every console message fails the case. It reads the output's level, so silence fails too.

- **`check:browser` can't test this.** Its evals run as user gestures, so a context is never blocked, and it
  doesn't enable the `Log` domain, so it never sees the browser's own warnings: main showed `logs: []` with 13
  warnings on a phone's first visit.
- The phone case is emulated touch on a Mac: it checks the events and the warnings, not Android's audio.
- A real device is still the only test of how it sounds and how long it takes.
- Allowed in the console: Rapier's "using deprecated parameters for the initialization function". It comes
  from `rapier3d-compat` 0.18.2's own loader on every load, has nothing to do with audio, and we stay on 0.18.2
  (`RAPIER.md`).

## Sources

- [Chrome: autoplay policy](https://developer.chrome.com/blog/autoplay)
- [MDN: user activation](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/User_activation)
- [MDN: AudioContext state](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/state)
- [MDN: AudioContext constructor](https://developer.mozilla.org/en-US/docs/Web/API/AudioContextOptions)
- [Firefox bug 1771179: the cost of a context, Chrome's 35 s](https://bugzilla.mozilla.org/show_bug.cgi?id=1771179)
- [Firefox bug 1430704: context creation on the main thread](https://bugzilla.mozilla.org/show_bug.cgi?id=1430704)
- [Web Audio spec issue 1802: autoplay against suspend()](https://github.com/WebAudio/web-audio-api/issues/1802)
- [Blink: outputLatency, device changes](https://mail-archive.com/blink-dev@chromium.org/msg01177.html)
- [howler.js source](https://raw.githubusercontent.com/goldfire/howler.js/master/src/howler.core.js)
- [Matt Montag: unlocking Web Audio](https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos)
