import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  // Region color classes live as literal strings inside lib/region-color.ts
  // (the REGION_STYLES table), then get composed into component className
  // via `${styles.dot}` style template literals. Tailwind's content scanner
  // doesn't reliably pick up literals out of lib/, so we list the classes
  // explicitly here. Keep in sync with REGION_STYLES — there are five
  // regions × the variant suffix set below.
  safelist: [
    // Solid color rules
    { pattern: /^(text|bg|border)-region-(upper|lower|core|mobility|other)$/ },
    // Left border variants
    { pattern: /^border-l-region-(upper|lower|core|mobility|other)$/ },
    // Opacity-modified variants used for tints
    {
      pattern:
        /^(bg|border)-region-(upper|lower|core|mobility|other)\/(10|20|30|60|70)$/,
      variants: ['hover'],
    },
  ],
  theme: {
    extend: {
      colors: {
        // Warm dark theme — leather-notebook feel without the heavy brown
        // saturation. Hue stays around 30 (orange) but saturation is pulled
        // down to ~5-8% so the eye reads "warm charcoal" rather than "brown."
        // Region colors below carry the visual content; ink stays calm.
        ink: {
          950: '#161412',
          900: '#1f1c19',
          800: '#2a2723',
          700: '#3a3530',
          600: '#4a443d',
          500: '#6a635a',
          400: '#9a938a',
          300: '#c4bdb2',
          200: '#e0dad0',
          100: '#f3ede2',
        },
        // Sharp electric chartreuse — primary accent
        accent: {
          DEFAULT: '#d4ff3b',
          dim: '#a8cc2e',
        },
        // Status colors (Coverage volume tiers + destructive actions)
        warn: '#e8c14a',
        bad: '#c75c4a',
        // Body-region palette — applied as borders/chips/dots on anything
        // that targets muscles. Mid-tones tuned for dark backgrounds, with
        // enough hue separation that they read distinctly when several
        // sit on screen at once (Coverage, exercise picker). Apply as a
        // tinted background with the /10..20 opacity modifier.
        region: {
          upper: '#5fb8b0', // teal
          lower: '#b08fdb', // violet
          core: '#d98a8f', // rose (trunk in the schema, "core" everywhere else)
          mobility: '#79b5e6', // sky
          other: '#9a938a', // muted warm gray
        },
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
