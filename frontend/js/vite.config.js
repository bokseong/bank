import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('..',import.meta.url)),plugins:[react()],build:{outDir:'../dist',emptyOutDir:true,rollupOptions:{output:{manualChunks:{react:['react','react-dom'],firebase:['firebase/app','firebase/auth','firebase/firestore','firebase/analytics']}}}},test:{environment:'node',include:['js/**/*.test.js']}});
