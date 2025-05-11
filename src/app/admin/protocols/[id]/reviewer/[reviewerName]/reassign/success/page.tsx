'use client';

import Link from 'next/link';

// If the file has no content yet, add a basic component instead of importing unused modules
export default function ReassignSuccess() {
  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold text-green-600 mb-4">Reassignment Successful</h1>
      <p className="mb-4">The reviewer has been successfully reassigned.</p>
      <Link 
        href="/admin/protocols" 
        className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
      >
        Back to Protocols
      </Link>
    </div>
  );
} 