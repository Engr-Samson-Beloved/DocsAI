import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WordPI - Client-Side Document Processor",
  description: "A zero-cost, serverless AI-powered academic document setup and writing assistant.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-screen overflow-hidden flex flex-col bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        {children}
      </body>
    </html>
  );
}
