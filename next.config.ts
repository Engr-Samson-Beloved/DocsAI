import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the headless-Chromium packages out of the webpack bundle so their
  // native binary/assets are traced correctly for the Vercel Node runtime.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
};

export default nextConfig;
