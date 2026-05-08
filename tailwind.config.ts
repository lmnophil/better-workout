import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm dark theme — feels like a leather notebook
        ink: {
          950: '#16110d',
          900: '#1f1812',
          800: '#2a221b',
          700: '#3a2f25',
          600: '#4a3a2b',
          500: '#6a5a4b',
          400: '#9a9088',
          300: '#c4baa8',
          200: '#e0d6c0',
          100: '#f3ecdc',
        },
        // Sharp electric chartreuse — primary accent
        accent: {
          DEFAULT: '#d4ff3b',
          dim: '#a8cc2e',
        },
        // Status colors for coverage view
        warn: '#e8c14a',
        bad: '#c75c4a',
      },
      fontFamily: {
        // Resolved from CSS variables set by next/font in app/layout.tsx
        display: ['var(--font-display)', 'serif'],
        body: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
