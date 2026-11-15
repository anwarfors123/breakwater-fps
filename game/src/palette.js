// The look plan, in one place: one canvas, one surface, two team hues and a single accent.
// Every colour the 3D scene and the HUD use comes from here, so the game reads as one object
// and not a pile of borrowed parts. The same names are CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#12171c',
  surface: '#1b2229',
  hairline: '#2b343d',
  ink: '#e8e4dc',
  muted: '#8e9aa4',
  accent: '#f2a63b',
  dock: '#c8622f', // Dockers, the attacking side
  warden: '#3f8fb0', // Wardens, the defending side
  steel: '#5a6672',
  rust: '#7a4a33',
  concrete: '#6e7278',
};

export function shade(name) {
  return PALETTE[name] ?? PALETTE.ink;
}

/** Unpack a palette hex into normalised rgb, optionally darkened (k < 1) for depth. */
export function rgb(name, k = 1) {
  const n = Number.parseInt(shade(name).slice(1), 16);
  return {
    r: Math.min(1, (((n >> 16) & 255) / 255) * k),
    g: Math.min(1, (((n >> 8) & 255) / 255) * k),
    b: Math.min(1, ((n & 255) / 255) * k),
  };
}
