import React, { useState, useEffect } from 'react';

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
  currentDueDate?: string;
  onCancel: () => void;
  onReassign: (newReviewerId: string, newDueDate?: string) => void;
}

export default function ReassignmentModal({
  isOpen,
  protocolName,
  currentReviewerName,
  reviewerList,
  loading,
  currentDueDate = '',
  onCancel,
  onReassign
}: ReassignmentModalProps) {
  const [selectedReviewer, setSelectedReviewer] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  
  useEffect(() => {
    if (isOpen) {
      setSelectedReviewer('');
      setNewDueDate(currentDueDate);
    }
  }, [isOpen, currentDueDate]);

  const getDefaultDueDate = () => {
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(today.getDate() + 14);
    return futureDate.toISOString().split('T')[0];
  };

  const handleResetDueDate = () => {
    setNewDueDate(getDefaultDueDate());
  };

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
          {currentDueDate && (
            <p className="text-sm text-gray-600 mt-1">
              Current due date: <span className="font-medium">{currentDueDate}</span>
            </p>
          )}
        </div>
        
        <div className="mb-4">
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
        
        <div className="mb-6">
          <div className="flex justify-between items-center mb-1">
            <label htmlFor="new-due-date" className="block text-sm font-medium text-gray-700">
              Set New Due Date
            </label>
            <button 
              type="button"
              onClick={handleResetDueDate}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Reset to default (14 days)
            </button>
          </div>
          <input
            id="new-due-date"
            type="date"
            value={newDueDate}
            onChange={(e) => setNewDueDate(e.target.value)}
            className="w-full border border-gray-300 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <p className="text-xs text-gray-500 mt-1">
            Leave unchanged to keep the current due date.
          </p>
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
            onClick={() => onReassign(selectedReviewer, newDueDate)}
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