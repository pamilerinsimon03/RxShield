/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  webpack: (config) => {
    const path = require('path');
    config.resolve.alias = {
      ...config.resolve.alias,
      'onnxruntime-web': path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort.wasm.min.js'),
    };
    return config;
  },
  // WARNING: The headers() configuration below is completely ignored by Next.js during static exports (output: 'export').
  // When deploying to production static hosts (Vercel, Cloudflare, Netlify, Nginx), you MUST configure 
  // Cross-Origin-Opener-Policy (COOP) and Cross-Origin-Embedder-Policy (COEP) headers at the hosting CDN layer.
  // See DEPLOYMENT.md in the project root for provider-specific setup instructions.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
