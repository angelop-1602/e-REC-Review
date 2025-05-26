'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import NoticeAlert from '@/components/NoticeAlert';
import { BsFillBellFill } from "react-icons/bs";

export default function ReviewerNav() {
  const pathname = usePathname();
  const [reviewerName, setReviewerName] = useState<string>('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    // Get reviewer name from localStorage
    const name = localStorage.getItem('reviewerName');
    if (name) {
      setReviewerName(name);
    }
  }, []);

  const navLinks = [
    { name: 'Dashboard', href: '/reviewer/dashboard' },
  ];

  const handleLogout = () => {
    localStorage.removeItem('reviewerId');
    localStorage.removeItem('reviewerName');
    window.location.href = '/';
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <span className="text-xl font-bold text-gray-800">e-REC Reviewer</span>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                    pathname === link.href
                      ? 'border-blue-500 text-gray-900'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                >
                  {link.name}
                </Link>
              ))}
            </div>
          </div>
          <div className="hidden sm:flex items-center space-x-4">

            <NoticeAlert userType="reviewer" />
            {/* <Link href="/reviewer/notices">
              <BsFillBellFill className="text-green-700 hover:text-primary-500" />
              </Link> */}
            {reviewerName && (
              <span className="text-sm text-gray-700">Welcome, {reviewerName}</span>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Logout
            </button>
          </div>
          
          {/* Mobile menu button */}
          <div className="flex items-center sm:hidden">
            {reviewerName && (
              <span className="text-sm text-gray-700 mr-2 truncate max-w-[120px]">
                {reviewerName}
              </span>
            )}
            <button
              onClick={toggleMobileMenu}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
              aria-expanded="false"
            >
              <span className="sr-only">Open main menu</span>
              {/* Icon when menu is closed */}
              <svg
                className={`${mobileMenuOpen ? 'hidden' : 'block'} h-6 w-6`}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
              {/* Icon when menu is open */}
              <svg
                className={`${mobileMenuOpen ? 'block' : 'hidden'} h-6 w-6`}
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <div className={`sm:hidden ${mobileMenuOpen ? 'block' : 'hidden'}`}>
        <div className="pt-2 pb-3 space-y-1 border-t border-gray-200">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                pathname === link.href
                  ? 'bg-blue-50 border-blue-500 text-blue-700'
                  : 'border-transparent text-gray-600 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-800'
              }`}
              onClick={() => setMobileMenuOpen(false)}
            >
              {link.name}
            </Link>
          ))}
          <button
            onClick={handleLogout}
            className="block w-full text-left pl-3 pr-4 py-2 border-l-4 border-transparent text-base font-medium text-red-600 hover:bg-gray-50 hover:border-gray-300"
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
} 