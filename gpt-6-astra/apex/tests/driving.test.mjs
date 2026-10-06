import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

export function createGame(canvasFactory, { traffic: trafficEnabled = false, reducedMotion = false } = {}) {
  const elements = new Map(), events = new Map(), registry = new Map();
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get: (_, name) => name.startsWith('create') ? () => gradient : (...args) => {
    for (const value of args) if (typeof value === 'number') assert(Number.isFinite(value), `${name} received a non-finite coordinate`);
  }, set: () => true });
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { style: {}, dataset: {}, hidden: false, textContent: '', events: new Map(), classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
        addEventListener(name, callback) { this.events.set(name, callback); }, setAttribute() {}, focus() {}, setPointerCapture() {} });
    }
    return elements.get(id);
  }
  for (const id of ['world', 'route']) elements.set(id, canvasFactory ? canvasFactory(id) : { getContext: () => context });
  const buttons = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].map(key => { const button = element(key); button.dataset.key = key; return button; });
  const scope = { Math, console, AbortController, Promise, innerWidth: 1440, innerHeight: 960, devicePixelRatio: 1,
    requestAnimationFrame() {}, matchMedia: () => ({ matches: reducedMotion }), addEventListener: (name, fn) => events.set(name, fn),
    document: { getElementById: element, querySelectorAll: () => buttons, addEventListener() {}, modelContext: { registerTool: tool => registry.set(tool.name, tool) } } };
  scope.window = scope;
  // Expose the closure only in this test VM; the shipped page has no test API.
  const marker = 'resize(); updateHUD(); requestAnimationFrame(render);';
  assert(script.includes(marker));
  vm.runInNewContext(script.replace(marker, `globalThis.game = {
    update, render, resize, updateHUD, roadCenter, roadSlope, keys, traffic, trafficPose, makeTrafficCar,
    state: () => ({ position, carX, heading, distance, speed, player, paused, collisionCount, collisionCooldown, impactTime }),
    setPose: (x, z, angle, velocity = 0) => { carX = x; position = z; heading = angle; speed = velocity;
      player = (carX - roadCenter(position)) / (ROAD * Math.hypot(1, roadSlope(position))); }
  }; ${trafficEnabled ? '' : 'traffic.length = 0;'} ${marker}`), scope);
  const game = scope.game;
  return { ...game, scope, elements, events, registry,
    key(name, pressed = true) { events.get(pressed ? 'keydown' : 'keyup')({ key: name, repeat: false, preventDefault() {} }); },
    advance(seconds, fps = 120) { for (let i = 0; i < Math.round(seconds * fps); i++) game.update(1 / fps); game.updateHUD(); } };
}

test('throttle alone holds a straight world heading and leaves the curved road', () => {
  const game = createGame(), initial = game.state();
  game.key('ArrowUp'); game.advance(10);
  const after = game.state(), dx = after.carX - initial.carX, dz = after.position - initial.position;
  assert(Math.abs(after.heading - initial.heading) < 1e-12, 'the road must never turn the car');
  assert(Math.abs(dx * Math.cos(initial.heading) - dz * Math.sin(initial.heading)) < 1e-7, 'motion must stay on the initial straight line');
  assert(Math.abs(after.player) > .95, 'throttle alone must run off the bend');
  assert.equal(game.elements.get('condition').textContent, 'OFF ROAD');
  game.advance(20);
  assert(Math.abs(game.state().player) > 1.85, 'there must be no invisible shoulder clamp');
  assert(game.state().speed <= 4400, 'grass must slow the car');
});

test('steering changes heading and releasing steering preserves the new direction', () => {
  const game = createGame();
  game.key('ArrowUp'); game.advance(1);
  const initial = game.state().heading;
  game.key('ArrowRight'); game.advance(.3); game.key('ArrowRight', false);
  const turned = game.state().heading;
  assert(turned > initial);
  game.advance(1);
  assert(Math.abs(game.state().heading - turned) < 1e-12);
  game.key('ArrowLeft'); game.advance(.5); game.key('ArrowLeft', false);
  assert(game.state().heading < turned, 'countersteering must turn back left');
});

