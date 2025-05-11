import { ReactNode } from 'react';
import AdminNav from './AdminNav';

export default function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-100">
      <AdminNav />
      <main>{children}</main>
    </div>
  );
} 