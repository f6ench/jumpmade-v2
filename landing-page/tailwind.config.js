/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      colors: {
        bg: '#F8F6F1',
        surface: '#FFFFFF',
        ink: {
          DEFAULT: '#1A1D21',
          muted: '#4A4F57',
        },
        border: {
          subtle: '#E8E3D9',
        },
        accent: {
          DEFAULT: '#2350D9',
          dark: '#1B3FA8',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      maxWidth: {
        prose: '640px',
      },
      letterSpacing: {
        wordmark: '-0.02em',
      },
      boxShadow: {
        card: '0 1px 2px rgba(26, 29, 33, 0.04), 0 4px 16px rgba(26, 29, 33, 0.06)',
        header: '0 1px 0 rgba(26, 29, 33, 0.06)',
      },
    },
  },
  plugins: [],
};
