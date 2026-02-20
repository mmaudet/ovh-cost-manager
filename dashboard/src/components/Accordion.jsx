import { useState } from 'react';

export default function Accordion({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-2 border rounded-lg bg-white">
      <button
        className="w-full flex justify-between items-center px-4 py-2 text-left font-semibold text-gray-800 hover:bg-gray-50 focus:outline-none"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="ml-2 text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 border-t">{children}</div>
      )}
    </div>
  );
}
