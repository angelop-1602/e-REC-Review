'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

export default function NotFound() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Handle dynamic routes client-side for reviewer protocols
    if (pathname?.startsWith('/reviewer/protocols/')) {
      const id = pathname.split('/').pop();
      router.push(`/reviewer/dashboard?protocol=${id}`);
      return;
    }

    // Handle dynamic routes client-side for admin protocols
    if (pathname?.startsWith('/admin/protocols/')) {
      const parts = pathname.split('/');
      const id = parts[3];
      
      if (parts.includes('reassign') && parts.includes('reviewer')) {
        const reviewerName = parts[5];
        router.push(`/admin/protocols?id=${id}&reviewer=${reviewerName}&action=reassign`);
      } else if (parts.includes('reassign')) {
        router.push(`/admin/protocols?id=${id}&action=reassign`);
      } else {
        router.push(`/admin/protocols?id=${id}`);
      }
      return;
    }
  }, [pathname, router]);

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-grow flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">Page Not Found</h1>
          <p className="text-gray-600 mb-6">The page you are looking for might be loading or doesn&apos;t exist.</p>
          <Link 
            href="/"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Return Home
          </Link>
        </div>
      </main>
    </div>
  );
} 