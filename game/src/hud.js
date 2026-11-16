// The HUD is DOM, not canvas: text stays crisp at any resolution, the buy menu is a real grid
// of real buttons, and the layout is CSS the browser already knows how to lay out. The scene
// renders underneath it; nothing here touches WebGL.
//
// Everything the player is told about the round passes through this file, so the vocabulary of
// the interface — Dockers and Wardens, the charge, the buy phase — lives in one place.

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    root: $('hud'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    health: $('vital-health'),
    healthBar: $('vital-health-bar'),
    armour: $('vital-armour'),
    armourBar: $('vital-armour-bar'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammoWrap: $('ammo'),
    money: $('money-value'),
    clock: $('clock-time'),
    clockPhase: $('clock-phase'),
    scoreDock: $('score-dock'),
    scoreWarden: $('score-warden'),
    roundNo: $('round-no'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    prompt: $('prompt'),
    buy: $('buy'),
    buyGrid: $('buy-grid'),
    buyMoney: $('buy-money'),
    buyHint: $('buy-hint'),
    scoreboard: $('scoreboard'),
    sbBody: $('sb-body'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    overlayButton: $('overlay-button'),
    objective: $('objective'),
    killnotice: $('killnotice'),
    grenades: $('grenades'),
  };

  let bannerTimer = 0;
  let hitTimer = 0;
  let noticeTimer = 0;

  /** A kill you made: name, headshot tag and the money it paid. */
  function killNotice(name, meta = {}) {
    if (!el.killnotice) return;
    el.killnotice.innerHTML =
      `<span class="kn-tag">${meta.headshot ? 'HEADSHOT' : 'ELIMINATED'}</span>` +
      `<span class="kn-name">${name}</span>` +
      (meta.reward ? `<span class="kn-money">+$${meta.reward}</span>` : '');
    el.killnotice.classList.add('on');
    noticeTimer = 2.2;
  }

  function setVitals(health, armour) {
    const hp = Math.max(0, Math.round(health));
    el.health.textContent = String(hp);
    el.healthBar.style.transform = `scaleX(${Math.max(0, Math.min(1, hp / 100))})`;
    el.healthBar.style.background = hp > 60 ? 'var(--ink)' : hp > 30 ? 'var(--accent)' : 'var(--dock)';
    el.armour.textContent = String(Math.max(0, Math.round(armour)));
    el.armourBar.style.transform = `scaleX(${Math.max(0, Math.min(1, armour / 100))})`;
  }

  function setAmmo(mag, reserve, weaponName, reloading) {
    el.ammoMag.textContent = String(mag);
    el.ammoReserve.textContent = `/ ${reserve}`;
    el.ammoWrap.classList.toggle('empty', mag === 0);
    el.ammoWrap.dataset.weapon = weaponName ?? '';
    el.ammoWrap.classList.toggle('reloading', Boolean(reloading));
  }

  /** How many frags are left in the pouch; the line dims to nothing when there are none. */
  function setGrenades(count) {
    if (!el.grenades) return;
    el.grenades.textContent = count > 0 ? `FRAG ${count} · G` : 'FRAG 0';
    el.grenades.classList.toggle('has', count > 0);
  }

  function setMoney(amount) {
    el.money.textContent = `$${Math.round(amount).toLocaleString('en-US')}`;
    if (el.buyMoney) el.buyMoney.textContent = `$${Math.round(amount).toLocaleString('en-US')}`;
  }

  function setClock(seconds, label) {
    const clamped = Math.max(0, seconds);
    const mm = Math.floor(clamped / 60);
    const ss = Math.floor(clamped % 60);
    el.clock.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
    el.clockPhase.textContent = label;
    el.clock.classList.toggle('urgent', clamped <= 10 && label !== 'buy');
  }

  function setScores(dock, warden, round, playerTeam) {
    el.scoreDock.textContent = String(dock);
    el.scoreWarden.textContent = String(warden);
    el.roundNo.textContent = `R${round}`;
    el.root.dataset.side = playerTeam;
    el.scoreDock.parentElement.classList.toggle('mine', playerTeam === 'dock');
    el.scoreWarden.parentElement.classList.toggle('mine', playerTeam === 'warden');
  }

  function setObjective(text, tone = '') {
    el.objective.textContent = text ?? '';
    el.objective.dataset.tone = tone;
    el.objective.hidden = !text;
  }

  function feed(text, meta = {}) {
    const row = document.createElement('div');
    row.className = 'feed-row';
    if (meta.attackerTeam) row.dataset.team = meta.attackerTeam;
    row.innerHTML = `<span class="feed-name">${text}</span>${
      meta.headshot ? '<span class="feed-tag">HS</span>' : ''
    }${meta.weaponName ? `<span class="feed-tag">${meta.weaponName}</span>` : ''}`;
    el.killfeed.prepend(row);
    while (el.killfeed.children.length > 5) el.killfeed.lastElementChild.remove();
    setTimeout(() => row.classList.add('fade'), 4200);
    setTimeout(() => row.remove(), 6200);
  }

  function banner(text, tone = '', seconds = 2.6) {
    el.banner.textContent = text;
    el.banner.dataset.tone = tone;
    el.banner.classList.add('on');
    bannerTimer = seconds;
  }

  function hitMarker(lethal) {
    el.hitmarker.classList.toggle('lethal', Boolean(lethal));
    el.hitmarker.classList.add('on');
    hitTimer = 0.12;
  }

  function setSpread(coneRadians, moving) {
    // The crosshair opens with the weapon's cone, which is the only honest readout of accuracy.
    const px = 6 + Math.min(26, coneRadians * 900);
    el.crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    el.crosshair.classList.toggle('moving', Boolean(moving));
  }

  function setPrompt(text) {
    el.prompt.textContent = text ?? '';
    el.prompt.hidden = !text;
  }

  function showBuy(weapons, money, armourOwned, fragOwned = 0) {
    el.buyGrid.innerHTML = '';
    for (const w of weapons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item';
      button.dataset.weapon = w.id;
      const affordable = money >= w.price;
      button.disabled = !affordable;
      button.innerHTML = `
        <span class="buy-key">${w.key}</span>
        <span class="buy-name">${w.name}</span>
        <span class="buy-slot">${w.slot === 'primary' ? 'Primary' : 'Sidearm'}</span>
        <span class="buy-stat">${w.damage} dmg · ${Math.round(60 / w.rate)} rpm</span>
        <span class="buy-price">${w.price === 0 ? 'Free' : `$${w.price.toLocaleString('en-US')}`}</span>`;
      el.buyGrid.appendChild(button);
    }
    const vest = document.createElement('button');
    vest.type = 'button';
    vest.className = 'buy-item';
    vest.dataset.weapon = 'bastion';
    vest.disabled = money < 650 || armourOwned >= 100;
    vest.innerHTML = `
      <span class="buy-key">5</span>
      <span class="buy-name">Bastion</span>
      <span class="buy-slot">Armour</span>
      <span class="buy-stat">100 points · absorbs body shots</span>
      <span class="buy-price">$650</span>`;
    el.buyGrid.appendChild(vest);
    const frag = document.createElement('button');
    frag.type = 'button';
    frag.className = 'buy-item';
    frag.dataset.weapon = 'frag';
    frag.disabled = money < 300 || fragOwned >= 1;
    frag.innerHTML = `
      <span class="buy-key">6</span>
      <span class="buy-name">Frag</span>
      <span class="buy-slot">Gear</span>
      <span class="buy-stat">118 blast · 5 m · thrown on G</span>
      <span class="buy-price">$300</span>`;
    el.buyGrid.appendChild(frag);
    el.buy.hidden = false;
  }

  function hideBuy() {
    el.buy.hidden = true;
  }

  function buyHint(text, tone = '') {
    el.buyHint.textContent = text ?? '';
    el.buyHint.dataset.tone = tone;
  }

  function showScoreboard(rows, scores) {
    el.sbBody.innerHTML = rows
      .map(
        (r) => `<tr class="${r.team}${r.alive ? '' : ' dead'}">
          <td>${r.name}${r.me ? ' <span class="me">you</span>' : ''}</td>
          <td>${r.team === 'dock' ? 'Dockers' : 'Wardens'}</td>
          <td>${r.kills}</td>
          <td>${r.deaths}</td>
          <td>${r.alive ? '<span class="up">up</span>' : '<span class="down">down</span>'}</td>
        </tr>`,
      )
      .join('');
    el.scoreboard.hidden = false;
    el.scoreboard.dataset.dock = String(scores.dock);
    el.scoreboard.dataset.warden = String(scores.warden);
  }

  function hideScoreboard() {
    el.scoreboard.hidden = true;
  }

  function showOverlay(title, copy, button) {
    el.overlayTitle.textContent = title;
    el.overlayCopy.textContent = copy;
    el.overlayButton.textContent = button;
    el.overlay.hidden = false;
  }

  function hideOverlay() {
    el.overlay.hidden = true;
  }

  function onOverlayClick(handler) {
    el.overlayButton.addEventListener('click', handler);
  }

  /** Called every rendered frame; owns the short-lived elements' clocks. */
  function tick(dt) {
    if (hitTimer > 0) {
      hitTimer -= dt;
      if (hitTimer <= 0) el.hitmarker.classList.remove('on');
    }
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) el.banner.classList.remove('on');
    }
    if (noticeTimer > 0) {
      noticeTimer -= dt;
      if (noticeTimer <= 0) el.killnotice?.classList.remove('on');
    }
  }

  return {
    el,
    setVitals,
    setAmmo,
    setMoney,
    setGrenades,
    setClock,
    setScores,
    setObjective,
    feed,
    banner,
    killNotice,
    hitMarker,
    setSpread,
    setPrompt,
    showBuy,
    hideBuy,
    buyHint,
    showScoreboard,
    hideScoreboard,
    showOverlay,
    hideOverlay,
    onOverlayClick,
    tick,
  };
}
