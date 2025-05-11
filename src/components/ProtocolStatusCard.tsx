import React from 'react';

interface ProtocolStatusCardProps {
  title: string;
  count: number;
  total?: number;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'gray';
  icon?: React.ReactNode;
}

export default function ProtocolStatusCard({
  title,
  count,
  total,
  color,
  icon
}: ProtocolStatusCardProps) {
  const colorClasses = {
    blue: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      border: 'border-blue-200',
      dark: 'text-blue-800'
    },
    green: {
      bg: 'bg-green-50',
      text: 'text-green-700',
      border: 'border-green-200',
      dark: 'text-green-800'
    },
    yellow: {
      bg: 'bg-yellow-50',
      text: 'text-yellow-700',
      border: 'border-yellow-200',
      dark: 'text-yellow-800'
    },
    red: {
      bg: 'bg-red-50',
      text: 'text-red-700',
      border: 'border-red-200',
      dark: 'text-red-800'
    },
    purple: {
      bg: 'bg-purple-50',
      text: 'text-purple-700',
      border: 'border-purple-200',
      dark: 'text-purple-800'
    },
    gray: {
      bg: 'bg-gray-50',
      text: 'text-gray-700',
      border: 'border-gray-200',
      dark: 'text-gray-800'
    }
  };

  const classes = colorClasses[color];
  
  return (
    <div className={`p-4 rounded-lg shadow-sm border ${classes.border} ${classes.bg}`}>
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-sm font-medium text-gray-500">{title}</h3>
          <div className="mt-1 flex items-baseline">
            <p className={`text-2xl font-semibold ${classes.dark}`}>{count}</p>
            {total !== undefined && (
              <p className="ml-1 text-sm text-gray-600">/ {total}</p>
            )}
          </div>
          {total !== undefined && (
            <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
              <div 
                className={`${classes.text.replace('text', 'bg')} h-2 rounded-full`} 
                style={{ width: `${total > 0 ? Math.round((count / total) * 100) : 0}%` }}
              ></div>
            </div>
          )}
        </div>
        {icon && (
          <div className={`rounded-md p-2 ${classes.bg}`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
} 