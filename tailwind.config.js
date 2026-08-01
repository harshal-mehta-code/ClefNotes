/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'rgb(var(--paper) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        panel2: 'rgb(var(--panel-2) / <alpha-value>)',
        sunk: 'rgb(var(--sunk) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        ink2: 'rgb(var(--ink-2) / <alpha-value>)',
        ink3: 'rgb(var(--ink-3) / <alpha-value>)',
        rule: 'rgb(var(--rule) / <alpha-value>)',
        rule2: 'rgb(var(--rule-2) / <alpha-value>)',
        // riso inks — one per part
        riso: {
          blue: 'rgb(var(--blue) / <alpha-value>)',
          pink: 'rgb(var(--pink) / <alpha-value>)',
          mint: 'rgb(var(--mint) / <alpha-value>)',
          gold: 'rgb(var(--gold) / <alpha-value>)',
          violet: 'rgb(var(--violet) / <alpha-value>)',
        },
        ok: 'rgb(var(--ok) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        crit: 'rgb(var(--crit) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Helvetica Neue"', 'Helvetica', '-apple-system', '"Segoe UI"', 'system-ui', 'sans-serif'],
        body: ['Georgia', '"Iowan Old Style"', '"Times New Roman"', 'serif'],
        mono: ['ui-monospace', '"SF Mono"', '"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        stamp: '4px 4px 0 rgb(var(--ink))',
        'stamp-sm': '2px 2px 0 rgb(var(--ink))',
      },
    },
  },
  plugins: [],
};
