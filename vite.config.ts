import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // Polyfill process.env.API_KEY for the build
      'process.env.API_KEY': JSON.stringify(env.API_KEY || ''),
      // Prevent "process is not defined" errors in browser
      'process.env': {} 
    }
  };
});