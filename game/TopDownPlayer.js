// ============================================================
// TOP-DOWN PLAYER
// 8-directional WASD/arrows movement.
// Camera follows this object smoothly.
// Mouse rotates the player to aim.
// ============================================================

var SPEED = 5;   // world units per second

onStart(() => {
  setTag("player");
  cameraFollow(findWithTag("player"), 6);
  log("Top-Down Player ready — WASD / arrows to move, mouse to aim");
});

onUpdate((dt) => {
  // ── Movement ─────────────────────────────────────────────
  var h = axisH();
  var v = axisV();
  move(h * SPEED * dt, v * SPEED * dt);

  
});

onOverlapEnter((other) => {
  if (!other) return;
  if (other.hasTag("Enemy")) {
   
    other.destroy();
  }
});

onMessage("enemySpotted", () => {
  warn("Enemy has spotted you!");
});