test('steering can follow bends and recover from the shoulder', () => {
  const game = createGame();
  let largestOffset = 0;
  function drive(seconds) {
    for (let frame = 0; frame < seconds * 120; frame++) {
      const state = game.state(), ahead = 2300 + state.speed * .25;
      const target = Math.atan2(game.roadCenter(state.position + ahead) - state.carX, ahead);
      const error = Math.atan2(Math.sin(target - state.heading), Math.cos(target - state.heading));
      game.keys.clear();
      if (state.speed < 5500) game.keys.add('ArrowUp');
      if (state.speed > 5600) game.keys.add('ArrowDown');
      if (error > .01) game.keys.add('ArrowRight');
      if (error < -.01) game.keys.add('ArrowLeft');
      game.update(1 / 120);
      largestOffset = Math.max(largestOffset, Math.abs(game.state().player));
    }
  }
  drive(90);
  assert(largestOffset < .95, `steering should keep the car on asphalt, got ${largestOffset}`);
  assert(game.state().distance > 400000, 'cover several different bends');
  const z = game.state().position;
  game.setPose(game.roadCenter(z) + 2.4 * 1450 * Math.hypot(1, game.roadSlope(z)), z, Math.atan(game.roadSlope(z)), 4200);
  drive(15);
  assert(Math.abs(game.state().player) < .5, 'steering should recover onto the road');
});

test('braking, pause/resume, blur, and touch controls retain their behavior', () => {
  const game = createGame();
  game.key('ArrowUp'); game.advance(1); game.key('ArrowUp', false);
  game.key('ArrowDown'); game.advance(2); game.key('ArrowDown', false);
  assert.equal(game.state().speed, 0);
  game.key('Escape');
  const stopped = JSON.stringify(game.state());
  game.key('ArrowUp'); game.key('ArrowRight'); game.advance(2);
  assert.equal(JSON.stringify(game.state()), stopped);
  game.elements.get('resume').events.get('click')();
  assert.equal(game.state().paused, false);
  const button = game.elements.get('ArrowUp');
  button.events.get('pointerdown')({ pointerId: 1, preventDefault() {} }); game.advance(1);
  button.events.get('pointerup')({ pointerId: 1 });
  assert(game.state().speed > 3000);
  game.events.get('blur')();
  assert.equal(game.state().paused, true);
  assert.equal(game.keys.size, 0);
});

test('distance counts actual travel even when turning around', () => {
  const game = createGame();
  game.setPose(game.roadCenter(0), 0, Math.PI, 5000);
  game.key('ArrowUp'); game.advance(1);
  assert(game.state().position < 0);
  assert(game.state().distance > 0);
  assert(Number(game.elements.get('distance').textContent) > 0);
  assert.equal(game.registry.get('read_drive_status').execute().distanceKm, Number(game.elements.get('distance').textContent));
});

test('rendering remains finite at different headings, road positions, and screen sizes', () => {
  const game = createGame(undefined, { traffic: true });
  for (const z of [-100000, 0, 100000, 1000000000]) {
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      game.setPose(game.roadCenter(z) + 1800, z, angle);
      game.render(1);
    }
  }
  game.scope.innerWidth = 390; game.scope.innerHeight = 844;
  game.resize(); game.render(1);
});

function putPlayerInLane(game, s, lane, speed = 0, direction = 1) {
  const pose = game.trafficPose({ s, lane });
  game.setPose(pose.x, pose.z, pose.heading + (direction < 0 ? Math.PI : 0), speed);
}

test('traffic fills all four lanes with varied colors and speeds, at a safe initial distance', () => {
  const game = createGame(undefined, { traffic: true });
  assert.equal(game.traffic.length, 24);
  assert.equal(new Set(game.traffic.map(car => car.lane)).size, 4);
  assert(new Set(game.traffic.map(car => car.cruise)).size > 4);
  assert(new Set(game.traffic.map(car => car.colors[0])).size > 3);
  const player = game.state();
  for (const car of game.traffic) assert(Math.hypot(car.x - player.carX, car.z - player.position) > 2000);
  assert(game.traffic.filter(car => car.s > 0 && car.s < 30000).length >= 3, 'traffic is visible ahead at the start');
});

