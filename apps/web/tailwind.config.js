/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: '#1c1c1c',
        darkerBg: '#2c2c2c',
        darkestBg: '#2b2b2b',
      },
    },
  },
  plugins: [],
}
