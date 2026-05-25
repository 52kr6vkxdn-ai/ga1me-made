// ============================================================
// ENEMY SCRIPT
// Patrol + chase + health/death/score.
//
// Requires: Static or kinematic physics body.
//           Player tagged "player" in the scene.
// ============================================================

var MAX_HEALTH  = 3;
var MOVE_SPEED  = 2.5;
var CHASE_SPEED = 4;
var CHASE_RANGE = 8;     // start chasing within this range
var PATROL_DIST = 3;     // world units each direction before turning
var SCORE_VALUE = 10;

var startX  = 0;
var dir     = 1;
var chasing = false;

onStart(() => {
  setTag("enemy");
  startX = getX();
  setHealth(MAX_HEALTH);
  setMaxHealth(MAX_HEALTH);
  log("Enemy ready");
});

onUpdate((dt) => {
  var player = findWithTag("player");

  if (player && distanceTo(player) < CHASE_RANGE) {
    // Chase
    chasing = true;
    dir     = player.x > getX() ? 1 : -1;
    velocityX = dir * CHASE_SPEED;
  } else {
    // Patrol
    chasing   = false;
    velocityX = dir * MOVE_SPEED;
    if (getX() > startX + PATROL_DIST) dir = -1;
    if (getX() < startX - PATROL_DIST) dir =  1;
  }

  setScaleX(dir);
  playAnimation(chasing ? "run" : "walk");
});

onDamage((amount) => {
  hitFlash("#ff4444", 0.12);
  objectShake(0.15, 0.2);
});

onDeath(() => {
  sceneVar.score = (sceneVar.score || 0) + SCORE_VALUE;
  log("Enemy died. Score: " + sceneVar.score);

  // Decrement spawner count if EnemySpawner is in the scene
  sceneVar.enemyCount = max(0, (sceneVar.enemyCount || 1) - 1);

  destroy();
});

onCollisionEnter((other) => {
  // Reverse on hitting walls
  if (other && !other.hasTag("player") && !other.hasTag("enemy")) dirX = -dir;

  // Damage player on contact
  if (other && other.hasTag("player")) {
    other.takeDamage(1);
    other.knockback(other.x > getX() ? 0 : 180, 6, 0.2);
  }
});

onStop(() => {
  velocityX = 0;
  chasing   = false;
  dir       = 1;
});
