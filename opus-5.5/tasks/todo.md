# Endless 4-Lane Racing Game

Single self-contained `index.html`: pseudo-3D segment renderer on a 2D canvas, no dependencies.

## Build

- [x] Scaffold: full-viewport canvas, HUD markup/styles, resize + DPR handling, key input, fixed-timestep loop
- [x] Road generator (straights, varied curves, S-bends, gentle hills) + sliding segment window
- [x] Projection + road rendering (grass, rumble strips, asphalt, 4 lanes, fog)
- [x] Sky and parallax background layers
- [x] Player car, physics (accelerate / brake / steer / centrifugal / off-road), camera follow
- [x] Roadside scenery sprites
- [x] Tune framing, speed and curve intensity by eye in the browser

## Verify

- [x] Load: sky, perspective road, 4 lanes and car visible with no interaction
- [x] Driving: arrows accelerate / brake / steer; grass slows the car
- [x] Curves: left and right bends of differing sharpness; background scrolls with the turn
- [x] Infinite road: soak test (millions of steps) — no errors, no NaN, bounded memory, still renders
- [x] Robustness: no console errors, resizes cleanly, smooth frame rate

## Feature: traffic and collisions

Crashes never end the game (they cost speed). Collisions cover traffic and roadside trees.

- [x] Reusable car drawing (`paintCar`), traffic liveries pre-rendered as fog-tinted sprites
- [x] Traffic pool: spawn / recycle ahead and behind, own seeded PRNG
- [x] Traffic AI: follow what is ahead, change lane when blocked and clear
- [x] Collisions with traffic: rear-end, side-swipe, car catching the player
- [x] Collisions with trees: wider verge, stop and slide back toward the road
- [x] Depth-ordered drawing of player + traffic inside the segment loop
- [x] Screen shake on impact
- [x] Verify: visuals, rear-end, side-swipe, trees, stopped player, soak, regression

## Review

**Result:** `index.html` (856 lines, no dependencies, no assets). Runs from a double-click (`file://`) or any static server.

### Traffic and collisions

18 cars in four colours cruise at 30–60 % of top speed. Tuning lives in the constants block at the top of
the script (`TRAFFIC_COUNT`, `TRAFFIC_SPEED`, `REAR_END_KEEP`, `SCRAPE_DECEL`, `MAX_X`, …).

| Check | Outcome |
|---|---|
| Rear-end at top speed into a car doing a third of that | Held exactly at its bumper, left with half *its* speed, full shake. Holding the throttle bumps it again but never passes through. Steering round gets past in about 2 s. |
| Side-swipe | Cars never closer than the contact distance; speed scrubbed while leaning on it. Letting go of the wheel stops the scraping (sitting exactly alongside costs nothing). |
| Trees | First trunk is reachable at the verge. Dead stop, then slid back toward the road and free in 0.4 s on throttle alone. Steering *into* the trees for 30 s still makes progress: never wedged. |
| Stopped in lane for a minute | All 18 cars came past, none touched. |
| Car approaching a stopped player in the same lane | Pulls out to the next lane and passes, slowing while it does. |
| Same, with every other lane walled off | Stops one safe gap behind and waits. |
| Brake-check a car following at speed | It stops too; never closer than 1.7 car lengths. |
| Draw order | Car alongside-behind overlaps in front of the player; cars ahead sit higher and smaller; correct on bends and over crests; haze into the fog. |
| Soak, clumsy driver, 5,000,000 ticks (23 h) | 18,901 rear-ends, 9,508 tree hits, 181,396 traffic lane changes. Zero car-through-car overlaps (player or traffic), no NaN, camera never moved backward, pool constant at 18, segment window still ≤ 369. |
| Playability | A simple human-like driver (one lane at a time, brakes when boxed in) averaged 70 % of top speed with about 1.3 bumps a minute, on three different roads. |
| Regression | Original suite still passes: loads from `file://`, all window shapes, 60 fps at 2880×1620 (script 1.2 ms/frame, up from 0.7), no console errors. |

