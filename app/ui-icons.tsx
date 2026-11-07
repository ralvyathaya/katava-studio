import { useId } from "react";
import type { ContentFormat } from "@/lib/types";

type IconProps = { className?: string };

export function KatavaMark({ className = "h-10 w-10" }: IconProps) {
  return (
    <svg viewBox="0 0 44 44" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="katava-mark" x1="5" y1="4" x2="39" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6D5DFB" />
          <stop offset="1" stopColor="#9B51E0" />
        </linearGradient>
      </defs>
      <rect width="44" height="44" rx="14" fill="url(#katava-mark)" />
      <path d="M13 11v22M14 23l12-12M14 23l13 10" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m25 12 2.2-4 2.2 4 4 2.2-4 2.2-2.2 4-2.2-4-4-2.2 4-2.2Z" fill="#E9E5FF" />
    </svg>
  );
}

export function FormatIcon({ format, className = "h-11 w-11" }: { format: ContentFormat | string } & IconProps) {
  const gradientId = useId();
  if (format === "instagram") {
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="5" y1="43" x2="43" y2="5" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFDC80" />
            <stop offset=".28" stopColor="#F56040" />
            <stop offset=".62" stopColor="#C13584" />
            <stop offset="1" stopColor="#833AB4" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" rx="14" fill={`url(#${gradientId})`} />
        <rect x="11.5" y="11.5" width="25" height="25" rx="8" fill="none" stroke="white" strokeWidth="3" />
        <circle cx="24" cy="24" r="6" fill="none" stroke="white" strokeWidth="3" />
        <circle cx="33" cy="15.5" r="1.8" fill="white" />
      </svg>
    );
  }
  if (format === "reels") {
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        <rect width="48" height="48" rx="14" fill="#111118" />
        <path d="M27.6 8.5v20.1a7.2 7.2 0 1 1-5.1-6.9V11.2c7.3-.4 11.7 3 14.1 7.4-3.4-.7-6.2-2.3-9-5.1v15.1a7.2 7.2 0 1 0 7.2 7.2" fill="#FE2C55" transform="translate(1.2 .8)" />
        <path d="M27.6 8.5v20.1a7.2 7.2 0 1 1-5.1-6.9V11.2c7.3-.4 11.7 3 14.1 7.4-3.4-.7-6.2-2.3-9-5.1v15.1a7.2 7.2 0 1 0 7.2 7.2" fill="#25F4EE" transform="translate(-1.2 -.6)" />
        <path d="M27.6 8.5v20.1a7.2 7.2 0 1 1-5.1-6.9V11.2c7.3-.4 11.7 3 14.1 7.4-3.4-.7-6.2-2.3-9-5.1" fill="white" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="8" y1="5" x2="42" y2="43" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FF8A50" />
          <stop offset="1" stopColor="#EE4D2D" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${gradientId})`} />
      <path d="M12 17h24l-2 22H14l-2-22Z" fill="white" />
      <path d="M18 19v-3a6 6 0 0 1 12 0v3" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M18 27c1.6 3 3.6 4.5 6 4.5s4.4-1.5 6-4.5M24 22v5" fill="none" stroke="#EE4D2D" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function SparklesIcon({ className = "h-5 w-5" }: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true"><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15ZM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>;
}

export function ShieldCheckIcon({ className = "h-5 w-5" }: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true"><path d="M12 3 4.5 6v5.2c0 4.6 3.1 8.2 7.5 9.8 4.4-1.6 7.5-5.2 7.5-9.8V6L12 3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="m8.5 12 2.2 2.2 4.8-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function ArrowRightIcon({ className = "h-5 w-5" }: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function DownloadIcon({ className = "h-5 w-5" }: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
