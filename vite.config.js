import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { port: 8940, strictPort: true },
  resolve: {
    alias: {
      '@engine': path.resolve(root, 'engine'),
      three: path.resolve(root, 'node_modules/three'),
    },
    dedupe: ['three', 'react', 'react-dom'],
  },
});
