import type { Config } from "tailwindcss";

/** HubSpot-inspired: coral primário #ff7a59, texto/cinzas #33475b, raio 3px, grelha 8px (escala Tailwind padrão). */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        none: "0",
        DEFAULT: "3px",
        sm: "3px",
        md: "3px",
        lg: "3px",
        xl: "3px",
        "2xl": "3px",
        "3xl": "3px",
        full: "9999px",
      },
      fontFamily: {
        sans: [
          '"Avenir Next"',
          "Avenir",
          '"Nunito Sans"',
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        brand: {
          50: "#fff4f0",
          100: "#ffe3d9",
          200: "#ffc9b8",
          300: "#ffa48a",
          400: "#ff8866",
          500: "#ff7a59",
          600: "#e86245",
          700: "#c24a32",
          800: "#9e3d2b",
          900: "#7a3326",
          950: "#42140f",
        },
        ink: {
          DEFAULT: "#33475b",
          50: "#f5f8fa",
          100: "#eaf0f6",
          200: "#cbd6e2",
          300: "#99acc2",
          400: "#7c98b6",
          500: "#516f90",
          600: "#425b76",
          700: "#33475b",
          800: "#2d3e50",
          900: "#253342",
          /** Fundo app / chat no modo escuro (azul-carvão, sem bandas) */
          950: "#121922",
        },
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-fast": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(16px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "slide-down": {
          from: { opacity: "0", transform: "translateY(-8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out both",
        "fade-in-fast": "fade-in-fast 0.2s ease-out both",
        "slide-up": "slide-up 0.35s ease-out both",
        "scale-in": "scale-in 0.2s ease-out both",
        "slide-down": "slide-down 0.2s ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
