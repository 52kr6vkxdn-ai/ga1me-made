// ============================================================
// PATROL ENEMY
// Walks back and forth. Detects the player. Takes damage.
//
// Setup: Give this object a Kinematic physics body.
//        Attach HealthSystem script as well for full HP logic.
// ============================================================

var SPEED        = 2.5;
var PATROL_DIST  = 4;
var DETECT_RANGE = 4;

var startX  = 0;
var dirX    = 1;
var alerted = false;

onStart(() => {
  setTag("enemy");
  setGroup("enemies");
  startX = getX();
  setHealth(3);
  setMaxHealth(3);
  log("Patrol Enemy ready");
});

onUpdate((dt) => {
  // ── Patrol ──────────────────────────────────────────────
  velocityX = dirX * SPEED;
  setScaleX(dirX);

  if (getX() > startX + PATROL_DIST) dirX = -1;
  if (getX() < startX - PATROL_DIST) dirX =  1;

  // ── Player detection ────────────────────────────────────
  var player = findWithTag("player");
  if (player) {
    var d = distanceTo(player);
    if (d < DETECT_RANGE && !alerted) {
      alerted = true;
      broadcast("player", "enemySpotted");
    }
    if (d >= DETECT_RANGE + 1) alerted = false;
  }
});

onCollisionEnter((other) => {
  // Reverse when hitting a wall (not the player)
  if (other && !other.hasTag("player")) dirX = -dirX;
});

onDamage((amount) => {
  hitFlash("#ff4444", 0.12);
  warn("Enemy hit! HP: " + health);
});

onDeath(() => {
  sceneVar.score = (sceneVar.score || 0) + 10;
  log("Enemy defeated! Score: " + sceneVar.score);
  destroy();
});

onStop(() => {
  velocityX = 0;
  alerted   = false;
  dirX      = 1;
});
