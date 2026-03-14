/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '3px',
        md: '6px',
        lg: '8px',
        xl: '10px',
        '2xl': '12px',
      },
      colors: {
        brand: {
          50:  '#f0fdfa',
          100: '#ccfbf1',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          900: '#134e4a',
        },
        surface: {
          50:  '#07070a',
          100: '#09090b',
          200: '#0c0c0f',
          300: '#111116',
          400: '#16161c',
        },
      },
      boxShadow: {
        card:  '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
        panel: '0 4px 16px rgba(0,0,0,0.12)',
        inset: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      },
      animation: {
        'fade-in':  'fadeIn 0.22s ease-out',
        'modal-in': 'modalIn 0.22s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        modalIn: {
          '0%':   { opacity: '0', transform: 'translateY(8px) scale(0.99)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
    },
  },
  plugins: [],
}
