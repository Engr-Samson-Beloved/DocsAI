import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocuAI - Client-Side Document Processor",
  description: "A zero-cost, serverless AI-powered document editor for students.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
        {children}
      </body>
    </html>
  );
}
