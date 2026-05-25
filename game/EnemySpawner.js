// ============================================================
// ENEMY SPAWNER  (efficient edge-based spawning)
// Attach to any object in your scene.
//
// Spawns copies of an object named "Enemy" from random
// screen edges. Uses a simple active-count cap so you never
// get more than MAX_ALIVE enemies at once.
//
// Pair with the ChaseAI or Enemy script on your Enemy template.
// ============================================================

var INTERVAL   = 2.5;   // seconds between spawn attempts
var MAX_ALIVE  = 8;     // hard cap — won't spawn if at limit
var SPAWN_DIST = 8;     // world units from centre to spawn at

onStart(() => {
  sceneVar.enemyCount = 0;
  log("EnemySpawner ready. Template object must be named 'Enemy'.");

  repeat(INTERVAL, () => {
    // Respect the cap
    if ((sceneVar.enemyCount || 0) >= MAX_ALIVE) return;

    // Pick a random point on the edge of a circle around the scene centre
    var angle = rand(0, PI * 2);
    var sx = cos(angle) * SPAWN_DIST;
    var sy = sin(angle) * SPAWN_DIST;

    spawnObject("Enemy", sx, sy, (e) => {
      e.setTag("enemy");
      sceneVar.enemyCount = (sceneVar.enemyCount || 0) + 1;
    });
  });
});
