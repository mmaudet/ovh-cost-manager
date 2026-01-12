export default function Logo({ className = "w-10 h-10" }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Background circle */}
      <circle cx="24" cy="24" r="22" fill="#3B82F6" />

      {/* OCM text */}
      <text
        x="24"
        y="28"
        textAnchor="middle"
        fill="white"
        fontFamily="Arial, sans-serif"
        fontWeight="bold"
        fontSize="14"
      >
        OCM
      </text>
    </svg>
  );
}
