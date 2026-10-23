import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Fixed file names: the extension host references dist/webview/index.{js,css} directly.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../extension/dist/webview',
    emptyOutDir: true,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    rolldownOptions: {
      input: 'src/main.tsx',
      output: {
        entryFileNames: 'index.js',
        assetFileNames: 'index.[ext]',
        codeSplitting: false,
      },
    },
  },
}))
