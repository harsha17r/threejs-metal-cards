import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const cardsDir = join(root, 'cards');
const outputDir = join(root, 'public', 'card-assets');
mkdirSync(outputDir, { recursive: true });

const fields = [
  { key: 'image', suffix: 'art', quality: '88' },
  { key: 'depthMap', suffix: 'depth', quality: '92' },
];

for (const filename of readdirSync(cardsDir).filter((name) => name.endsWith('.json'))) {
  const cardPath = join(cardsDir, filename);
  const card = JSON.parse(readFileSync(cardPath, 'utf8'));
  const id = basename(filename, '.json');

  for (const field of fields) {
    const source = card.artwork?.[field.key];
    if (typeof source !== 'string' || !source.startsWith('data:image/')) continue;

    const encoded = source.slice(source.indexOf(',') + 1);
    const temporaryPng = join(outputDir, `${id}-${field.suffix}.source.png`);
    const outputName = `${id}-${field.suffix}.webp`;
    const outputPath = join(outputDir, outputName);
    writeFileSync(temporaryPng, Buffer.from(encoded, 'base64'));
    execFileSync('cwebp', [
      '-quiet', '-mt', '-m', '6', '-q', field.quality,
      '-resize', '1280', '0', temporaryPng, '-o', outputPath,
    ]);
    rmSync(temporaryPng);
    card.artwork[field.key] = `/card-assets/${outputName}`;
  }

  writeFileSync(cardPath, `${JSON.stringify(card, null, 2)}\n`);
}