**Bugs the soak test found, and the fixes**

- *Traffic barged sideways into the player.* A car midway through a lane change kept sliding into a car
  alongside it. Traffic now holds its line while anything is beside it on the side it is moving toward.
- *Cars alongside the player braked for them.* Two such cars with the player between them all stopped,
  permanently. Only something a full car length ahead now counts as "in front".
- *Contact resolution depended on the order cars were checked.* Moving clear of one car can create
  contact with another, so the pass now repeats until settled; and if sideways is no way out (hemmed
  in), the car just reached ahead stops the player instead of the player squeezing past it.
- *Phantom scraping.* Being set exactly against a car could register as a hair's-breadth overlap on the
  next tick through rounding. Contact now needs to exceed a tiny threshold.

I also tried splitting resolution into "rear-ends, then side contacts"; it misclassified rear-ends and
was reverted (the soak showed the player stationary 57 % of the time).

**Changed along the way:** the verge is wider (`MAX_X` 1.6 → 2.6) so the tree line can be reached.
With the avoid-nothing lane-holding autopilot, distance covered in 23 h fell from 6,018 km to 1,852 km:
traffic is a real obstacle now.

**How it was verified.** The Claude-in-Chrome extension was not connected, so testing was done by driving headless
Chrome over the DevTools protocol: genuine key events, screenshots, console/exception capture.

| Check | Outcome |
|---|---|
| Load, no interaction | Sky, sun, clouds, mountains, perspective road with 3 dashed dividers (4 lanes), car. No scrollbars. |
| Accelerate (`↑`) | 0 → top speed (260 km/h) in 5 s |
| Steer (`←` `→`) | Moves the car across lanes; no effect while stationary (steering scales with speed) |
| Brake (`↓`) | Top speed → 0 in ~1 s, brake lights on, no reverse |
| Off-road | Car clamps at the verge, speed dragged down toward 25 % |
| Curves | Strength spans −6 … +6; left / right / straight each ≈ ⅓ of the road |
| Hills | Height stays within ±6000 units; crests and descents render with correct occlusion |
| Infinite road | 5,000,000 ticks (23 h of play, 6,018 km): no NaN, no exceptions, segment window never above 369, JS heap ≈ 2.4 MB; still renders correctly at that distance |
| Window shapes | 2560×1080, 900×900, 500×850 (portrait), 640×360 — canvas always matches the viewport, all four lanes stay in view |
| Frame rate | 60 fps at 2880×1620 (Retina), 0.7 ms of script per frame |
| Console | No errors or warnings |

**Bugs found and fixed during verification**

- *Green seams across the asphalt.* Grass was a full-width rect layered under the road, so its antialiased top
  edge tinted each segment boundary. Grass, rumble strips and asphalt are now painted side by side.
- *Trees ghosting through each other.* Fog on sprites was done with alpha. Sprites are now pre-tinted toward
  the fog colour in 12 steps and drawn opaque.
- *Jagged close-up trees.* The nearest trees were a 5× magnification of the sprite; the unfogged (close-up)
  copy is now rendered at double resolution.
- *Bare opening sky / unreadable HUD over clouds.* One cloud per lattice cell; heavier HUD text shadow.
- *Car lean sank a tyre into the road.* Tyres stay planted; only the body rolls.

**Not verified:** feel on a physical keyboard, and browsers other than Chrome (the code uses only standard
Canvas 2D; `roundRect` needs Chrome 99+ / Safari 16+ / Firefox 112+).

**Left in deliberately**

- `?seed=N` in the URL reproduces a specific road (otherwise random each load).
- `window.game` (`step`, `state`, `input`) is a small test hook used by the soak test.

**Out of scope, easy follow-ups:** oncoming traffic, damage or lives, scoring, sound, traffic brake lights, touch/gamepad.
