import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Canvara Console",
  description:
    "Campaign console — every voter has a reason to support you. Canvara helps you find it.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-stone text-ink">{children}</body>
    </html>
  );
}
