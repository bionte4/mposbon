/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      screens: {
        // Landscape tablets / small POS terminals — dual-pane starts here.
        tablet: '900px',
        // Extra-wide cashier terminals (dual-pane comfort).
        pos: '1280px',
        kiosk: '1536px',
      },
      spacing: {
        'safe-t': 'env(safe-area-inset-top)',
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-l': 'env(safe-area-inset-left)',
        'safe-r': 'env(safe-area-inset-right)',
      },
      minHeight: {
        touch: '3rem',
        'touch-lg': '3.5rem',
      },
    },
  },
  plugins: [],
};
