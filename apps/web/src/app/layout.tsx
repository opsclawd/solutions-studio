import React from 'react';

export const metadata = {
  title: 'Solutions Studio',
  description: 'Interactive Requirements Review & Reconciliation Workspace'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-100 min-h-screen text-gray-900 antialiased">{children}</body>
    </html>
  );
}
