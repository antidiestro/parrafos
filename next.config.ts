import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  reactCompiler: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.ko-fi.com",
        pathname: "/cdn/**",
      },
    ],
  },
};

export default nextConfig;
