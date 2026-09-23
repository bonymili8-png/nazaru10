/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the Mini App is a CDN-hosted SPA that talks to the API.
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: ["@thoroughline/engine", "@thoroughline/contracts"],
  poweredByHeader: false,
};
export default nextConfig;
