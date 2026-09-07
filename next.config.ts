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
  /*
    The floating Next.js dev-tools badge, off.

    It only ever appeared under `next dev` — it is not in the production image
    and never reached a user — but it sits in the bottom-start corner exactly
    where the phone nav bar and the capture button now live, so every design
    review of those two controls was being done around it. Off is simply
    honest: what we look at while building should be what ships.

    `devIndicators: false` is the Next 15.2+ form. On an older minor this key
    took an object; if a downgrade ever makes this throw, that is why.
  */
  devIndicators: false,
};

export default nextConfig;
