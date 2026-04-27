/** @type {import('next').NextConfig} */
const nextConfig = {
  // Trackbridge ships ESM + CJS; let Next transpile workspace packages so it
  // resolves dist/* output without route-level configuration.
  transpilePackages: ['@trackbridge/browser', '@trackbridge/server'],
};

module.exports = nextConfig;
