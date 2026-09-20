# Harsha Gowda Card Garden

A standalone, public depth-card garden extracted from the Metal Card Studio.

## Add a card

1. Export a depth card from the original editor.
2. Put the exported `.json` file in `cards/`.
3. Run `npm run dev` or deploy the project again.

Every JSON file is loaded automatically. Artwork embedded as a data URL works
without any additional asset copying. The public site contains no editor or
library controls, and engraving is normalized to `HARSHA GOWDA`.

## Local development

```bash
npm install
npm run dev
```

The local URL is `http://localhost:8940`.

## Deploy

Create a new GitHub repository from this folder, then import that repository
as a new Vercel project. Vercel uses the included `vercel.json` automatically.
