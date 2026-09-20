# Three.js Metal Cards

An interactive WebGL gallery built with Three.js, React Three Fiber, and HTML
Canvas. Each card is rendered as a live 3D object with depth artwork, metallic
materials, engraved details, chip geometry, and responsive motion.

## Add a card

1. Export a depth card as JSON.
2. Put the exported `.json` file in `cards/`.
3. Run `npm run dev` or deploy the project again.

Every JSON file is loaded automatically. Artwork embedded as a data URL works
without any additional asset copying. The public site is a focused viewing
experience with no editor controls.

## Local development

```bash
npm install
npm run dev
```

The local URL is `http://localhost:8940`.

## Deploy

Create a new GitHub repository named `threejs-metal-cards`, then import that
repository as a new Vercel project. Vercel uses the included `vercel.json`
automatically.
