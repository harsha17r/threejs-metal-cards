/* Every exported JSON file in /cards becomes one garden entry. Keep these
   imports lazy: artwork is embedded in each JSON file, so eager imports make
   the first JavaScript bundle enormous before the loader can paint. */
const modules = import.meta.glob('../cards/*.json');

function normalizeCard(path, module, index) {
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
}

export async function loadCards(onProgress) {
  const entries = Object.entries(modules);
  let loaded = 0;
  const cards = await Promise.all(entries.map(async ([path, load], index) => {
    const module = await load();
    loaded += 1;
    onProgress?.(loaded / Math.max(entries.length, 1));
    return normalizeCard(path, module, index);
  }));

  return cards.sort((a, b) => a.savedAt - b.savedAt);
}
