import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const pages=['index','wallet','payment','history','settings','booth','admin','points','about'];
export default defineConfig({root,base:'/bank/',plugins:[react()],build:{outDir:'../dist',emptyOutDir:true,rollupOptions:{input:Object.fromEntries(pages.map(name=>[name,resolve(root,`${name}.html`)])),output:{manualChunks:{react:['react','react-dom'],firebase:['firebase/app','firebase/auth','firebase/firestore','firebase/analytics']}}}},test:{environment:'node',include:['js/**/*.test.js']}});
