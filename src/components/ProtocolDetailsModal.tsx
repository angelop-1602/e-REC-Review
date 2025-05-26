import React from 'react';
import { formatDate, getFormTypeName, isOverdue, isDueSoon, getReviewerFormType } from '@/lib/utils';

interface Reviewer {
  id: string;
  name: string;
  status: string;
  document_type?: string;
}

interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer?: string;
  reviewers?: Reviewer[];
  due_date: string;
  status: string;
  protocol_file: string;
  document_type?: string;
  created_at: string;
  relatedProtocols?: Protocol[];
}

interface ProtocolDetailsModalProps {
  isOpen: boolean;
  protocol: Protocol | null;
  onClose: () => void;
  onReassign?: (protocol: Protocol, reviewerId: string, reviewerName: string) => void;
}

export default function ProtocolDetailsModal({
  isOpen,
  protocol,
  onClose,
  onReassign
}: ProtocolDetailsModalProps) {
  if (!isOpen || !protocol) return null;
  
  // Function to get status badge with appropriate styling
  const getStatusBadge = (status: string, dueDate: string) => {
    if (status === 'Completed') {
      return <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Completed</span>;
    } else if (isOverdue(dueDate)) {
      return <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Overdue</span>;
    } else if (isDueSoon(dueDate)) {
      return <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">Due Soon</span>;
    } else {
      return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">In Progress</span>;
    }
  };

  // Function to get status badge with appropriate styling
  const getReviewerStatusBadge = (status: string, dueDate: string) => {
    if (status === 'Completed') {
      return <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Completed</span>;
    } else if (isOverdue(dueDate)) {
      return <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Overdue</span>;
    } else if (isDueSoon(dueDate)) {
      return <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">Due Soon</span>;
    } else {
      return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">In Progress</span>;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-bold">{protocol.protocol_name}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-6">
          <div className="bg-gray-50 p-5 rounded-lg flex flex-col gap-2 border border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg font-semibold text-gray-700">Protocol Information</span>
            </div>
            <dl className="grid grid-cols-1 gap-y-2">
              <div className="flex justify-between">
                <dt className="text-xs text-gray-500">Status</dt>
                <dd>{getReviewerStatusBadge(protocol.status, protocol.due_date)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-xs text-gray-500">Release Period</dt>
                <dd className="text-sm font-medium">{protocol.release_period}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-xs text-gray-500">Academic Level</dt>
                <dd className="text-sm font-medium">{protocol.academic_level}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-xs text-gray-500">Due Date</dt>
                <dd className="text-sm font-medium">{formatDate(protocol.due_date)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-xs text-gray-500">Created At</dt>
                <dd className="text-sm font-medium">{formatDate(protocol.created_at.split('T')[0])}</dd>
              </div>
            </dl>
            <div className="mt-4 flex justify-end">
              {protocol.protocol_file ? (
                <a
                  href={protocol.protocol_file}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 text-center"
                >
                  Open Protocol File
                </a>
              ) : (
                <span className="text-sm text-red-500">No file uploaded.</span>
              )}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-500 mb-1">Reviewers</h4>
          <div className="bg-gray-50 p-4 rounded-md overflow-x-auto">
            {protocol.reviewers && protocol.reviewers.length > 0 ? (
              <table className="min-w-full divide-y divide-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Reviewer</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Form Type</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {protocol.reviewers.map((reviewer, index) => {
                    const formInfo = getReviewerFormType(protocol, reviewer.id, reviewer.name);
                    return (
                      <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{reviewer.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formInfo.formName || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm">{getReviewerStatusBadge(reviewer.status, protocol.due_date)}</td>
                        <td className="px-4 py-3 text-sm">
                          {reviewer.status !== 'Completed' && onReassign && (
                            <button
                              onClick={() => onReassign(protocol, reviewer.id, reviewer.name)}
                              className="text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded px-3 py-1 transition-colors"
                            >
                              Reassign
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : protocol.reviewer ? (
              <div className="flex flex-col">
                <div className="flex justify-between items-center p-2 bg-white rounded-md">
                  <div>
                    <p className="font-medium">{protocol.reviewer}</p>
                    <p className="text-xs text-gray-500">{getFormTypeName(protocol.document_type || '')}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {getReviewerStatusBadge(protocol.status, protocol.due_date)}
                    {protocol.status !== 'Completed' && onReassign && (
                      <button
                        onClick={() => onReassign(protocol, protocol.reviewer || '', protocol.reviewer || '')}
                        className="text-blue-600 hover:text-blue-800 font-medium ml-3 border border-blue-200 rounded px-3 py-1 transition-colors"
                      >
                        Reassign
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No reviewers assigned to this protocol.</p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
} 