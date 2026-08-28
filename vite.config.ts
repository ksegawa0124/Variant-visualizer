import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages のプロジェクトページ（/<repo>/ 配下）でも動くよう相対パスで出力する
export default defineConfig({
  base: './',
  plugins: [react()],
})
