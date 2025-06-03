import React from 'react';
import { isOverdue, isDueSoon, formatDate } from '@/lib/utils';

interface Reviewer {
  id: string;
  name: string;
  status: string;
  document_type?: string;
  due_date?: string;
}

interface Protocol {
  id: string;
  protocol_name: string;
  spup_rec_code?: string;
  research_title?: string;
  release_period: string;
  academic_level: string;
  reviewer?: string;
  reviewers?: Reviewer[];
  due_date: string;
  status: string;
  protocol_file: string;
  document_type?: string;
  created_at: string;
  reviewerCount?: number;
  completedReviewerCount?: number;
}

interface ProtocolTableProps {
  protocols: Protocol[];
  loading: boolean;
  emptyMessage?: string;
  onViewDetails?: (protocol: Protocol) => void;
  onReassign?: (protocol: Protocol, reviewerId: string, reviewerName: string) => void;
}

export default function ProtocolTable({
  protocols,
  loading,
  emptyMessage = 'No protocols found.',
  onViewDetails,
  onReassign
}: ProtocolTableProps) {
  // Function to get status label with appropriate styling
  const getStatusLabel = (status: string, dueDate: string) => {
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

  // Function to display due date information
  const getDueDateDisplay = (protocol: Protocol) => {
    // Basic due date display if no reviewers
    if (!protocol.reviewers || protocol.reviewers.length === 0) {
      return <span>{formatDate(protocol.due_date)}</span>;
    }

    // Get active (non-completed) reviewers
    const activeReviewers = protocol.reviewers.filter(r => r.status !== 'Completed');
    if (activeReviewers.length === 0) {
      return <span className="text-green-600">{formatDate(protocol.due_date)}</span>;
    }

    // Check for overdue reviewers
    const overdueReviewers = activeReviewers.filter(r => {
      const reviewerDueDate = r.due_date || protocol.due_date;
      return isOverdue(reviewerDueDate);
    });

    // Check for due soon reviewers
    const dueSoonReviewers = activeReviewers.filter(r => {
      const reviewerDueDate = r.due_date || protocol.due_date;
      return !isOverdue(reviewerDueDate) && isDueSoon(reviewerDueDate);
    });

    // Find earliest due date among active reviewers
    let earliestDueDate = protocol.due_date;
    activeReviewers.forEach(reviewer => {
      const reviewerDueDate = reviewer.due_date || protocol.due_date;
      if (reviewerDueDate && (!earliestDueDate || reviewerDueDate < earliestDueDate)) {
        earliestDueDate = reviewerDueDate;
      }
    });

    // Return appropriate display based on status
    if (overdueReviewers.length > 0) {
      return (
        <div>
          <span className="text-red-600 font-medium">{formatDate(earliestDueDate)}</span>
          <div className="text-xs text-red-600">
            {overdueReviewers.length > 1 
              ? `${overdueReviewers.length} reviewers overdue` 
              : '1 reviewer overdue'}
          </div>
        </div>
      );
    } else if (dueSoonReviewers.length > 0) {
      return (
        <div>
          <span className="text-yellow-600 font-medium">{formatDate(earliestDueDate)}</span>
          <div className="text-xs text-yellow-600">
            {dueSoonReviewers.length > 1 
              ? `${dueSoonReviewers.length} reviewers due soon` 
              : '1 reviewer due soon'}
          </div>
        </div>
      );
    } else {
      return (
        <div>
          <span>{formatDate(earliestDueDate)}</span>
          <div className="text-xs text-gray-500">
            {activeReviewers.length} active {activeReviewers.length === 1 ? 'reviewer' : 'reviewers'}
          </div>
        </div>
      );
    }
  };

  // Function to get completion progress badge
  const getCompletionBadge = (completed: number, total: number) => {
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    let bgColor = 'bg-blue-100 text-blue-800';
    
    if (percentage === 100) {
      bgColor = 'bg-green-100 text-green-800';
    } else if (percentage >= 50) {
      bgColor = 'bg-yellow-100 text-yellow-800';
    } else if (percentage > 0) {
      bgColor = 'bg-orange-100 text-orange-800';
    } else {
      bgColor = 'bg-gray-100 text-gray-800';
    }
    
    return (
      <span className={`${bgColor} text-xs px-2 py-1 rounded-full`}>
        {completed}/{total} ({percentage}%)
      </span>
    );
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="inline-block animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mb-2"></div>
        <p>Loading protocols...</p>
      </div>
    );
  }

  if (protocols.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  // Check if protocols have reviewer counts (for group display)
  const hasReviewerCounts = protocols.length > 0 && 
    protocols[0]?.reviewerCount !== undefined && 
    protocols[0]?.completedReviewerCount !== undefined;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              SPUP REC Code
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Release Period
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Due Date
            </th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            {hasReviewerCounts && (
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Completion
              </th>
            )}
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {protocols.map((protocol) => (
            <tr key={protocol.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                {protocol.spup_rec_code || protocol.id}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {protocol.release_period}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {getDueDateDisplay(protocol)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {getStatusLabel(protocol.status, protocol.due_date)}
              </td>
              {hasReviewerCounts && protocol.reviewerCount !== undefined && protocol.completedReviewerCount !== undefined && (
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {getCompletionBadge(protocol.completedReviewerCount, protocol.reviewerCount)}
                </td>
              )}
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <button
                  onClick={() => onViewDetails && onViewDetails(protocol)}
                  className="text-blue-600 hover:text-blue-800 mr-3"
                >
                  View Details
                </button>
                {protocol.status !== 'Completed' && onReassign && (
                  <button
                    onClick={() => {
                      if (protocol.reviewers && protocol.reviewers.length > 0) {
                        // Find first non-completed reviewer
                        const reviewer = protocol.reviewers.find(r => r.status !== 'Completed');
                        if (reviewer) {
                          onReassign(protocol, reviewer.id, reviewer.name);
                        }
                      } else if (protocol.reviewer) {
                        onReassign(protocol, protocol.reviewer, protocol.reviewer);
                      }
                    }}
                    className="text-red-600 hover:text-red-800"
                  >
                    Reassign
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
} 