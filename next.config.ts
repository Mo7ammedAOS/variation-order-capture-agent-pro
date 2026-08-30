import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output so the Docker image is a self-contained node server.
  // The VPS runs a long-lived process, which is what lets the local embedding
  // model and the BullMQ worker share the same image. See DEPLOYMENT_GUIDE.md.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@huggingface/transformers', '@prisma/client'],
  experimental: {
    // Evidence photos and drawings travel through a server action, and the
    // default limit is 1 MB — small enough that any real phone photo fails the
    // WHOLE request, so the Potential Change is never created either. Keep this
    // at or above MAX_UPLOAD_BYTES in document.service.ts, or the service's own
    // friendly size error becomes unreachable behind an opaque framework one.
    serverActions: { bodySizeLimit: '50mb' },
  },
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
