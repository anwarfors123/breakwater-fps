// The buy menu: a grid of real buttons, one per purchase, rebuilt from the weapon table on every
// open. It lives apart from the HUD so the HUD keeps to the readouts and this file to the shop.
const $ = (id) => document.getElementById(id);

export function createBuyMenu() {
  const panel = $('buy');
  const grid = $('buy-grid');
  const moneyEl = $('buy-money');
  const hintEl = $('buy-hint');

  /** One row of the grid: key, name, slot, numbers, price. */
  function row({ id, key, name, slot, stat, price, disabled }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-item';
    button.dataset.weapon = id;
    button.disabled = disabled;
    button.innerHTML = `
        <span class="buy-key">${key}</span>
        <span class="buy-name">${name}</span>
        <span class="buy-slot">${slot}</span>
        <span class="buy-stat">${stat}</span>
        <span class="buy-price">${price}</span>`;
    grid.appendChild(button);
  }

  /** Open the shop: guns, vest, frag, each greyed out when it is out of reach. */
  function show(weapons, money, armourOwned, fragOwned = 0) {
    grid.innerHTML = '';
    for (const w of weapons) {
      row({
        id: w.id,
        key: w.key,
        name: w.name,
        slot: w.slot === 'primary' ? 'Primary' : 'Sidearm',
        stat: `${w.damage} dmg · ${Math.round(60 / w.rate)} rpm`,
        price: w.price === 0 ? 'Free' : `$${w.price.toLocaleString('en-US')}`,
        disabled: money < w.price,
      });
    }
    row({
      id: 'bastion',
      key: '5',
      name: 'Bastion',
      slot: 'Armour',
      stat: '100 points · absorbs body shots',
      price: '$650',
      disabled: money < 650 || armourOwned >= 100,
    });
    row({
      id: 'frag',
      key: '6',
      name: 'Frag',
      slot: 'Gear',
      stat: '118 blast · 5 m · thrown on G',
      price: '$300',
      disabled: money < 300 || fragOwned >= 1,
    });
    panel.hidden = false;
  }

  function hide() {
    panel.hidden = true;
  }

  /** The balance, printed inside the shop too. */
  function setMoney(amount) {
    if (moneyEl) moneyEl.textContent = `$${Math.round(amount).toLocaleString('en-US')}`;
  }

  /** One line under the grid: what the last attempt did. */
  function hint(text, tone = '') {
    if (!hintEl) return;
    hintEl.textContent = text ?? '';
    hintEl.dataset.tone = tone;
  }

  return { show, hide, setMoney, hint, grid };
}
