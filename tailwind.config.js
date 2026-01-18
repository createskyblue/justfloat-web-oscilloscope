/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'channel-1': '#2196F3',
        'channel-2': '#4CAF50',
        'channel-3': '#FF9800',
        'channel-4': '#E91E63',
        'channel-5': '#9C27B0',
        'channel-6': '#00BCD4',
        'channel-7': '#FFEB3B',
        'channel-8': '#795548',
      }
    },
  },
  plugins: [],
}
