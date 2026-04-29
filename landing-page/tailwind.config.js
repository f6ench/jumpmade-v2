/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html'],
  theme: {
    extend: {
      colors: {
        bg: '#FFFFFF',
        surface: '#FAFAFA',
        ink: {
          DEFAULT: '#0A0A0B',
          2: '#18181B',
          muted: '#52525B',
          dim: '#A1A1AA',
        },
        border: {
          DEFAULT: '#E4E4E7',
          rule: '#F4F4F5',
          strong: '#D4D4D8',
        },
        accent: {
          DEFAULT: '#4F39F6',
          dark: '#3B25E0',
          tint: '#F0EDFF',
          ink: '#1B1140',
        },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
      },
      maxWidth: {
        page: '1200px',
        prose: '720px',
        narrow: '560px',
      },
      letterSpacing: {
        tightest: '-0.045em',
        tighter: '-0.035em',
        tight: '-0.02em',
        kicker: '0.08em',
      },
      fontSize: {
        'display-lg': ['clamp(3rem, 9vw, 5.5rem)', { lineHeight: '0.96', letterSpacing: '-0.04em', fontWeight: '600' }],
        'display-md': ['clamp(2.25rem, 6vw, 3.5rem)', { lineHeight: '1.02', letterSpacing: '-0.035em', fontWeight: '600' }],
        'display-sm': ['clamp(1.625rem, 4vw, 2.25rem)', { lineHeight: '1.1', letterSpacing: '-0.025em', fontWeight: '600' }],
      },
    },
  },
  plugins: [],
};
