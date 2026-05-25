// ============================================================
// SCENE MANAGER
// Attach to any persistent object (e.g. a UI overlay sprite).
//
// From other scripts:
//   sceneVar.score += 10;
//   sendMessage("scenemanager", "nextScene");
//   sendMessage("scenemanager", "restartScene");
//   sendMessage("scenemanager", "gotoScene", "Level2");
//   sendMessage("scenemanager", "addScore",  10);
//   sendMessage("scenemanager", "loseLife");
// ============================================================

onStart(() => {
  setTag("scenemanager");

  sceneVar.score  = sceneVar.score  || 0;
  sceneVar.lives  = sceneVar.lives  || 3;
  sceneVar.paused = false;

  globalVar.highScore = globalVar.highScore || 0;

  log("Scene: " + currentScene() +
      "  Score: " + sceneVar.score +
      "  Lives: " + sceneVar.lives);
});

onUpdate((dt) => {
  // Keep high score up to date
  if (sceneVar.score > (globalVar.highScore || 0)) {
    globalVar.highScore = sceneVar.score;
  }
});

onMessage("nextScene", () => {
  var next = currentSceneIndex() + 1;
  if (next < sceneCount()) gotoScene(next);
  else { log("No more scenes! Final score: " + sceneVar.score); broadcastAll("gameComplete"); }
});

onMessage("restartScene", () => {
  gotoScene(currentSceneIndex());
});

onMessage("gotoScene", (nameOrIndex) => {
  gotoScene(nameOrIndex);
});

onMessage("addScore", (amount) => {
  sceneVar.score = sceneVar.score + (amount || 1);
  log("Score: " + sceneVar.score);
});

onMessage("loseLife", () => {
  sceneVar.lives = sceneVar.lives - 1;
  warn("Lives remaining: " + sceneVar.lives);
  if (sceneVar.lives <= 0) {
    broadcastAll("gameOver");
    log("GAME OVER — final score: " + sceneVar.score);
  }
});

onMessage("entityDied", () => {
  sceneVar.score = sceneVar.score + 5;
});
