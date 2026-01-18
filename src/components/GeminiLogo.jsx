const GeminiLogo = ({ className = 'w-5 h-5' }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="gemini-gradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#22c55e" />
        <stop offset="50%" stopColor="#0ea5e9" />
        <stop offset="100%" stopColor="#6366f1" />
      </linearGradient>
    </defs>
    <path
      d="M12 2.5l2.9 5.87 6.48.94-4.69 4.57 1.1 6.46L12 17.9l-5.79 3.04 1.1-6.46-4.69-4.57 6.48-.94L12 2.5z"
      fill="url(#gemini-gradient)"
      stroke="url(#gemini-gradient)"
      strokeWidth="0.5"
    />
  </svg>
);

export default GeminiLogo;
