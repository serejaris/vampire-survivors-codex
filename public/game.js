const UPGRADE_POOL = [
  {
    id: "damage",
    title: "Blood Sharpening",
    description: "+20% урона снарядов.",
    apply: (game) => {
      game.projectileDamage *= 1.2;
    }
  },
  {
    id: "attack-speed",
    title: "Rapid Ritual",
    description: "-15% перезарядки авто-атаки.",
    apply: (game) => {
      game.fireCooldown = Math.max(0.08, game.fireCooldown * 0.85);
    }
  },
  {
    id: "speed",
    title: "Shadow Step",
    description: "+12% скорости передвижения.",
    apply: (game) => {
      game.player.speed *= 1.12;
    }
  },
  {
    id: "vitality",
    title: "Dark Vitality",
    description: "+25 к максимуму HP и мгновенное лечение на 25.",
    apply: (game) => {
      game.player.maxHp += 25;
      game.player.hp = Math.min(game.player.maxHp, game.player.hp + 25);
    }
  },
  {
    id: "pierce",
    title: "Piercing Moon",
    description: "Снаряды пробивают на 1 цель больше.",
    apply: (game) => {
      game.projectilePierce += 1;
    }
  },
  {
    id: "burst",
    title: "Crimson Burst",
    description: "Мгновенный круговой залп из 12 снарядов.",
    apply: (game) => {
      for (let i = 0; i < 12; i += 1) {
        const angle = (Math.PI * 2 * i) / 12;
        game.spawnProjectile(angle, 0.85);
      }
    }
  }
];

class SurvivorGame {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.width = this.canvas.width;
    this.height = this.canvas.height;

    this.scoreValue = document.getElementById("scoreValue");
    this.timeValue = document.getElementById("timeValue");
    this.hpValue = document.getElementById("hpValue");
    this.levelValue = document.getElementById("levelValue");

    this.startOverlay = document.getElementById("startOverlay");
    this.startButton = document.getElementById("startButton");
    this.upgradeOverlay = document.getElementById("upgradeOverlay");
    this.upgradeChoices = document.getElementById("upgradeChoices");
    this.gameOverOverlay = document.getElementById("gameOverOverlay");
    this.finalStats = document.getElementById("finalStats");
    this.scoreForm = document.getElementById("scoreForm");
    this.nicknameInput = document.getElementById("nicknameInput");
    this.submitStatus = document.getElementById("submitStatus");
    this.restartButton = document.getElementById("restartButton");
    this.refreshLeaderboardButton = document.getElementById("refreshLeaderboard");
    this.leaderboardBody = document.getElementById("leaderboardBody");

    this.keys = new Set();
    this.lastFrameTime = 0;

