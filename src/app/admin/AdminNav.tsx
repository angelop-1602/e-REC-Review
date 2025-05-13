'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { COLORS } from '@/lib/colors';

export default function AdminNav() {
  const pathname = usePathname();

  const navLinks = [
    { name: 'Dashboard', href: '/admin/dashboard' },
    { name: 'Protocols', href: '/admin/protocols' },
    { name: 'Due Dates', href: '/admin/due-dates' },
    { name: 'CSV Upload', href: '/admin/csv-upload' },
    { name: 'Reviewers', href: '/admin/reviewers' },
    { name: 'Notices', href: '/admin/notices' },
  ];

  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
                <span className="text-xl font-bold" style={{ color: COLORS.brand.green[700] }}>e-REC Admin</span>
           </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                    pathname === link.href
                      ? `border-${COLORS.brand.green.DEFAULT.replace('#', '')} text-gray-900`
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                  }`}
                  style={pathname === link.href ? { borderBottomColor: COLORS.brand.green.DEFAULT } : {}}
                >
                  {link.name}
                </Link>
              ))}
            </div>
          </div>
          <div className="hidden sm:ml-6 sm:flex sm:items-center">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium" 
              style={{ backgroundColor: COLORS.brand.green[50], color: COLORS.brand.green[800] }}>
              Admin
            </span>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      <div className="sm:hidden">
        <div className="pt-2 pb-3 space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                pathname === link.href
                  ? 'bg-green-50 text-green-700'
                  : 'border-transparent text-gray-600 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-800'
              }`}
              style={pathname === link.href ? { borderLeftColor: COLORS.brand.green.DEFAULT } : {}}
            >
              {link.name}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
} 