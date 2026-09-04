/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@samvedna/shared-types"],
  // Allow parallel role dashboards (dev:counselor / dev:admin) without clobbering .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    return [
      {
        source: "/counsellor",
        destination: "/counselor",
        permanent: false,
      },
      {
        source: "/counsellor/:path*",
        destination: "/counselor/:path*",
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
