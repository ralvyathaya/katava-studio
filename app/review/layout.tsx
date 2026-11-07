import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Client Review | Katava Studio",
  description: "Version-bound human decisions. Internal demo policy; no automatic publication.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function ReviewLayout({ children }: { children: React.ReactNode }) { return children; }
