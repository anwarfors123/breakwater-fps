// The look plan, in one place: one canvas, one surface, two team hues and a single accent.
// Every colour the 3D scene and the HUD use comes from here, so the game reads as one object
// and not a pile of borrowed parts. The same names are CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#1d242b',
  surface: '#28313a',
  hairline: '#3b4650',
  ink: '#f2efe8',
  muted: '#a3aeb8',
  accent: '#ffb347',
  dock: '#d9713a', // Dockers, the attacking side
  warden: '#59a8c9', // Wardens, the defending side
  steel: '#77848f',
  rust: '#8f5a3f',
  concrete: '#8b9096',
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
