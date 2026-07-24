/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/src/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1E6FCC',
          light: '#E8F2FF',
          dark: '#154F99'
        },
        sidebar: {
          DEFAULT: '#1A1A2E',
          hover: '#252540',
          active: '#2D2D50'
        },
        'agent-orchestrator': '#722ED1',
        'agent-aero': '#1E6FCC',
        'agent-structural': '#FA8C16',
        'agent-propulsion': '#CF1322',
        'agent-avionics': '#08979C',
        'agent-doc': '#389E0D'
      },
      borderRadius: {
        card: '12px',
        btn: '8px',
        input: '4px'
      },
      fontFamily: {
        sans: ['Inter', '"HarmonyOS Sans SC"', '"思源黑体"', 'sans-serif']
      }
    }
  },
  plugins: []
}
