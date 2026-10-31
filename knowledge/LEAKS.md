# Restart and leaks

Retry / New city build the next Game in the page: everything a run adds to the scene, the page or a
listener must be freed by `Game.dispose()` ([PLAN_GAME.md](plans/PLAN_GAME.md) Tech).

## `npm run check:restart` (`scripts/evals/restart.js`, ~1.5 min)

Run it after anything that adds to the scene, the page or a listener. `ok` + `failures` first; the
eval's header lists every check and threshold. In short:

- Retry, New city, Retry, New city through the end screen: fullscreen kept, seed kept/changed and in
  the URL, splash hidden with no animation left on it, one canvas/screen/touch layer, Enter starts.
- The first two runs drive a 5★ chase first (`busy=ms`), so mid-run objects (cops, scratches, broken
  props, fireworks) are in the Game being disposed. `dbg.mixedMaterials()` before and after it.
- 10 same-city restarts: heap (after `gc()`), geometries, textures and programs must hold; every old
  Game must be collected (WeakRefs); the GPU orphan list must hold only three's own.
- Its city is made from words (`--make` in `package.json`): every district with every feature that has
  a look, night and rain, so their resources are in the city disposed; the quick restarts reload it.
  **A new feature with a look joins those words.**
- Own city: `npm run check:browser -- --query "debug&gputrace&restarts=10&shots=1" --make "<words>"
  --start 1500 --out-dir <dir> --no-final --eval-file scripts/evals/restart.js` (`shots=1`: end screen
  and menu shots per step; or `--query "seed=N&…&<flags>"` without `--make`).

## When it fails

Read `orphans` (`gpuTrace`, below): each names the code that created the leak. Things `dispose()`
can't see on its own:

- A texture passed in by `onBeforeCompile` (`shader.uniforms`): also put the uniforms in
  `material.userData.uniforms` (`farmCrops.ts` does), where `disposeScene` and `gpuTrace` look.
- A render target: dispose the target, not its `.texture` (the PMREM environment leaked that way).
- Anything not in the scene (module caches, templates): reset it in `dispose()` like `resetCarMeshes()`.
- A listener on `window`/`document`, a timer or an async callback: remove it in `dispose()` or check
  `this.disposed` in the callback.
- An eval that holds an old Game in a variable keeps it alive: restart through a helper like `next()`.

## `?gputrace` (`src/core/gpuTrace.ts`)

`window.gpuTrace` lists what the renderer holds, each as `texture#12 CanvasTexture 512×512 "name"`
with the game code that created it (`fn file:line < caller`) and the meshes still using it.
`gpuTrace.orphans([game.scene, game.staging])` after a restart (`game.restart(seed)`, wait for
`window.game` to change and `#splash` to be hidden) is the leak list: only `MeshDepthMaterial` and
`DFG_LUT` (three's own) belong there. Also `live()`, `mark()` / `since(mark)`, `bySite(entries)`.
