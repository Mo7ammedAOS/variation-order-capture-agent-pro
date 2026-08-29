import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output so the Docker image is a self-contained node server.
  // The VPS runs a long-lived process, which is what lets the local embedding
  // model and the BullMQ worker share the same image. See DEPLOYMENT_GUIDE.md.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@huggingface/transformers', '@prisma/client'],
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
