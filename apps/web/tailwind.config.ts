import type { Config } from "tailwindcss";

/** Design system: primário #6734ff, secundário/hover #6366f1, texto/cinzas #33475b. */
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
          50: "#f4f2ff",
          100: "#ebe6ff",
          200: "#d9d1ff",
          300: "#bdb0ff",
          400: "#8f74ff",
          500: "#6734ff",
          600: "#6366f1",
          700: "#5528db",
          800: "#4521b0",
          900: "#381c8f",
          950: "#1f0f52",
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
          950: "#0e1624",
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