    this.attachEvents();
    this.resetRunState();
    this.loadLeaderboard();
    requestAnimationFrame((timestamp) => this.loop(timestamp));
  }

  attachEvents() {
    window.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) {
        event.preventDefault();
      }

      const key = event.key.toLowerCase();

      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
        this.keys.add(key);
      }

      if (key === "enter" && this.state !== "running") {
        this.startRun();
      }
    });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.key.toLowerCase());
    });

    this.startButton.addEventListener("click", () => this.startRun());
    this.restartButton.addEventListener("click", () => this.startRun());
    this.refreshLeaderboardButton.addEventListener("click", () => this.loadLeaderboard());
    this.scoreForm.addEventListener("submit", (event) => this.handleScoreSubmit(event));
  }

  resetRunState() {
    this.state = "idle";
    this.player = {
      x: this.width / 2,
      y: this.height / 2,
      radius: 14,
      speed: 240,
      hp: 100,
      maxHp: 100,
      hitCooldown: 0
    };

    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];

    this.elapsedSeconds = 0;
    this.score = 0;
    this.level = 1;
    this.nextUpgradeAt = 18;
    this.spawnInterval = 1.1;
    this.spawnTimer = 0.4;
    this.fireCooldown = 0.32;
    this.fireTimer = 0;
    this.projectileSpeed = 500;
    this.projectileDamage = 28;
    this.projectilePierce = 1;

    this.submitStatus.textContent = "";
    this.submitStatus.className = "";
    this.updateHUD();
  }

  startRun() {
    this.resetRunState();
    this.state = "running";
    this.lastFrameTime = 0;
    this.startOverlay.classList.add("hidden");
    this.gameOverOverlay.classList.add("hidden");
    this.upgradeOverlay.classList.add("hidden");
    this.nicknameInput.value = "";
  }

  loop(timestamp) {
    if (!this.lastFrameTime) {
      this.lastFrameTime = timestamp;
    }

    const delta = Math.min((timestamp - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = timestamp;

    if (this.state === "running") {
      this.update(delta);
    }

    this.render();
    requestAnimationFrame((nextTime) => this.loop(nextTime));
  }

  update(delta) {
    this.elapsedSeconds += delta;
    this.score += delta * (2 + this.level * 0.8);

    this.player.hitCooldown = Math.max(0, this.player.hitCooldown - delta);
    this.movePlayer(delta);

    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0) {
      const count = 1 + Math.floor(this.elapsedSeconds / 26);
      for (let i = 0; i < count; i += 1) {
        this.spawnEnemy();
      }

      this.spawnInterval = Math.max(0.22, 1.1 - this.elapsedSeconds * 0.015);
      this.spawnTimer = this.spawnInterval;
    }

    this.fireTimer -= delta;
    if (this.fireTimer <= 0) {
      this.autoShoot();
      this.fireTimer = this.fireCooldown;
    }

    this.updateProjectiles(delta);
    this.updateEnemies(delta);
    this.updatePickups(delta);
    this.resolveCollisions();
    this.tryOpenUpgrade();

    if (this.player.hp <= 0) {
      this.finishRun();
    }

    this.updateHUD();
  }

  movePlayer(delta) {
    let moveX = 0;
    let moveY = 0;

    if (this.keys.has("w") || this.keys.has("arrowup")) {
      moveY -= 1;
    }
    if (this.keys.has("s") || this.keys.has("arrowdown")) {
      moveY += 1;
    }
    if (this.keys.has("a") || this.keys.has("arrowleft")) {
      moveX -= 1;
    }
    if (this.keys.has("d") || this.keys.has("arrowright")) {
      moveX += 1;
    }

    if (moveX !== 0 || moveY !== 0) {
      const magnitude = Math.hypot(moveX, moveY);
      moveX /= magnitude;
      moveY /= magnitude;
    }

    this.player.x += moveX * this.player.speed * delta;
    this.player.y += moveY * this.player.speed * delta;

    this.player.x = clamp(this.player.x, this.player.radius, this.width - this.player.radius);
    this.player.y = clamp(this.player.y, this.player.radius, this.height - this.player.radius);
  }

  spawnEnemy() {
    const side = Math.floor(Math.random() * 4);
    const margin = 30;
    let x = 0;
    let y = 0;

    if (side === 0) {
      x = Math.random() * this.width;
      y = -margin;
    } else if (side === 1) {
      x = this.width + margin;
      y = Math.random() * this.height;
    } else if (side === 2) {
      x = Math.random() * this.width;
      y = this.height + margin;
    } else {
      x = -margin;
      y = Math.random() * this.height;
    }

    const elapsedFactor = 1 + this.elapsedSeconds / 100;
    const isElite = Math.random() < Math.min(0.22, this.elapsedSeconds / 200);
    const baseRadius = isElite ? 23 : 14;

    this.enemies.push({
      x,
      y,
      radius: baseRadius + Math.random() * 3,
      hp: (isElite ? 95 : 36) * elapsedFactor,
      maxHp: (isElite ? 95 : 36) * elapsedFactor,
      speed: (isElite ? 55 : 85) + this.elapsedSeconds * 0.35 + Math.random() * 18,
      damage: isElite ? 22 : 10,
      scoreValue: isElite ? 55 : 18
    });
  }

  autoShoot() {
    if (this.enemies.length === 0) {
      return;
    }

    let nearestEnemy = this.enemies[0];
    let nearestDistance = distanceSquared(this.player, nearestEnemy);

    for (let i = 1; i < this.enemies.length; i += 1) {
      const candidate = this.enemies[i];
      const candidateDistance = distanceSquared(this.player, candidate);

      if (candidateDistance < nearestDistance) {
        nearestDistance = candidateDistance;
        nearestEnemy = candidate;
      }
    }

    const angle = Math.atan2(nearestEnemy.y - this.player.y, nearestEnemy.x - this.player.x);
    this.spawnProjectile(angle, 1);
  }

  spawnProjectile(angle, damageMultiplier) {
    this.projectiles.push({
      x: this.player.x,
      y: this.player.y,
      radius: 4,
      vx: Math.cos(angle) * this.projectileSpeed,
      vy: Math.sin(angle) * this.projectileSpeed,
      damage: this.projectileDamage * damageMultiplier,
      life: 1.4,
      pierceLeft: this.projectilePierce
    });
  }

  updateProjectiles(delta) {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];

      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;
      projectile.life -= delta;

      const outOfBounds =
        projectile.x < -20 ||
        projectile.x > this.width + 20 ||
        projectile.y < -20 ||
        projectile.y > this.height + 20;

      if (projectile.life <= 0 || outOfBounds) {
        this.projectiles.splice(index, 1);
      }
    }
  }

  updateEnemies(delta) {
    for (const enemy of this.enemies) {
      const angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
      enemy.x += Math.cos(angle) * enemy.speed * delta;
      enemy.y += Math.sin(angle) * enemy.speed * delta;
    }
  }

  updatePickups(delta) {
    for (let index = this.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.pickups[index];
      pickup.life -= delta;

      if (pickup.life <= 0) {
        this.pickups.splice(index, 1);
      }
    }
  }

  resolveCollisions() {
    for (let projectileIndex = this.projectiles.length - 1; projectileIndex >= 0; projectileIndex -= 1) {
      const projectile = this.projectiles[projectileIndex];
      let projectileRemoved = false;

      for (let enemyIndex = this.enemies.length - 1; enemyIndex >= 0; enemyIndex -= 1) {
        const enemy = this.enemies[enemyIndex];
        const hitDistance = projectile.radius + enemy.radius;

        if (distanceSquared(projectile, enemy) > hitDistance * hitDistance) {
          continue;
        }

        enemy.hp -= projectile.damage;
        projectile.pierceLeft -= 1;

        if (enemy.hp <= 0) {
          this.score += enemy.scoreValue;
          this.enemies.splice(enemyIndex, 1);

          if (Math.random() < 0.45) {
            this.pickups.push({
              x: enemy.x,
              y: enemy.y,
              radius: 5,
              value: 12,
              life: 8
            });
          }
        }

        if (projectile.pierceLeft <= 0) {
          this.projectiles.splice(projectileIndex, 1);
          projectileRemoved = true;
          break;
        }
      }

      if (projectileRemoved) {
        continue;
      }
    }

    for (const enemy of this.enemies) {
      const touchingDistance = this.player.radius + enemy.radius;
      if (distanceSquared(enemy, this.player) <= touchingDistance * touchingDistance && this.player.hitCooldown <= 0) {
        this.player.hp -= enemy.damage;
        this.player.hitCooldown = 0.4;
      }
    }

    for (let index = this.pickups.length - 1; index >= 0; index -= 1) {
      const pickup = this.pickups[index];
      const collectDistance = this.player.radius + pickup.radius;
      if (distanceSquared(pickup, this.player) <= collectDistance * collectDistance) {
        this.score += pickup.value;
        this.pickups.splice(index, 1);
      }
    }
  }

  tryOpenUpgrade() {
    if (this.elapsedSeconds < this.nextUpgradeAt) {
      return;
    }

    this.level += 1;
    this.nextUpgradeAt += 18 + Math.min(10, this.level * 0.7);
    this.state = "paused";
    this.upgradeOverlay.classList.remove("hidden");
    this.renderUpgradeChoices();
  }

  renderUpgradeChoices() {
    const variants = pickRandom(UPGRADE_POOL, 3);
    this.upgradeChoices.innerHTML = "";

    for (const option of variants) {
      const button = document.createElement("button");
      button.className = "upgrade-choice";
      button.type = "button";
      button.innerHTML = `<h3>${option.title}</h3><p>${option.description}</p>`;

      button.addEventListener("click", () => {
        option.apply(this);
        this.upgradeOverlay.classList.add("hidden");
        this.state = "running";
      });

      this.upgradeChoices.appendChild(button);
    }
  }

  finishRun() {
    this.state = "gameover";
    this.gameOverOverlay.classList.remove("hidden");
    const finalScore = Math.floor(this.score);
    const finalTime = Math.floor(this.elapsedSeconds);
    this.finalStats.textContent = `Score: ${finalScore} · Time: ${finalTime}s`;
  }

  async handleScoreSubmit(event) {
    event.preventDefault();

    if (this.state !== "gameover") {
      return;
    }

    const nickname = this.nicknameInput.value.trim();
    if (nickname.length < 2) {
      this.setSubmitStatus("Минимум 2 символа в нике.", true);
      return;
    }

    const payload = {
      nickname,
      score: Math.floor(this.score),
      survivedSeconds: Math.floor(this.elapsedSeconds)
    };

    this.setSubmitStatus("Сохраняю результат...", false);

    try {
      const response = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Не удалось сохранить score.");
      }

      this.setSubmitStatus(
        `Сохранено. Твой рейтинг: ${result.player.rating}. Лучший ран: ${result.player.best_score}.`,
        false
      );
      this.renderLeaderboard(result.leaderboard);
    } catch (error) {
      this.setSubmitStatus(error.message, true);
    }
  }

  setSubmitStatus(text, isError) {
    this.submitStatus.textContent = text;
    this.submitStatus.className = isError ? "error" : "success";
  }

  async loadLeaderboard() {
    try {
      const response = await fetch("/api/leaderboard?limit=25");
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to load leaderboard.");
      }

      this.renderLeaderboard(result.leaderboard);
    } catch (error) {
      this.leaderboardBody.innerHTML = `<tr><td colspan="5">${error.message}</td></tr>`;
    }
  }

  renderLeaderboard(items) {
    if (!Array.isArray(items) || items.length === 0) {
      this.leaderboardBody.innerHTML = `<tr><td colspan="5">No scores yet.</td></tr>`;
      return;
    }

    this.leaderboardBody.innerHTML = "";

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const row = document.createElement("tr");

      row.appendChild(createCell(String(index + 1)));
      row.appendChild(createCell(item.nickname));
      row.appendChild(createCell(formatInteger(item.rating)));
      row.appendChild(createCell(formatInteger(item.best_score)));
      row.appendChild(createCell(formatInteger(item.runs_count)));

      this.leaderboardBody.appendChild(row);
    }
  }

  updateHUD() {
    this.scoreValue.textContent = formatInteger(Math.floor(this.score));
    this.timeValue.textContent = `${Math.floor(this.elapsedSeconds)}s`;
    this.hpValue.textContent = String(Math.max(0, Math.floor(this.player.hp)));
    this.levelValue.textContent = String(this.level);
  }

  render() {
    const ctx = this.ctx;

    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop();

    for (const pickup of this.pickups) {
      ctx.fillStyle = "#88f7b5";
      ctx.beginPath();
      ctx.arc(pickup.x, pickup.y, pickup.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const projectile of this.projectiles) {
      ctx.fillStyle = "#f8b132";
      ctx.beginPath();
      ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const enemy of this.enemies) {
      const hpRatio = enemy.hp / enemy.maxHp;
      ctx.fillStyle = hpRatio < 0.35 ? "#d93850" : "#b90f2b";
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = this.player.hitCooldown > 0 ? "#ffe6ec" : "#d8f1ff";
    ctx.beginPath();
    ctx.arc(this.player.x, this.player.y, this.player.radius, 0, Math.PI * 2);
    ctx.fill();

    this.drawPlayerHealthBar();
  }

  drawBackdrop() {
    const ctx = this.ctx;
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, "#061227");
    gradient.addColorStop(1, "#02060f");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = "rgba(180, 210, 255, 0.08)";
    ctx.lineWidth = 1;

    for (let x = 0; x <= this.width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.height);
      ctx.stroke();
    }

    for (let y = 0; y <= this.height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
  }

  drawPlayerHealthBar() {
    const ctx = this.ctx;
    const ratio = this.player.hp / this.player.maxHp;
    const barWidth = 78;
    const x = this.player.x - barWidth / 2;
    const y = this.player.y - this.player.radius - 13;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(x, y, barWidth, 6);
    ctx.fillStyle = ratio > 0.35 ? "#55e697" : "#ff596c";
    ctx.fillRect(x, y, barWidth * clamp(ratio, 0, 1), 6);
  }
}

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  return cell;
}

function pickRandom(list, count) {
  const source = [...list];
  const result = [];

  while (result.length < count && source.length > 0) {
    const index = Math.floor(Math.random() * source.length);
    result.push(source[index]);
    source.splice(index, 1);
  }

  return result;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function formatInteger(value) {
  return Number(value || 0).toLocaleString("ru-RU");
}

new SurvivorGame();
