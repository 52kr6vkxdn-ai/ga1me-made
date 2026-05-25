// ============================================================
// HEALTH SYSTEM
// Gives any object hitpoints, invincibility frames, and death.
//
// From another script:
//   sendMessage("player", "takeDamage", 1)
//   sendMessage("player", "heal", 2)
// ============================================================

var MAX_HP   = 10;
var I_FRAMES = 1.0;   // invincibility seconds after being hit

onStart(() => {
  setHealth(MAX_HP);
  setMaxHealth(MAX_HP);
  setAlpha(1);
  log("HealthSystem ready — HP: " + MAX_HP);
});

onDamage((amount) => {
  hitFlash("#ff4444", 0.12);
  cameraShake(0.15, 0.2);
  warn("Took " + amount + " dmg — HP: " + health + "/" + MAX_HP);
});

onDeath(() => {
  log("Died!");
  broadcastAll("entityDied");
  destroy();
});

onMessage("takeDamage", (amount) => {
  takeDamage(amount || 1);
});

onMessage("heal", (amount) => {
  heal(amount || 1);
  setAlpha(1);
  log("Healed — HP: " + health + "/" + MAX_HP);
});
