/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Green dark theme
        background: {
          primary: "#1a2e1a",
          secondary: "#152415",
          tertiary: "#0f1a0f",
        },
        text: {
          primary: "#e8f5e8",
          secondary: "#a8c5a8",
          muted: "#7a9a7a",
        },
        accent: {
          primary: "#4caf50",
          hover: "#388e3c",
        },
        channel: {
          default: "#6b8f6b",
          hover: "#c8e6c9",
        },
      },
    },
  },
  plugins: [],
};
