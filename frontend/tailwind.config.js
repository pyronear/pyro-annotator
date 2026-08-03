/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // DEPRECATED — legacy red ramp. Do not use in new code; use the
        // fire-lookout tokens below instead (see DESIGN.md). Kept only until
        // legacy pages are migrated.
        primary: {
          50: '#fdf4f3',
          100: '#fce7e6',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },
        ash: '#F7F6F3',
        paper: '#FFFFFF',
        line: '#E4E2DC',
        char: '#20261F',
        haze: '#767B72',
        ember: { DEFAULT: '#D9581E', soft: '#FBEFE8' },
        pine: { DEFAULT: '#166A5D', soft: '#E9F2F0' },
        signal: { DEFAULT: '#B3261E', soft: '#FBEEED' },
      },
      fontFamily: {
        display: ['Archivo', 'system-ui', 'sans-serif'],
        body: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        data: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        title: '27px',
        heading: '18.5px',
        body: '13.5px',
        detail: '12.5px',
        eyebrow: '10.5px',
      },
      letterSpacing: {
        eyebrow: '0.14em',
      },
      borderRadius: {
        card: '10px',
      },
    },
  },
  plugins: [],
}