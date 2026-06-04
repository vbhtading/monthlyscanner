import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Force classic webpack dev server for stability on Windows (avoids Turbopack crashes with large node_modules)
  // turbopack: false, // not needed with --webpack flag
};

export default nextConfig;
