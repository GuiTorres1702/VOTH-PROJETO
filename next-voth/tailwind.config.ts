import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: '#0b1220',
          panel: '#131b2a',
          accent: '#58a6ff',
          success: '#3fb950',
          danger: '#f85149',
          warning: '#d29922'
        }
      }
    }
  },
  plugins: []
};

export default config;
