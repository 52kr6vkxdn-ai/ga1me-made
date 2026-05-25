// ============================================================
// GUN SCRIPT
// Attach to any sprite to make it a gun.
// Rotates to face the mouse and fires Bullet objects.
//
// SETUP:
//   1. Add a sprite to your scene (this is the gun).
//   2. Attach this script to it.
//   3. In your project, create a small sprite asset named "Bullet"
//      and attach the Bullet script to it.
//
// HOW BULLETS WORK:
//   spawnObject("Bullet", x, y) creates a full copy of your Bullet
//   asset — including its script — so onCollisionEnter, damage,
//   and lifetime all work exactly as written in the Bullet script.
// ============================================================

var BULLET_SPEED = 20;     // world units per second
var FIRE_RATE    = 0.15;   // seconds between shots
var AUTO_FIRE    = false;  // true = hold mouse to fire, false = click

var cooldown = 0;

onStart(() => {
  setTag("gun");
  log("Gun ready — aim with mouse, " + (AUTO_FIRE ? "hold" : "click") + " to fire");
});

onUpdate((dt) => {
  cooldown = max(0, cooldown - dt);

  // Rotate to face mouse
  var angle = angleTo(getX(), getY(), mouseX(), mouseY());
  setRotation(-angle);
  setScaleY(mouseX() < getX() ? -abs(getScaleY()) : abs(getScaleY()));

  // Fire
  var wantFire = AUTO_FIRE ? mouseDown() : mouseJustDown();
  if (wantFire && cooldown <= 0) {
    var rad = (angle * PI) / 180;
    // Spawn at muzzle tip, half a unit in front
    var bx = getX() + cos(rad) * 0.6;
    var by = getY() + sin(rad) * 0.6;

    // spawnObject runs the Bullet script — all collision + lifetime logic works
    spawnObject("Bullet", bx, by, (b) => {
      b.velocityX = cos(rad) * BULLET_SPEED;
      b.velocityY = sin(rad) * BULLET_SPEED;
      b.setRotation(-angle);
    });

    hitFlash("#ffffff", 0.06);
    cooldown = FIRE_RATE;
  }
});

onStop(() => { cooldown = 0; });
