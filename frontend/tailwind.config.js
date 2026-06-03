/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#F5F5F5',
        secondary: '#76ABAE',
        accent: '#FF5722',
        'light-accent': '#222831',
        'surface': '#FFFFFF',
        'surface-2': '#EEEEEE',
        'border': '#D7E3E4',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Syne', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'pulse-glow': 'pulseGlow 2s infinite',
        'typing': 'typing 1.2s infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        pulseGlow: { '0%,100%': { boxShadow: '0 0 0 0 rgba(255,87,34,0.25)' }, '50%': { boxShadow: '0 0 0 8px rgba(255,87,34,0)' } },
        typing: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } },
      }
    },
  },
  plugins: [],
}
