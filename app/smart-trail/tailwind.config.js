/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        text: "var(--color-text)",
        tint: "var(--color-tint)",
        icon: "var(--color-icon)",
        "tab-icon-default": "var(--color-tab-icon-default)",
        "tab-icon-selected": "var(--color-tab-icon-selected)",
      },
    },
  },
  plugins: [],
};
