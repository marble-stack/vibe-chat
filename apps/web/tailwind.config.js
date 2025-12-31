/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Discord-inspired dark theme
        background: {
          primary: "#313338",
          secondary: "#2b2d31",
          tertiary: "#1e1f22",
        },
        text: {
          primary: "#f2f3f5",
          secondary: "#b5bac1",
          muted: "#949ba4",
        },
        accent: {
          primary: "#5865f2",
          hover: "#4752c4",
        },
        channel: {
          default: "#80848e",
          hover: "#dbdee1",
        },
      },
    },
  },
  plugins: [],
};
