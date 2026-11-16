// The palette: eleven names, one source of truth. The 3D scene reads it through rgb()/shade(), and
// index.html repeats the same eleven hex values as CSS custom properties, so the world and the HUD
// cannot drift apart. Nothing else in the game hard-codes a colour.

const HEX = {
  canvas: '#12171c', surface: '#1b2229', hairline: '#2b343d',
  ink: '#e8e4dc', muted: '#8e9aa4', accent: '#f2a63b',
  dock: '#c8622f', warden: '#3f8fb0', steel: '#5a6672',
  rust: '#7a4a33', concrete: '#6e7278',
};

export const PALETTE = Object.freeze({ ...HEX });

/** The hex string behind a palette name; unknown names fall back to ink. */
export function shade(name) {
  return HEX[name] ?? HEX.ink;
}

/** A palette name unpacked to normalised channels, optionally scaled by k (lighting multipliers). */
export function rgb(name, k = 1) {
  const hex = shade(name);
  return {
    r: (parseInt(hex.slice(1, 3), 16) / 255) * k,
    g: (parseInt(hex.slice(3, 5), 16) / 255) * k,
    b: (parseInt(hex.slice(5, 7), 16) / 255) * k,
  };
}
