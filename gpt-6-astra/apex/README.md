# APEX — Endless Drive

Open `dist/index.html` in a browser to play. The entire game is one self-contained HTML file; no installation, network connection, or build is required.

- **Up arrow:** accelerate
- **Left / right arrows:** steer
- **Down arrow:** brake
- **Escape or P:** pause / resume
- Touch controls appear on mobile devices.

The four-lane road, curves, elevation, and scenery are generated from world coordinates, so there is no finish line or stored track that runs out. The car has its own position and heading: holding up drives straight, and left/right turn the car. After a turn, countersteer to line up with the road; releasing the steering key keeps your current heading. You must steer through bends. Leaving the road slows the car but does not turn it back or restrict it to the shoulder. The camera follows the car's heading. Switching away from the game pauses it automatically.

Traffic travels in all four lanes at different speeds and slows for cars ahead. Pass through the gaps. Collisions reduce your speed and show a brief warning; steer clear and accelerate to recover. Traffic keeps replenishing beyond view, and pausing freezes all cars. The camera jolt is disabled when your device prefers reduced motion.

To serve locally, run `python3 -m http.server 5173 --directory dist` from this directory and open http://localhost:5173.

Run the driving regression checks with `node --test tests/driving.test.mjs` (no dependencies required).
