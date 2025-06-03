import React, { useState, useEffect } from 'react';
import { doc, updateDoc, setDoc, Timestamp, collection } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { formatDate } from '@/lib/utils';

interface Reviewer {
  id: string;
  name: string;
  form_type?: string;
  status?: string;
  due_date?: string;
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
  
  
  useEffect(() => {
    if (isOpen && (currentReviewer.due_date || protocol.due_date)) {
      setSelectedReviewer('');
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
  }, [isOpen, protocol?.due_date, currentReviewer?.due_date]);

  // Reset newDueDate when reviewer changes (if you want to recalculate based on the new reviewer)
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
      newDueDate
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

    // Validate due date format
    if (!newDueDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDueDate)) {
      console.error('Invalid due date format:', newDueDate);
      setError('Invalid due date format');
      return;
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

      if (!newDueDate) {
        throw new Error('Due date is required');
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
        status: 'In Progress',
        due_date: newDueDate || ''
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
        type: 'reassignment'
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

        console.log('Creating audit in subcollection at path:', `${protocolPath}/audits/${auditId}`);
        
        // Create the audit document in the subcollection
        const auditRef = doc(db, protocolPath, 'audits', auditId);
        await setDoc(auditRef, auditEntry);
        console.log('Successfully created audit document in subcollection');
      } catch (err) {
        console.error('Error creating audit document:', err);
        throw new Error('Failed to create audit document');
      }

      // Update protocol with new reviewer
      if (protocol.reviewers && protocol.reviewers.length > 0) {
        const updatedReviewers = protocol.reviewers.map(r => 
          r.id === currentReviewer.id ? {
            ...r,  // Keep all existing reviewer properties
            id: newReviewerInfo.id,
            name: newReviewerInfo.name,
            due_date: newDueDate
          } : r
        );
        
        console.log('Updating protocol with reviewers array:', updatedReviewers);
        
        const updateData: {
          reviewers: Reviewer[];
          last_audit_id: string;
          last_audit_date: typeof timestamp;
          updated_at: typeof timestamp;
          last_reviewer: string;
          [key: string]: any;
        } = {
          reviewers: updatedReviewers,
          last_audit_id: auditId,
          last_audit_date: timestamp,
          updated_at: timestamp,
          last_reviewer: currentReviewer.name || ''
        };

        // Log each field before update
        console.log('Update data before cleanup:', JSON.stringify(updateData, null, 2));
        
        // Remove any undefined values and log which ones were removed
        Object.keys(updateData).forEach(key => {
          if (updateData[key] === undefined) {
            console.log(`Removing undefined field: ${key}`);
            delete updateData[key];
          }
        });
        
        // Log final update data
        console.log('Final update data:', JSON.stringify(updateData, null, 2));
        
        await updateDoc(protocolRef, updateData);
      } else {
        console.log('Updating legacy protocol');
        const updateData: {
          reviewer: string;
          due_date: string;
          reviewers: Reviewer[];
          last_audit_id: string;
          last_audit_date: typeof timestamp;
          updated_at: typeof timestamp;
          last_reviewer: string;
          [key: string]: any;
        } = {
          reviewer: newReviewerInfo.name || '',
          due_date: newDueDate || '',
          reviewers: [{
            id: newReviewerInfo.id,
            name: newReviewerInfo.name,
            status: 'In Progress',
            due_date: newDueDate,
            form_type: protocol.form_type || ''
          }],
          last_audit_id: auditId,
          last_audit_date: timestamp,
          updated_at: timestamp,
          last_reviewer: currentReviewer.name || ''
        };

        // Log each field before update
        console.log('Update data before cleanup:', JSON.stringify(updateData, null, 2));
        
        // Remove any undefined values and log which ones were removed
        Object.keys(updateData).forEach(key => {
          if (updateData[key] === undefined) {
            console.log(`Removing undefined field: ${key}`);
            delete updateData[key];
          }
        });
        
        // Log final update data
        console.log('Final update data:', JSON.stringify(updateData, null, 2));
        
        await updateDoc(protocolRef, updateData);
      }

      console.log('Protocol updated successfully');
      onSuccess({
        id: newReviewerInfo.id,
        name: newReviewerInfo.name,
        due_date: newDueDate
      });
    } catch (err) {
      console.error('Error during reassignment:', err);
      setError(err instanceof Error ? err.message : 'Failed to reassign reviewer. Please try again.');
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
        <div className="mb-4">
            <label htmlFor="reviewer" className="block text-sm font-medium text-gray-700 mb-1">
            Select New Reviewer
          </label>
          <select
              id="reviewer"
            value={selectedReviewer}
              onChange={(e) => {
                console.log('Reviewer selected:', e.target.value);
                setSelectedReviewer(e.target.value);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
          >
            <option value="">Select a reviewer</option>
              {reviewerList.map((reviewer) => (
                <option key={reviewer.id} value={reviewer.id}>
                  {reviewer.name}
                </option>
              ))}
          </select>
        </div>
        
          <div className="mb-4">
            <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700 mb-1">
              New Due Date
            </label>
          <input
            type="date"
              id="dueDate"
              value={newDueDate || ''}
              onChange={(e) => {
                console.log('Due date changed:', e.target.value);
                setNewDueDate(e.target.value);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              required
            />
            <p className="mt-1 text-sm text-gray-500">
              Original due date: {formatDate(currentReviewer.due_date || protocol.due_date)}
          </p>
        </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        
        <div className="flex justify-end space-x-3">
          <button
            type="button"
            onClick={onCancel}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            disabled={loading}
          >
            Cancel
          </button>
          <button
              type="submit"
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            disabled={loading || !selectedReviewer}
              onClick={() => console.log('Reassign button clicked')}
            >
              {loading ? 'Reassigning...' : 'Reassign'}
          </button>
        </div>
        </form>
      </div>
    </div>
  );
} 