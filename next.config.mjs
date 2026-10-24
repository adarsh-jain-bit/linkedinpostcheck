/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets a test build run without clobbering a running dev server's .next folder
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // Resumes are read from disk when sending; make sure Vercel ships them with the function
    outputFileTracingIncludes: { "/api/mail": ["./resumes/**"] },
  },
};
export default nextConfig;
