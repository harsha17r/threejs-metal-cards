# Three.js Metal Cards

I built **Three.js Metal Cards** as a small study in making digital objects
feel physical.

Each card is rendered live in WebGL rather than shown as a flat image. It has
its own depth artwork, metallic surface, engraved details, contact chip, logos,
and changing reflections. The cards move through a quiet, scrollable gallery,
where light, perspective, and motion do the storytelling.

## How I built it

I use **Three.js** for the 3D scene and materials, **React Three Fiber** for
the React integration, and the HTML canvas as the single rendering surface.
The card engine separates the object into layers—body, artwork, foil, chip,
engraving, and marks—so every detail can respond naturally to light.

Cards are data-driven. Each JSON file in `cards/` contains the artwork and its
material settings. The gallery loads those files automatically, which lets me
design a new card once and add it without changing the renderer. Small details
such as the chip texture and engraved marks are generated as reusable textures
and shared across the collection.

The result is intentionally simple to use: scroll through the cards, move the
pointer across the focused card, or use the keyboard to move one card at a
time. The interaction stays in the background so the object remains the focus.

## Add a card

1. Export a depth-card JSON file.
2. Place it in `cards/`.
3. Start the gallery or deploy it again.

Artwork embedded as a data URL travels with the card, so no separate asset
pipeline is required.

## Run locally

```bash
npm install
npm run dev
```

Build for production with:

```bash
npm run build
```

The project is designed to deploy directly to Vercel as a Vite application.
