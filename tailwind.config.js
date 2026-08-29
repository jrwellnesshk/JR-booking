/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './admin.html',
    './doctor.html',
    './staff.html',
    './js/*.js',
  ],
  safelist: [
    'focus:border-purple-500',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
