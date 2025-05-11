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
      <main>{children}</main>
    </div>
  );
} 