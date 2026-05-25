// ============================================================
// PLATFORMER PLAYER  (with shooting gun)
// Requires: Kinematic physics body on this object.
//           A tilemap or static floor below to land on.
//
// Controls:
//   A / D  or Left/Right    move
//   W / Space / Up          jump
//   Left click / F          shoot  (needs a "Bullet" asset)
// ============================================================

var SPEED          = 5;      // world units / sec
var JUMP_FORCE     = 12;     // upward velocity on jump
var GRAVITY        = -28;    // downward accel per sec²
var MAX_FALL       = -20;    // terminal velocity
var COYOTE_TIME    = 0.12;   // grace period to jump after walking off edge
var BULLET_SPEED   = 18;     // bullet units / sec
var SHOOT_COOLDOWN = 0.18;   // min seconds between shots

var grounded   = false;
var coyote     = 0;
var facing     = 1;          // 1 = right, -1 = left
var shootTimer = 0;

onStart(() => {
  setTag("player");
  cameraFollow(findWithTag("player"), 7);
  log("Platformer: A/D move  W/Space jump  click/F shoot");
});

onUpdate((dt) => {
  // ── Gravity ────────────────────────────────────────────────
  velocityY = velocityY + GRAVITY * dt;
  if (velocityY < MAX_FALL) velocityY = MAX_FALL;

  // ── Horizontal ─────────────────────────────────────────────
  var h = axisH();
  velocityX = h * SPEED;
  if (h > 0)  { facing =  1; setScaleX( 1); }
  if (h < 0)  { facing = -1; setScaleX(-1); }

  // ── Coyote time + jump ─────────────────────────────────────
  coyote = max(0, coyote - dt);
  if (isKeyJustDown("w") || isKeyJustDown("arrowup") || isKeyJustDown(" ")) {
    if (grounded || coyote > 0) {
      velocityY = JUMP_FORCE;
      grounded  = false;
      coyote    = 0;
    }
  }

  // ── Shoot ──────────────────────────────────────────────────
  shootTimer = max(0, shootTimer - dt);
  if (shootTimer <= 0 && (mouseJustDown() || isKeyJustDown("f"))) {
    // spawnObject runs the Bullet script fully (onCollisionEnter, lifetime, damage)
    var dir = facing > 0 ? 1 : -1;
    spawnObject("Bullet", getX() + dir * 0.6, getY(), (b) => {
      b.velocityX = dir * BULLET_SPEED;
      b.velocityY = 0;
    });
    shootTimer = SHOOT_COOLDOWN;
  }

  // ── Animation ──────────────────────────────────────────────
  if (!grounded) {
    playAnimation(velocityY > 0 ? "jump" : "fall");
  } else if (abs(velocityX) > 0.1) {
    playAnimation("run");
  } else {
    playAnimation("idle");
  }
});

onCollisionEnter((other) => {
  if (!other) return;
  // Land when hitting something below us
  if (velocityY <= 0 && other.y <= getY()) {
    grounded  = true;
    coyote    = COYOTE_TIME;
    velocityY = 0;
  }
});

onCollisionExit(() => {
  if (grounded) {
    grounded = false;
    coyote   = COYOTE_TIME;
  }
});

onStop(() => { velocityX = 0; velocityY = 0; grounded = false; coyote = 0; });
