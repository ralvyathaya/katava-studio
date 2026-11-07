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
        <g transform="translate(12.7 11.2) scale(.064)">
          <path d="M137.17 156.98v-15.56c-5.34-.73-10.76-1.18-16.29-1.18C54.23 140.24 0 194.47 0 261.13c0 40.9 20.43 77.09 51.61 98.97-20.12-21.6-32.46-50.53-32.46-82.31 0-65.7 52.69-119.28 118.03-120.81Z" fill="#25F4EE" />
          <path d="M140.02 333c29.74 0 54-23.66 55.1-53.13l.11-263.2h48.08c-1-5.41-1.55-10.97-1.55-16.67h-65.67l-.11 263.2c-1.1 29.47-25.36 53.13-55.1 53.13-9.24 0-17.95-2.31-25.61-6.34C105.3 323.9 121.6 333 140.02 333ZM333.13 106V91.37c-18.34 0-35.43-5.45-49.76-14.8 12.76 14.65 30.09 25.22 49.76 29.43Z" fill="#25F4EE" />
          <path d="M283.38 76.57c-13.98-16.05-22.47-37-22.47-59.91h-17.59c4.63 25.02 19.48 46.49 40.06 59.91ZM120.88 205.92c-30.44 0-55.21 24.77-55.21 55.21 0 21.2 12.03 39.62 29.6 48.86-6.55-9.08-10.45-20.18-10.45-32.2 0-30.44 24.77-55.21 55.21-55.21 5.68 0 11.13.94 16.29 2.55v-67.05c-5.34-.73-10.76-1.18-16.29-1.18-.96 0-1.9.05-2.85.07v51.49c-5.16-1.61-10.61-2.55-16.29-2.55Z" fill="#FE2C55" />
          <path d="M333.13 106v51.04c-34.05 0-65.61-10.89-91.37-29.38v133.47c0 66.66-54.23 120.88-120.88 120.88-25.76 0-49.64-8.12-69.28-21.91 22.08 23.71 53.54 38.57 88.42 38.57 66.66 0 120.88-54.23 120.88-120.88V144.33c25.76 18.49 57.32 29.38 91.37 29.38v-65.68c-6.57 0-12.97-.71-19.14-2.03Z" fill="#FE2C55" />
          <path d="M241.76 261.13V127.66c25.76 18.49 57.32 29.38 91.37 29.38V106c-19.67-4.21-37-14.77-49.76-29.43-20.58-13.42-35.43-34.88-40.06-59.91h-48.08l-.11 263.2c-1.1 29.47-25.36 53.13-55.1 53.13-18.42 0-34.72-9.1-44.75-23.01-17.57-9.25-29.6-27.67-29.6-48.86 0-30.44 24.77-55.21 55.21-55.21 5.68 0 11.13.94 16.29 2.55v-51.49C71.83 158.5 19.14 212.08 19.14 277.78c0 31.78 12.34 60.71 32.46 82.31C71.23 373.87 95.12 382 120.88 382c66.65 0 120.88-54.23 120.88-120.88Z" fill="#FFFFFF" />
        </g>
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
