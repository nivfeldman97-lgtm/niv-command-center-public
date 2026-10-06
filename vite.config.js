import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => ({
  envDir: mode === 'test' ? false : undefined,
  plugins: [react(), VitePWA({
    // Register only from the main app, never from the Microsoft callback page.
    injectRegister: false,
    registerType: 'autoUpdate',
    includeManifestIcons: false, // Already covered by the explicit icons glob below.
    manifest: {
      id: '/',
      name: 'Niv Command Center',
      short_name: 'Command Center',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#14213d',
      background_color: '#f5f7fb',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      // Cache decorative assets and the plugin's versioned manifest only.
      // HTML, JS, APIs and auth stay on the network.
      globPatterns: ['icons/*.{png,svg}', 'focus.svg'],
      navigateFallback: null,
      runtimeCaching: [],
      cleanupOutdatedCaches: true,
      skipWaiting: true,
      clientsClaim: true,
    },
  })],
  server: { port: 5173, strictPort: true },
  build: { rollupOptions: { input: { main: 'index.html', redirect: 'redirect.html' } } },
}))
