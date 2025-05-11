import { ReactNode } from 'react';
import ReviewerNav from './ReviewerNav';

export default function ReviewerLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-100">
      <ReviewerNav />
      <main className="px-4 py-2 sm:px-6 sm:py-4 md:py-6 lg:px-8 max-w-full overflow-x-hidden">{children}</main>
    </div>
  );
} 