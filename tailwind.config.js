/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          green: {
            DEFAULT: '#036635',
            light: '#047a40',
            dark: '#025128',
            50: '#e6f7ef',
            100: '#ccefdf',
            200: '#99dfbf',
            300: '#66cf9f',
            400: '#33bf7f',
            500: '#00af5f',
            600: '#039350',
            700: '#036635',
            800: '#024d28',
            900: '#01341a',
          },
          yellow: {
            DEFAULT: '#FECC07',
            light: '#fed339',
            dark: '#e3b700',
            50: '#fff9e6',
            100: '#fff3cc',
            200: '#ffe799',
            300: '#ffdc66',
            400: '#fed033',
            500: '#FECC07',
            600: '#e3b700',
            700: '#b08e00',
            800: '#7d6500',
            900: '#4a3c00',
          },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [],
} 