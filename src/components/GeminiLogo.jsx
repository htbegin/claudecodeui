export default function GeminiLogo({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="geminiGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="50%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill="url(#geminiGradient)" />
      <path
        d="M20 10.5c5.25 0 9.5 4.25 9.5 9.5s-4.25 9.5-9.5 9.5-9.5-4.25-9.5-9.5 4.25-9.5 9.5-9.5z"
        fill="white"
        opacity="0.15"
      />
      <path
        d="M14.5 22.5c2.25 2.25 5.9 2.25 8.15 0 1.85-1.85 2.2-4.7 1.05-6.9"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="14.5" cy="17" r="1.5" fill="white" />
      <circle cx="25.5" cy="17" r="1.5" fill="white" />
    </svg>
  );
}
