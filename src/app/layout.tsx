import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://wordpi.app"),
  title: "WordPIlot - AI Academic Document & Thesis Assistant",
  description: "Advanced AI-powered academic writing, thesis blueprinting, seminar reports, and document formatting assistant.",
  icons: {
    icon: [
      { url: "/WordPI.png", type: "image/png" },
      { url: "/favicon.ico" }
    ],
    apple: "/WordPI.png",
    shortcut: "/WordPI.png",
  },
  openGraph: {
    title: "WordPIlot - AI Academic Document & Thesis Assistant",
    description: "Advanced AI-powered academic writing, thesis blueprinting, seminar reports, and document formatting assistant.",
    siteName: "WordPIlot",
    url: "https://wordpi.app",
    images: [
      {
        url: "/WordPI.png",
        width: 1200,
        height: 630,
        alt: "WordPIlot - AI Academic Writing Assistant",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "WordPIlot - AI Academic Document & Thesis Assistant",
    description: "Advanced AI-powered academic writing, thesis blueprinting, seminar reports, and document formatting assistant.",
    images: ["/WordPI.png"],
  },
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
