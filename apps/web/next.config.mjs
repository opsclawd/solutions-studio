/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@solutions-studio/contracts', '@solutions-studio/domain']
};

export default nextConfig;
