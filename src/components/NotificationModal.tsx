import React from 'react';

type NotificationType = 'success' | 'error' | 'info' | 'warning';

interface NotificationModalProps {
  isOpen: boolean;
  type: NotificationType;
  title: string;
  message: string;
  onClose: () => void;
}

export default function NotificationModal({
  isOpen,
  type,
  title,
  message,
  onClose
}: NotificationModalProps) {
  if (!isOpen) return null;

  const iconMap = {
    success: (
      <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    error: (
      <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
    info: (
      <svg className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    warning: (
      <svg className="h-6 w-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )
  };

  const bgColorMap = {
    success: 'bg-green-50',
    error: 'bg-red-50',
    info: 'bg-blue-50',
    warning: 'bg-yellow-50'
  };

  const borderColorMap = {
    success: 'border-green-200',
    error: 'border-red-200',
    info: 'border-blue-200',
    warning: 'border-yellow-200'
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={`bg-white rounded-lg p-6 max-w-md w-full border ${borderColorMap[type]}`}>
        <div className="flex items-start">
          <div className={`flex-shrink-0 ${bgColorMap[type]} p-2 rounded-full mr-3`}>
            {iconMap[type]}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-medium">{title}</h3>
            <div className="mt-2">
              <p className="text-sm text-gray-600">{message}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
} 