test('traffic follows curved lanes, maintains gaps, and stays bounded over an endless drive', () => {
  const game = createGame(undefined, { traffic: true });
  const original = game.traffic.map(car => ({ id: car.id, s: car.s }));
  game.setPose(100000, 0, 0, 0); game.key('ArrowUp');
  game.advance(300, 30);
  assert.equal(game.traffic.length, 24);
  for (const car of game.traffic) {
    const pose = game.trafficPose(car);
    assert(Math.abs(car.x - pose.x) < 1e-8 && Math.abs(car.z - pose.z) < 1e-8);
    assert(car.speed >= 0 && car.speed <= car.cruise + 1e-8);
    assert(Math.abs(car.s - game.state().position) < 55000, 'cars should recycle beyond view');
    assert.notEqual(car.s, original.find(other => other.id === car.id).s);
  }
  for (let lane = 0; lane < 4; lane++) {
    const cars = game.traffic.filter(car => car.lane === lane).sort((a, b) => a.s - b.s);
    for (let i = 1; i < cars.length; i++) assert(Math.hypot(cars[i].x - cars[i - 1].x, cars[i].z - cars[i - 1].z) > 860, 'traffic must not overlap its leader');
  }
});

test('a rear-end collision slows the player and gives feedback without changing heading', () => {
  const game = createGame();
  game.traffic.push(game.makeTrafficCar(0, 1000, 2, 0));
  putPlayerInLane(game, 0, 2, 13200);
  const heading = game.state().heading;
  game.key('ArrowUp'); game.advance(.15);
  assert.equal(game.state().collisionCount, 1);
  assert(game.state().speed < 5000);
  assert(Math.abs(game.state().heading - heading) < 1e-12);
  assert.equal(game.elements.get('condition').textContent, 'COLLISION');
  assert.equal(game.elements.get('collision-notice').hidden, false);
  assert(game.elements.get('announcement').textContent.includes('Collision'));
  game.advance(.25);
  assert.equal(game.state().collisionCount, 1, 'one impact must not trigger a crash every frame');
});

test('passing in an adjacent lane is collision-free', () => {
  const game = createGame();
  game.traffic.push(game.makeTrafficCar(1, 400, 3, 0));
  putPlayerInLane(game, 0, 2, 13200);
  game.key('ArrowUp'); game.advance(.2);
  assert.equal(game.state().collisionCount, 0);
  assert(game.state().speed > 12000);
});

test('braking before traffic prevents an impact', () => {
  const game = createGame();
  game.traffic.push(game.makeTrafficCar(2, 4000, 2, 0));
  putPlayerInLane(game, 0, 2, 8000);
  game.key('ArrowUp'); game.update(1 / 120); game.key('ArrowUp', false);
  game.key('ArrowDown'); game.advance(1.2);
  assert.equal(game.state().speed, 0);
  assert.equal(game.state().collisionCount, 0);
});

test('swept collision catches a fast head-on crossing between frames', () => {
  const game = createGame();
  game.traffic.push(game.makeTrafficCar(3, 0, 2, 13200));
  putPlayerInLane(game, 1400, 2, 13200, -1);
  game.key('ArrowUp'); game.update(.12);
  assert.equal(game.state().collisionCount, 1);
  assert(game.state().speed < 5000);
});

test('swept collision catches a fast side impact between frames', () => {
  const game = createGame(), car = game.makeTrafficCar(4, 0, 2, 0);
  game.traffic.push(car);
  game.setPose(car.x - Math.cos(car.heading) * 1000, car.z + Math.sin(car.heading) * 1000, car.heading + Math.PI / 2, 13200);
  game.key('ArrowUp'); game.update(.16);
  assert.equal(game.state().collisionCount, 1);
});

test('pause freezes traffic and impact recovery; reduced motion keeps the warning without the flash', () => {
  const game = createGame(undefined, { reducedMotion: true });
  game.traffic.push(game.makeTrafficCar(5, 1000, 2, 0));
  putPlayerInLane(game, 0, 2, 13200);
  game.key('ArrowUp'); game.advance(.15);
  assert.equal(game.state().collisionCount, 1);
  assert.equal(game.elements.get('impact-flash').style.opacity, 0);
  assert.equal(game.elements.get('collision-notice').hidden, false);
  game.key('Escape');
  const snapshot = JSON.stringify({ state: game.state(), traffic: game.traffic });
  game.advance(2);
  assert.equal(JSON.stringify({ state: game.state(), traffic: game.traffic }), snapshot);
  game.key('Escape');
  putPlayerInLane(game, 3000, 1, game.state().speed);
  game.key('ArrowUp'); game.advance(1.2);
  assert(game.state().speed > 6500, 'the player can accelerate again after clearing the collision');
  assert.equal(game.elements.get('collision-notice').hidden, true);
  assert.equal(game.state().collisionCount, 1);
});
