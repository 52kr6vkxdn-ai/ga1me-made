// ============================================================
// BULLET SCRIPT
// Attach this to your Bullet sprite asset.
// Works with the Gun script and PlatformerPlayer.
//
// HOW TO USE:
//   Spawn via spawnObject("Bullet", x, y, (b) => { b.velocityX = 20; })
//   The spawner sets velocityX/Y before this script's onStart runs,
//   so the bullet travels in whatever direction you set.
//
// WHAT IT DOES:
//   - Auto-destroys after LIFETIME seconds
//   - Damages "enemy" tagged objects on collision
//   - Destroys on hitting walls (anything not a bullet or player)
// ============================================================

var LIFETIME = 2.0;   // seconds before auto-destroy
var DAMAGE   = 1;     // damage dealt to enemies

var life = 0;

onStart(() => {
  setTag("bullet");
  life = LIFETIME;
});

onUpdate((dt) => {
  life -= dt;
  if (life <= 0) destroy();
});

onCollisionEnter((other) => {
  if (!other) return;

  if (other.hasTag("enemy")) {
    other.takeDamage(DAMAGE);
    other.hitFlash("#ff4444", 0.15);
    destroy();
    return;
  }

  // Destroy on walls/terrain — ignore other bullets and the player
  if (!other.hasTag("bullet") && !other.hasTag("player")) {
    destroy();
  }
});
