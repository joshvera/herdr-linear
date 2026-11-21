// ⌘G and ⌘L while a mod's own view shows. keys.json binds them globally to
// `mod.open`, which toggles only an overlay `mod.open` opened itself: one a
// mod opened with openOverlay (GitHub → its Linear issue, Linear → a PR) is
// invisible to it, so the global key opened a second copy instead of
// closing this one. keys.json also binds both keys in this mod's section
// (the more specific one wins), and this says what they do here.
//
// No imports, so node can run it; main.js and herdr-github's main.js do
// what it says. Keep the two copies the same.

/**
 * What pressing the key for mod `pressed` does in mod `own`:
 *   { close: true }                  its own key: close this view
 *   { close: true, open: backTo }    the mod this view came from: back there
 *                                    (the PR or issue it was opened from)
 *   { toggle: pressed }              any other mod: as the global key does
 * @param {string} own this mod
 * @param {string} pressed the mod whose key was pressed
 * @param {{ mod: string, props?: object } | null | undefined} backTo where this view was opened from
 */
export function modKey(own, pressed, backTo) {
  if (pressed === own) return { close: true };
  if (backTo?.mod === pressed) return { close: true, open: backTo };
  return { toggle: pressed };
}
