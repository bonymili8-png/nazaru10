import { fileURLToPath } from "node:url";

const src = (pkg, file = "index") =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/${file}.ts`, import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the Mini App is a CDN-hosted SPA that talks to the API.
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  transpilePackages: ["@thoroughline/engine", "@thoroughline/contracts"],
  poweredByHeader: false,
  webpack(config) {
    // Bundle the shared packages from their ES-module sources, not the CommonJS `dist`: only
    // what the UI imports ships (a few constants and helpers), not the whole engine and zod.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@thoroughline/engine$": src("engine"),
      // The client only needs contracts' constants (types are erased): skip the zod schemas.
      "@thoroughline/contracts$": src("contracts", "constants"),
    };
    // An import the aliased module lacks must fail the build, not ship `undefined`.
    config.module.parser = {
      ...config.module.parser,
      javascript: { ...config.module.parser?.javascript, exportsPresence: "error" },
    };
    // The sources import siblings as "./x.js" (NodeNext style); resolve those to .ts.
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ...config.resolve.extensionAlias };
    return config;
  },
};
export default nextConfig;
