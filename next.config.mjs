/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a test build run without clobbering a running dev server's .next folder
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;
