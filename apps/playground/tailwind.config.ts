import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        naija: {
          50: "#ecfdf4",
          100: "#d1fae4",
          200: "#a6f3cc",
          300: "#6be6ad",
          400: "#2fd089",
          500: "#0bb56f",
          600: "#008751", // Nigerian flag green
          700: "#006e43",
          800: "#035737",
          900: "#04472f",
          950: "#01281a",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Noto Sans", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
      },
      keyframes: {
        blink: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0" } },
      },
      animation: { blink: "blink 1s step-end infinite" },
    },
  },
  plugins: [],
};

export default config;
