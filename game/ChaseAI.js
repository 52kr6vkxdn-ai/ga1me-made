// ============================================================
// CHASE AI
// Moves toward the object tagged "player".
// Deals damage on contact, then destroys itself.
// Works standalone or spawned by EnemySpawner.
// ============================================================

var SPEED        = 2.5;
var DAMAGE       = 1;
var MELEE_DIST   = 0.45;   // world units — deal damage when this close
var WANDER_SPEED = 1.2;    // speed when no player found

var wanderAngle = 0;

onStart(() => {
  setTag("Enemy");
  setHealth(3);
  setMaxHealth(3);
  wanderAngle = rand(0, PI * 2);
});

onUpdate((dt) => {
  var target = findWithTag("player");

  if (!target) {
    // Wander randomly when there is no player
    wanderAngle += rand(-40, 40) * dt;
    move(cos(wanderAngle) * WANDER_SPEED * dt,
         sin(wanderAngle) * WANDER_SPEED * dt);
    return;
  }

  var tx = target.x;
  var ty = target.y;
  var d  = distanceTo(target);

  if (d < MELEE_DIST) {
    // Melee hit
    target.takeDamage(DAMAGE);
    hitFlash("#ff4444", 0.15);
    sceneVar.enemyCount = max(0, (sceneVar.enemyCount || 1) - 1);
    destroy();
    return;
  }

  // Move toward player
  var nx = (tx - getX()) / d;
  var ny = (ty - getY()) / d;
  move(nx * SPEED * dt, ny * SPEED * dt);
});

onDamage((amount) => {
  hitFlash("#ff6600", 0.1);
});

onDeath(() => {
  sceneVar.score      = (sceneVar.score || 0) + 10;
  sceneVar.enemyCount = max(0, (sceneVar.enemyCount || 1) - 1);
  destroy();
});
// ============================================================
// OSCILLATOR — bobs this object smoothly with a sine wave.
// Great for: floating platforms, coins, decorative elements.
// ============================================================

