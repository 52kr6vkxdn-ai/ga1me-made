// ============================================================
// DESTROYER — removes this object after LIFETIME seconds.
// Fades out near the end. Perfect for bullets, VFX.
// ============================================================

var LIFETIME   = 3.0;   // seconds until removed
var FADE_START = 0.8;   // seconds before death to begin fading

var elapsed = 0;

onStart(() => {
  elapsed = 0;
  setAlpha(1);
});

onUpdate((dt) => {
  elapsed = elapsed + dt;

  if (elapsed > LIFETIME - FADE_START) {
    var t = clamp((LIFETIME - elapsed) / FADE_START, 0, 1);
    setAlpha(t);
  }

  if (elapsed >= LIFETIME) destroySelf();
});
