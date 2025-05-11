import React from 'react';

interface Reviewer {
  id: string;
  name: string;
}

interface ReassignmentModalProps {
  isOpen: boolean;
  protocolName: string;
  currentReviewerName: string;
  reviewerList: Reviewer[];
  loading: boolean;
  onCancel: () => void;
  onReassign: (newReviewerId: string) => void;
}

export default function ReassignmentModal({
  isOpen,
  protocolName,
  currentReviewerName,
  reviewerList,
  loading,
  onCancel,
  onReassign
}: ReassignmentModalProps) {
  const [selectedReviewer, setSelectedReviewer] = React.useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Reassign Protocol Review</h3>
        
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            You are reassigning the following protocol:
          </p>
          <p className="font-medium">{protocolName}</p>
          <p className="text-sm text-gray-600 mt-2">
            Current reviewer: <span className="font-medium">{currentReviewerName}</span>
          </p>
        </div>
        
        <div className="mb-6">
          <label htmlFor="new-reviewer" className="block text-sm font-medium text-gray-700 mb-1">
            Select New Reviewer
          </label>
          <select
            id="new-reviewer"
            value={selectedReviewer}
            onChange={(e) => setSelectedReviewer(e.target.value)}
            className="w-full border border-gray-300 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          >
            <option value="">Select a reviewer</option>
            {reviewerList
              .filter(reviewer => reviewer.name !== currentReviewerName)
              .map(reviewer => (
                <option key={reviewer.id} value={reviewer.id}>
                  {reviewer.name}
                </option>
              ))}
          </select>
        </div>
        
        <div className="flex justify-end space-x-3">
          <button
            type="button"
            onClick={onCancel}
            className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onReassign(selectedReviewer)}
            className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading || !selectedReviewer}
          >
            {loading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing...
              </span>
            ) : (
              'Reassign Review'
            )}
          </button>
        </div>
      </div>
    </div>
  );
} 