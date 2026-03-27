import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
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
