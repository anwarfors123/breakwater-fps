// The shop, as DOM. hud.js owns the vitals and the feed; this owns the buy menu only: the six rows
// (four guns, the vest, the frag), what each costs, and which ones the wallet cannot reach right
// now. Buying itself is the keyboard's job in main.js — this module never decides anything, it
// renders the state it is handed.

import { ARMOUR, GRENADE } from './weapons.js';

export function createBuyMenu() {
  const panel = document.getElementById('buy');
  const moneyLabel = document.getElementById('buy-money');
  const grid = document.getElementById('buy-grid');
  const hintLine = document.getElementById('buy-hint');

  function row(key, name, slot, stat, price, owned, affordable) {
    const item = document.createElement('div');
    item.className = 'buy-item';
    item.dataset.key = key;
    if (!affordable || owned) item.setAttribute('aria-disabled', 'true');

    const keyTag = document.createElement('span');
    keyTag.className = 'buy-key';
    keyTag.textContent = key;
    item.appendChild(keyTag);

    const nameTag = document.createElement('span');
    nameTag.className = 'buy-name';
    nameTag.textContent = name;
    item.appendChild(nameTag);

    const slotTag = document.createElement('span');
    slotTag.className = 'buy-slot';
    slotTag.textContent = slot;
    item.appendChild(slotTag);

    const statTag = document.createElement('span');
    statTag.className = 'buy-stat';
    statTag.textContent = stat;
    item.appendChild(statTag);

    const priceTag = document.createElement('span');
    priceTag.className = 'buy-price';
    priceTag.textContent = owned ? owned : `$${price}`;
    item.appendChild(priceTag);

    return item;
  }

  function setMoney(amount) {
    if (moneyLabel) moneyLabel.textContent = `$${amount}`;
  }

  /** show(weapons, money, armourOwned, fragOwned): the four guns come from main.js's BUY_LIST. */
  function show(weapons, money, armourOwned = 0, fragOwned = 0) {
    if (!panel || !grid) return;
    setMoney(money);
    grid.textContent = '';

    for (const weapon of weapons) {
      const stat = `${weapon.dmg} dmg · ${weapon.mag}/${weapon.reserve}`;
      grid.appendChild(
        row(weapon.key, weapon.name, weapon.slot, stat, weapon.price, '', money >= weapon.price),
      );
    }

    const vestText = armourOwned > 0 ? `${armourOwned} worn` : '';
    grid.appendChild(
      row('5', ARMOUR.name, 'armour', `${ARMOUR.points} points`, ARMOUR.price, vestText,
        money >= ARMOUR.price && armourOwned < ARMOUR.points),
    );

    const fragText = fragOwned > 0 ? `${fragOwned} carried` : '';
    grid.appendChild(
      row('6', GRENADE.name, 'grenade', `${GRENADE.damage} dmg · ${GRENADE.radius} m`, GRENADE.price,
        fragText, money >= GRENADE.price && fragOwned < GRENADE.max),
    );

    panel.hidden = false;
  }

  function hide() {
    if (panel) panel.hidden = true;
  }

  function hint(text, tone = '') {
    if (!hintLine) return;
    hintLine.textContent = text;
    if (tone) hintLine.dataset.tone = tone;
    else delete hintLine.dataset.tone;
  }

  return { setMoney, show, hide, hint };
}
