'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';

export default function ReassignProtocolPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  
  useEffect(() => {
    // Automatically redirect to the protocol details page
    const timer = setTimeout(() => {
      router.push(`/admin/protocols/${id}`);
    }, 5000);
    
    return () => clearTimeout(timer);
  }, [router, id]);
  
  return (
    <div className="space-y-6">
      <div className="p-6 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-red-600 mb-4">This Page Is Deprecated</h1>
        
        <div className="bg-red-50 border border-red-200 p-4 rounded mb-6">
          <p className="mb-2">
            The global protocol reassignment feature has been replaced with individual reviewer reassignment for better flexibility.
          </p>
          <p>
            Please use the "Reassign" button next to each reviewer's name on the protocol details page.
          </p>
        </div>
        
        <p className="mb-4">You will be redirected to the protocol details page in 5 seconds.</p>
        
        <Link
          href={`/admin/protocols/${id}`}
          className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
        >
          Go to Protocol Details
        </Link>
      </div>
    </div>
  );
} 