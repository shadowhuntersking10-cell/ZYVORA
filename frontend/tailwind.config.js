/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        surface2: 'rgb(var(--surface-2) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        text: 'rgb(var(--text) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        'accent-contrast': 'rgb(var(--accent-contrast) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        // Public (landing/auth) premium dark palette. Fixed values, independent of the app theme.
        zv: {
          bg: '#0A0E1F',
          panel: '#121833',
          border: '#232C55',
          text: '#E8ECFA',
          muted: '#9AA4C7',
          primary: '#4DA3FF',
          accent: '#8B6BFF',
          danger: '#FF5C7A',
          ok: '#4ADE9A',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(77,163,255,.35), 0 8px 32px -8px rgba(77,163,255,.45)',
        'glow-focus': '0 0 0 3px rgba(77,163,255,.35)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { token: '0.5rem' },
    },
  },
  plugins: [],
};
