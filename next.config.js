/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', 'pdf-parse', 'mammoth', 'nodemailer'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // Allow images from external domains if needed
  images: {
    domains: [],
  },
}

module.exports = nextConfig
