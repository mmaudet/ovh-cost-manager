export default function Logo({ className = "h-10", showText = false }) {
  return (
    <img
      src="/logo.png"
      alt="OVH Cost Manager"
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}
