import React, { useState, useEffect, useRef } from 'react';
import { doc, updateDoc, setDoc, Timestamp, collection } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { formatDate } from '@/lib/utils';

interface Reviewer {
  id: string;
  name: string;
  form_type?: string;
  status?: string;
  due_date?: string;
  completed_at?: Timestamp | null;
}

interface Protocol {
  id: string;
  protocol_name: string;
  _path?: string;
  reviewers?: Reviewer[];
  reviewer?: string;
  due_date: string;
  form_type?: string;
}

interface ReassignmentModalProps {
  isOpen: boolean;
  protocol: Protocol;
  currentReviewer: Reviewer;
  reviewerList: Reviewer[];
  loading: boolean;
  onCancel: () => void;
  onSuccess: (updatedReviewer: { id: string; name: string; due_date: string }) => void;
}

export default function ReassignmentModal({
  isOpen,
  protocol,
  currentReviewer,
  reviewerList,
  loading,
  onCancel,
  onSuccess
}: ReassignmentModalProps) {
  const [selectedReviewer, setSelectedReviewer] = useState('');
  const [newDueDate, setNewDueDate] = useState(protocol?.due_date || '');
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [status, setStatus] = useState(currentReviewer.status || 'In Progress');
  const searchRef = useRef<HTMLDivElement>(null);
  
  // Filter reviewers based on search term
  const filteredReviewers = reviewerList.filter(reviewer => 
    reviewer.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Handle click outside to close suggestions
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (isOpen && (currentReviewer.due_date || protocol.due_date)) {
      setSelectedReviewer('');
      setSearchTerm('');
      setStatus(currentReviewer.status || 'In Progress');
      // Calculate new due date (2 weeks from original)
      try {
        const originalDueDate = currentReviewer.due_date || protocol.due_date;
        if (!originalDueDate) {
          console.error('No due date found in protocol or reviewer');
          setNewDueDate('');
          return;
        }
        const [year, month, day] = originalDueDate.split('-').map(Number);
        if (isNaN(year) || isNaN(month) || isNaN(day)) {
          console.error('Invalid date format:', originalDueDate);
          setNewDueDate('');
          return;
        }
        const date = new Date(year, month - 1, day);
        date.setDate(date.getDate() + 14);
        const newYear = date.getFullYear();
        const newMonth = String(date.getMonth() + 1).padStart(2, '0');
        const newDay = String(date.getDate()).padStart(2, '0');
        const newDate = `${newYear}-${newMonth}-${newDay}`;
        setNewDueDate(newDate);
      } catch (err) {
        console.error('Error calculating new due date:', err);
        setNewDueDate('');
      }
      setError(null);
    }
  }, [isOpen, protocol?.due_date, currentReviewer?.due_date, currentReviewer?.status]);

  // Reset newDueDate when reviewer changes
  useEffect(() => {
    if (selectedReviewer) {
      const reviewer = reviewerList.find(r => r.id === selectedReviewer);
      const originalDueDate = reviewer?.due_date || protocol.due_date;
      if (originalDueDate) {
        const [year, month, day] = originalDueDate.split('-').map(Number);
        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
          const date = new Date(year, month - 1, day);
          date.setDate(date.getDate() + 14);
          const newYear = date.getFullYear();
          const newMonth = String(date.getMonth() + 1).padStart(2, '0');
          const newDay = String(date.getDate()).padStart(2, '0');
          setNewDueDate(`${newYear}-${newMonth}-${newDay}`);
        }
      }
    }
  }, [selectedReviewer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Submit clicked', {
      selectedReviewer,
      protocol,
      currentReviewer,
      newDueDate,
      status
    });

    if (!selectedReviewer || !protocol || !currentReviewer) {
      console.error('Missing required data:', {
        selectedReviewer: !!selectedReviewer,
        protocol: !!protocol,
        currentReviewer: !!currentReviewer
      });
      setError('Missing required information');
      return;
    }

    // Validate due date format only if status is In Progress
    if (status === 'In Progress') {
      if (!newDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) {
        console.error('Invalid due date format:', newDueDate);
        setError('Due date is required for In Progress status');
        return;
      }
    }

    try {
      setError(null);
      
      // Find the selected reviewer's info
      const newReviewerInfo = reviewerList.find(r => r.id === selectedReviewer);
      if (!newReviewerInfo) {
        console.error('Selected reviewer not found:', selectedReviewer);
        throw new Error('Selected reviewer not found');
      }

      console.log('Found new reviewer:', newReviewerInfo);

      // Validate required fields
      if (!newReviewerInfo.id || !newReviewerInfo.name) {
        throw new Error('New reviewer information is incomplete');
      }

      // Determine the correct protocol document reference
      let protocolRef;
      if (protocol._path) {
        const pathParts = protocol._path.split('/');
        if (pathParts.length === 3) {
          protocolRef = doc(db, 'protocols', pathParts[0], pathParts[1], pathParts[2]);
        } else {
          protocolRef = doc(db, 'protocols', protocol.id);
        }
      } else {
        protocolRef = doc(db, 'protocols', protocol.id);
      }

      console.log('Using protocol reference:', protocolRef.path);

      // Create new reviewer object
      const newReviewer: Reviewer = {
        id: newReviewerInfo.id || '',
        name: newReviewerInfo.name || '',
        form_type: currentReviewer.form_type || '',
        status: status,
        due_date: status === 'In Progress' ? newDueDate : '',
        completed_at: status === 'Completed' ? Timestamp.now() : null
      };

      console.log('Created new reviewer object:', newReviewer);

      // Create audit entry
      const timestamp = Timestamp.now();
      const auditId = `${protocol.id}_${timestamp.toMillis()}`;
      
      const auditEntry = {
        id: auditId,
        from: currentReviewer.name,
        to: newReviewerInfo.name,
        date: timestamp,
        type: 'reassignment',
        status: status,
        completed_at: status === 'Completed' ? timestamp : null
      };

      console.log('Created audit entry:', auditEntry);

      // Create audit in protocol's subcollection
      try {
        // Get the correct path for the protocol
        let protocolPath;
        if (protocol._path) {
          const pathParts = protocol._path.split('/');
          if (pathParts.length === 3) {
            protocolPath = `protocols/${pathParts[0]}/${pathParts[1]}/${pathParts[2]}`;
          } else {
            throw new Error('Invalid protocol path format');
          }
        } else {
          throw new Error('Protocol path information missing');
        }

        const auditRef = doc(collection(db, `${protocolPath}/audits`), auditId);
        await setDoc(auditRef, auditEntry);
        console.log('Audit entry created successfully');

        // Update only the selected reviewer in the reviewers array
        const updatedReviewers = protocol.reviewers?.map(reviewer => 
          reviewer.id === currentReviewer.id ? newReviewer : reviewer
        ) || [newReviewer];

        // Update the protocol with the updated reviewers array
        await updateDoc(protocolRef, {
          reviewers: updatedReviewers,
          updated_at: timestamp
        });

        console.log('Protocol updated successfully');

        // Call onSuccess with the new reviewer info
        onSuccess({
          id: newReviewerInfo.id,
          name: newReviewerInfo.name,
          due_date: newDueDate
        });

      } catch (err) {
        console.error('Error updating protocol:', err);
        throw new Error('Failed to update protocol');
      }

    } catch (err) {
      console.error('Error in handleSubmit:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  if (!isOpen || !protocol || !currentReviewer) {
    console.log('Modal not rendered:', { isOpen, hasProtocol: !!protocol, hasCurrentReviewer: !!currentReviewer });
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold mb-4">Reassign Protocol</h2>
        
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">Protocol: {protocol.protocol_name}</p>
          <p className="text-sm text-gray-600">Current Reviewer: {currentReviewer.name}</p>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4" ref={searchRef}>
            <label htmlFor="reviewer" className="block text-sm font-medium text-gray-700 mb-1">
              Select New Reviewer
            </label>
            <div className="relative">
              <input
                type="text"
                id="reviewer"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                placeholder="Search for a reviewer..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
              {showSuggestions && filteredReviewers.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                  {filteredReviewers.map((reviewer) => (
                    <div
                      key={reviewer.id}
                      className="px-4 py-2 hover:bg-blue-50 cursor-pointer"
                      onClick={() => {
                        setSelectedReviewer(reviewer.id);
                        setSearchTerm(reviewer.name);
                        setShowSuggestions(false);
                      }}
                    >
                      {reviewer.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mb-4">
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              id="status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                if (e.target.value === 'Completed') {
                  setNewDueDate('');
                }
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="In Progress">In Progress</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          {status === 'In Progress' && (
            <div className="mb-4">
              <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700 mb-1">
                New Due Date
              </label>
              <input
                type="date"
                id="dueDate"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                required={status === 'In Progress'}
              />
            </div>
          )}

          {error && (
            <div className="mb-4 p-2 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedReviewer}
              className={`px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                loading || !selectedReviewer
                  ? 'bg-blue-300 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
              }`}
            >
              {loading ? 'Reassigning...' : 'Reassign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
} 