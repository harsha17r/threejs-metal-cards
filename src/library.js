/* Every exported JSON file in /cards becomes one garden entry. The export can
   be either a raw card config or a library-style { config } wrapper. */
const modules = import.meta.glob('../cards/*.json', { eager: true });

export function listCards() {
  return Object.entries(modules).map(([path, module], index) => {
    const raw = module.default ?? module;
    const config = raw.config ?? raw;
    const filename = path.split('/').pop().replace(/\.json$/i, '');
    const name = raw.name || config.name || filename;

    return {
      id: raw.id || filename,
      name,
      savedAt: raw.savedAt || index,
      config: {
        ...config,
        name,
        artwork: { ...config.artwork, mode: 'depth' },
        engraving: { ...config.engraving, name: 'HARSHA GOWDA' },
      },
    };
  }).sort((a, b) => a.savedAt - b.savedAt);
}
