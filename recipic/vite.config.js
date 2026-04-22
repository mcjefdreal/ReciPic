import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
	plugins: [
    sveltekit(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ReciPic',
        short_name: 'ReciPic',
        description: 'Image to Recipe',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icons/sample.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/sample.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
  manifest: {
    name: 'ReciPic',
    short_name: 'ReciPic',
    display: 'standalone',
    start_url: '/',
    background_color: '#ffffff',
    theme_color: '#ffffff',
  }
	
});
