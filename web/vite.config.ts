import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  // L'API Laravel : `php artisan serve` (8000 par défaut) ; surchargeable via API_TARGET.
  const apiTarget = loadEnv(mode, '.', '').API_TARGET || 'http://127.0.0.1:8000'

  return {
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // « prompt » : jamais de rechargement automatique en plein vote ; l'électeur choisit de mettre à jour.
      registerType: 'prompt',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Vote SA — Student Association UAZ',
        short_name: 'Vote SA',
        description: "Élection du Président de la SA de l'Université Adventiste Zurcher.",
        lang: 'fr',
        theme_color: '#e8e8e6',
        background_color: '#e8e8e6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // L'application (HTML, JS, CSS, polices, icônes) est précachée : elle s'ouvre sans réseau.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        // L'API n'est jamais mise en cache par le service worker (réponses authentifiées) :
        // les données hors ligne passent par la persistance de TanStack Query.
        // /admin est désormais une route du SPA (servie par le service worker comme les autres).
        navigateFallbackDenylist: [/^\/api\//, /^\/storage\//, /^\/up$/],
        cleanupOutdatedCaches: true,
        // Photos du candidat : affichées tout de suite depuis le cache, rafraîchies en arrière-plan (utile hors ligne).
        // Le nom du fichier change à chaque nouvelle photo, donc jamais d'ancienne photo servie à tort.
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/storage/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'sa-photos', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
        ],
        // Dès la première installation, le service worker contrôle la page ouverte : le mode hors ligne marche
        // sans rechargement. Les MISES À JOUR restent manuelles (registerType « prompt »).
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Textes par défaut du site : fichier UNIQUE partagé avec l'API Laravel.
      '@content': path.resolve(__dirname, '../api/resources/content/pages.json'),
    },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    // Les photos des candidats (/storage/...) viennent de l'API, comme en production (nginx les sert sur le même domaine).
    proxy: { '/api': apiTarget, '/storage': apiTarget },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Three.js est lourd : chunk séparé, chargé seulement quand une scène 3D est affichée.
        manualChunks(id: string) {
          if (id.includes('/node_modules/three/')) return 'three'
          return undefined
        },
      },
    },
  },
  test: { environment: 'node' },
  }
})
