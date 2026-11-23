import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const pages=['index','wallet','payment','history','settings','booth','admin','points','topup','deposit','about','download'];
const appBase='/bank/';
const pwaHead={
  name:'pwa-head',
  transformIndexHtml(html){
    const cleaned=html
      .replace(/<meta name="theme-color"[^>]*\/?\s*>/gi,'')
      .replace(/<link rel="manifest"[^>]*\/?\s*>/gi,'');
    return cleaned.replace('</head>',`<meta name="theme-color" content="#1769c2"/><meta name="apple-mobile-web-app-capable" content="yes"/><meta name="apple-mobile-web-app-status-bar-style" content="default"/><meta name="apple-mobile-web-app-title" content="축제은행"/><link rel="manifest" href="${appBase}manifest.webmanifest"/><link rel="icon" href="${appBase}icons/app-icon.svg" type="image/svg+xml"/><link rel="apple-touch-icon" href="${appBase}icons/app-icon-180.png"/></head>`);
  },
};
export default defineConfig({root,base:appBase,plugins:[react(),pwaHead],build:{outDir:'../dist',emptyOutDir:true,rollupOptions:{input:Object.fromEntries(pages.map(name=>[name,resolve(root,`${name}.html`)])),output:{manualChunks:{react:['react','react-dom'],firebase:['firebase/app','firebase/auth','firebase/firestore','firebase/analytics']}}}},test:{environment:'node',include:['js/**/*.test.js']}});
