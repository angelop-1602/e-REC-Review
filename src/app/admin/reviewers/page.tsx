'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, collectionGroup, getDocs, doc, deleteDoc, updateDoc, query, orderBy, setDoc, deleteField } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import {
  WEEK_IDS,
  buildNotificationProtocols,
  getProtocolPathParts,
  groupProtocolsByMonth,
  normalizeProtocolData,
  type Protocol,
} from '@/lib/protocols';

interface Reviewer {
  id: string;
  name: string;
  email?: string;
}

type MailScope = 'month' | 'week';

interface SendSummary {
  sent: unknown[];
  skipped: unknown[];
  failed: unknown[];
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function formatNotificationSummary(summary: SendSummary): string {
  const parts = [];

  if (summary.sent.length > 0) {
    parts.push(`sent ${summary.sent.length} email${summary.sent.length === 1 ? '' : 's'}`);
  }

  if (summary.skipped.length > 0) {
    parts.push(`skipped ${summary.skipped.length}`);
  }

  if (summary.failed.length > 0) {
    parts.push(`${summary.failed.length} failed`);
  }

  return parts.length > 0 ? parts.join(', ') : 'no email was sent';
}

function normalizeMatchValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isReviewerAssignmentMatch(
  assignment: { id?: string; name?: string },
  reviewer: Reviewer
): boolean {
  const assignmentValues = [
    normalizeMatchValue(assignment.id),
    normalizeMatchValue(assignment.name),
  ].filter(Boolean);
  const reviewerValues = [
    normalizeMatchValue(reviewer.id),
    normalizeMatchValue(reviewer.name),
  ].filter(Boolean);

  return assignmentValues.some((value) => reviewerValues.includes(value));
}

function getProtocolsForReviewer(protocols: Protocol[], reviewer: Reviewer): Protocol[] {
  return protocols.filter((protocol) =>
    (protocol.reviewers || []).some((assignment) => isReviewerAssignmentMatch(assignment, reviewer))
  );
}

export default function ReviewersPage() {
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [loading, setLoading] = useState(true);
  const [protocolLoading, setProtocolLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [protocolError, setProtocolError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // New reviewer form state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [newReviewerId, setNewReviewerId] = useState('');
  const [newReviewerName, setNewReviewerName] = useState('');
  const [newReviewerEmail, setNewReviewerEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectedReviewer, setSelectedReviewer] = useState<Reviewer | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState('');
  const [isMailModalOpen, setIsMailModalOpen] = useState(false);
  const [mailReviewer, setMailReviewer] = useState<Reviewer | null>(null);
  const [mailScope, setMailScope] = useState<MailScope>('month');
  const [selectedMailMonthId, setSelectedMailMonthId] = useState('');
  const [selectedMailWeekId, setSelectedMailWeekId] = useState('');
  const [sendingMail, setSendingMail] = useState(false);
  const [mailError, setMailError] = useState<string | null>(null);
  
  // Notification state
  const [notification, setNotification] = useState({
    show: false,
    message: '',
    type: 'success' as 'success' | 'error'
  });
  
  useEffect(() => {
    fetchReviewers();
    fetchProtocolPeriods();
  }, []);
  
  const fetchReviewers = async () => {
    try {
      setLoading(true);
      const reviewersRef = collection(db, 'reviewers');
      const q = query(reviewersRef, orderBy('name'));
      const querySnapshot = await getDocs(q);
      
      const reviewersList: Reviewer[] = [];
      querySnapshot.forEach((doc) => {
        reviewersList.push({ 
          id: doc.id, 
          name: doc.data().name || doc.id,
          email: typeof doc.data().email === 'string' ? doc.data().email : '',
        });
      });
      
      setReviewers(reviewersList);
      setError(null);
    } catch (err) {
      console.error('Error fetching reviewers:', err);
      setError('Failed to load reviewers');
    } finally {
      setLoading(false);
    }
  };

  const fetchProtocolPeriods = async () => {
    try {
      setProtocolLoading(true);
      setProtocolError(null);

      const fetchedProtocols: Protocol[] = [];

      for (const weekId of WEEK_IDS) {
        const protocolsGroupQuery = query(collectionGroup(db, weekId));
        const protocolsGroupSnapshot = await getDocs(protocolsGroupQuery);

        for (const protocolDoc of protocolsGroupSnapshot.docs) {
          const pathParts = getProtocolPathParts(protocolDoc.ref.path);

          if (!pathParts) {
            continue;
          }

          fetchedProtocols.push(
            normalizeProtocolData(protocolDoc.id, protocolDoc.data(), pathParts.monthId, pathParts.weekId)
          );
        }
      }

      const monthGroups = groupProtocolsByMonth(fetchedProtocols);

      setProtocols(fetchedProtocols);
      setSelectedMailMonthId((currentMonthId) => currentMonthId || monthGroups[0]?.monthId || '');
      setSelectedMailWeekId((currentWeekId) => currentWeekId || monthGroups[0]?.weeks[0]?.weekId || '');
    } catch (err) {
      console.error('Error fetching protocol periods:', err);
      setProtocolError('Failed to load month and week options for reviewer email.');
    } finally {
      setProtocolLoading(false);
    }
  };
  
  // Function to add a new reviewer
  const addReviewer = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setIsSubmitting(true);
      setFormError(null);
      
      // Validate form
      if (!newReviewerId.trim() || !newReviewerName.trim()) {
        setFormError('Reviewer ID and name are required');
        return;
      }

      if (newReviewerEmail.trim() && !isValidEmail(newReviewerEmail.trim())) {
        setFormError('Please enter a valid email address');
        return;
      }
      
      // Check if the ID already exists
      const existingReviewer = reviewers.find(r => r.id === newReviewerId);
      if (existingReviewer) {
        setFormError('A reviewer with this ID already exists');
        return;
      }
      
      // Add to Firestore
      const reviewerRef = doc(collection(db, 'reviewers'), newReviewerId);
      await setDoc(reviewerRef, {
        name: newReviewerName,
        ...(newReviewerEmail.trim() ? { email: newReviewerEmail.trim() } : {}),
      }, { merge: true });
      
      // Refresh the list
      await fetchReviewers();
      
      // Reset form
      setNewReviewerId('');
      setNewReviewerName('');
      setNewReviewerEmail('');
      setIsAddModalOpen(false);
      
      showNotification('Reviewer added successfully', 'success');
    } catch (err) {
      console.error('Error adding reviewer:', err);
      setFormError(`Failed to add reviewer: ${err}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Function to edit a reviewer
  const editReviewer = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedReviewer) return;
    
    try {
      setIsSubmitting(true);
      setFormError(null);
      
      // Validate form
      if (!newReviewerName.trim()) {
        setFormError('Reviewer name is required');
        return;
      }

      if (newReviewerEmail.trim() && !isValidEmail(newReviewerEmail.trim())) {
        setFormError('Please enter a valid email address');
        return;
      }
      
      // Update in Firestore
      const reviewerRef = doc(collection(db, 'reviewers'), selectedReviewer.id);
      await updateDoc(reviewerRef, {
        name: newReviewerName,
        email: newReviewerEmail.trim() ? newReviewerEmail.trim() : deleteField(),
      });
      
      // Refresh the list
      await fetchReviewers();
      
      // Reset form
      setSelectedReviewer(null);
      setNewReviewerName('');
      setNewReviewerEmail('');
      setIsEditModalOpen(false);
      
      showNotification('Reviewer updated successfully', 'success');
    } catch (err) {
      console.error('Error updating reviewer:', err);
      setFormError(`Failed to update reviewer: ${err}`);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Function to delete a reviewer
  const deleteReviewer = async () => {
    if (!confirmDeleteId) return;
    
    try {
      setIsSubmitting(true);
      
      // Delete from Firestore
      await deleteDoc(doc(collection(db, 'reviewers'), confirmDeleteId));
      
      // Refresh the list
      await fetchReviewers();
      
      // Reset state
      setConfirmDeleteId('');
      setIsDeleteModalOpen(false);
      
      showNotification('Reviewer deleted successfully', 'success');
    } catch (err) {
      console.error('Error deleting reviewer:', err);
      showNotification(`Failed to delete reviewer: ${err}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Function to open edit modal
  const openEditModal = (reviewer: Reviewer) => {
    setSelectedReviewer(reviewer);
    setNewReviewerName(reviewer.name);
    setNewReviewerEmail(reviewer.email || '');
    setFormError(null);
    setIsEditModalOpen(true);
  };
  
  // Function to open delete confirmation modal
  const openDeleteModal = (id: string) => {
    setConfirmDeleteId(id);
    setIsDeleteModalOpen(true);
  };

  const openMailModal = (reviewer: Reviewer) => {
    const reviewerMonthGroups = groupProtocolsByMonth(getProtocolsForReviewer(protocols, reviewer));
    const firstMonth = reviewerMonthGroups[0];

    setMailReviewer(reviewer);
    setMailScope('month');
    setSelectedMailMonthId(firstMonth?.monthId || '');
    setSelectedMailWeekId(firstMonth?.weeks[0]?.weekId || '');
    setMailError(null);
    setIsMailModalOpen(true);
  };
  
  // Function to show notification
  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({
      show: true,
      message,
      type
    });
    
    // Auto-hide notification after 3 seconds
    setTimeout(() => {
      setNotification(prev => ({ ...prev, show: false }));
    }, 3000);
  };
  
  // Filter reviewers based on search query
  const filteredReviewers = reviewers.filter(reviewer => 
    reviewer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    reviewer.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (reviewer.email || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const monthGroups = useMemo(() => groupProtocolsByMonth(protocols), [protocols]);
  const reviewerMailMonthGroups = useMemo(() => (
    mailReviewer ? groupProtocolsByMonth(getProtocolsForReviewer(protocols, mailReviewer)) : []
  ), [mailReviewer, protocols]);
  const availableMailMonthGroups = mailReviewer ? reviewerMailMonthGroups : monthGroups;
  const selectedMailMonth = useMemo(
    () => availableMailMonthGroups.find((month) => month.monthId === selectedMailMonthId) || availableMailMonthGroups[0],
    [availableMailMonthGroups, selectedMailMonthId]
  );
  const selectedMailWeek = useMemo(
    () => selectedMailMonth?.weeks.find((week) => week.weekId === selectedMailWeekId) || selectedMailMonth?.weeks[0],
    [selectedMailMonth, selectedMailWeekId]
  );
  const selectedIndividualProtocols = useMemo(() => {
    if (!mailReviewer || !selectedMailMonth) {
      return [];
    }

    const periodProtocols = mailScope === 'week'
      ? selectedMailWeek?.protocols ?? []
      : selectedMailMonth.protocols;

    return periodProtocols.filter((protocol) =>
      (protocol.reviewers || []).some((reviewer) => isReviewerAssignmentMatch(reviewer, mailReviewer))
    );
  }, [mailReviewer, mailScope, selectedMailMonth, selectedMailWeek]);

  useEffect(() => {
    if (!selectedMailMonthId && availableMailMonthGroups[0]) {
      setSelectedMailMonthId(availableMailMonthGroups[0].monthId);
    }
  }, [availableMailMonthGroups, selectedMailMonthId]);

  useEffect(() => {
    if (!selectedMailMonth) {
      setSelectedMailWeekId('');
      return;
    }

    if (!selectedMailWeekId || !selectedMailMonth.weeks.some((week) => week.weekId === selectedMailWeekId)) {
      setSelectedMailWeekId(selectedMailMonth.weeks[0]?.weekId || '');
    }
  }, [selectedMailMonth, selectedMailWeekId]);

  const sendIndividualReviewerMail = async () => {
    if (!mailReviewer || !selectedMailMonth) {
      return;
    }

    if (!mailReviewer.email) {
      setMailError('This reviewer does not have an email address.');
      return;
    }

    if (mailScope === 'week' && !selectedMailWeek) {
      setMailError('Please select a week.');
      return;
    }

    if (selectedIndividualProtocols.length === 0) {
      setMailError('This reviewer has no protocols for the selected period.');
      return;
    }

    setSendingMail(true);
    setMailError(null);

    try {
      const notificationProtocols = buildNotificationProtocols(selectedIndividualProtocols)
        .map((protocol) => ({
          ...protocol,
          reviewers: protocol.reviewers
            .filter((reviewer) => isReviewerAssignmentMatch(reviewer, mailReviewer))
            .map((reviewer) => ({
              ...reviewer,
              id: mailReviewer.id,
              name: mailReviewer.name,
            })),
        }))
        .filter((protocol) => protocol.reviewers.length > 0);

      const response = await fetch('/api/admin/review-notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: mailScope,
          monthDocumentId: selectedMailMonth.monthId,
          weekId: mailScope === 'week' ? selectedMailWeek?.weekId : undefined,
          protocols: notificationProtocols,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send reviewer email.');
      }

      const hasProblems = result.failed?.length > 0 || result.sent?.length === 0;
      const periodLabel = mailScope === 'week'
        ? `${selectedMailMonth.monthLabel} ${selectedMailWeek?.weekLabel}`
        : selectedMailMonth.monthLabel;

      setIsMailModalOpen(false);
      setMailReviewer(null);
      showNotification(
        `${mailReviewer.name} - ${periodLabel}: ${formatNotificationSummary(result as SendSummary)}.`,
        hasProblems ? 'error' : 'success'
      );
    } catch (err) {
      console.error('Error sending individual reviewer email:', err);
      setMailError(err instanceof Error ? err.message : 'Failed to send reviewer email.');
    } finally {
      setSendingMail(false);
    }
  };
  
  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md flex justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
        <p className="ml-3">Loading reviewers...</p>
      </div>
    );
  }
  
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Reviewers Management</h1>
        <div className="flex space-x-4">
          <button
            onClick={() => {
              setNewReviewerId('');
              setNewReviewerName('');
              setNewReviewerEmail('');
              setFormError(null);
              setIsAddModalOpen(true);
            }}
            className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600"
          >
            Add New Reviewer
          </button>
        </div>
      </div>
      
      {error && (
        <div className="p-4 bg-red-100 text-red-800 rounded">
          {error}
        </div>
      )}

      {protocolError && (
        <div className="p-4 bg-yellow-100 text-yellow-800 rounded">
          {protocolError}
        </div>
      )}
      
      {/* Notification */}
      {notification.show && (
        <div className={`fixed top-4 right-4 p-4 rounded shadow-lg ${
          notification.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {notification.message}
        </div>
      )}
      
      {/* Search Bar */}
      <div className="bg-white p-4 rounded-lg shadow-md">
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or ID..."
            className="w-full p-2 pl-10 border rounded-md"
          />
          <div className="absolute left-3 top-2.5 text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-6">All Reviewers ({filteredReviewers.length})</h2>
        
        {reviewers.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No reviewers found in the database.</p>
            <p className="text-gray-600 mt-2">
              You&apos;ll need to create reviewers before they can be assigned to protocols. Click &quot;Add Reviewer&quot; to get started.
            </p>
          </div>
        ) : filteredReviewers.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No reviewers found matching your search criteria.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredReviewers.map((reviewer) => (
              <div 
                key={reviewer.id} 
                className="p-4 border rounded-lg hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-800 font-bold">
                      {reviewer.name.charAt(0)}
                    </div>
                    <div className="ml-3">
                      <p className="font-medium">{reviewer.name}</p>
                      <p className="text-xs text-gray-500">{reviewer.id}</p>
                      <p className="text-xs text-gray-500">{reviewer.email || 'No email'}</p>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={() => openMailModal(reviewer)}
                      disabled={!reviewer.email || protocolLoading || monthGroups.length === 0}
                      className={`${
                        reviewer.email && !protocolLoading && monthGroups.length > 0
                          ? 'text-green-600 hover:text-green-800'
                          : 'text-gray-300 cursor-not-allowed'
                      }`}
                      title={
                        !reviewer.email
                          ? 'Reviewer has no email'
                          : protocolLoading
                            ? 'Loading periods'
                            : 'Send review email'
                      }
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 8h18a2 2 0 002-2V8a2 2 0 00-2-2H3a2 2 0 00-2 2v6a2 2 0 002 2z" />
                      </svg>
                    </button>
                    <button 
                      onClick={() => openEditModal(reviewer)}
                      className="text-blue-500 hover:text-blue-700"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button 
                      onClick={() => openDeleteModal(reviewer.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Individual Reviewer Email Modal */}
      {isMailModalOpen && mailReviewer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-lg">
            <h2 className="text-xl font-semibold mb-2">Send Review Email</h2>
            <p className="text-sm text-gray-600 mb-5">
              {mailReviewer.name} - {mailReviewer.email || 'No email'}
            </p>

            {mailError && (
              <div className="mb-4 p-2 bg-red-100 text-red-800 rounded">
                {mailError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="mailScope" className="block text-sm font-medium text-gray-700 mb-1">
                  Send For
                </label>
                <select
                  id="mailScope"
                  value={mailScope}
                  onChange={(e) => {
                    setMailScope(e.target.value as MailScope);
                    setMailError(null);
                  }}
                  className="w-full p-2 border rounded-md"
                >
                  <option value="month">Full Month</option>
                  <option value="week">Specific Week</option>
                </select>
              </div>

              <div>
                <label htmlFor="mailMonth" className="block text-sm font-medium text-gray-700 mb-1">
                  Month
                </label>
                <select
                  id="mailMonth"
                  value={selectedMailMonth?.monthId || ''}
                  onChange={(e) => {
                    const monthId = e.target.value;
                    const month = availableMailMonthGroups.find((monthGroup) => monthGroup.monthId === monthId);

                    setSelectedMailMonthId(monthId);
                    setSelectedMailWeekId(month?.weeks[0]?.weekId || '');
                    setMailError(null);
                  }}
                  className="w-full p-2 border rounded-md"
                >
                  {availableMailMonthGroups.map((month) => (
                    <option key={month.monthId} value={month.monthId}>
                      {month.monthLabel}
                    </option>
                  ))}
                </select>
              </div>

              {mailScope === 'week' && (
                <div>
                  <label htmlFor="mailWeek" className="block text-sm font-medium text-gray-700 mb-1">
                    Week
                  </label>
                  <select
                    id="mailWeek"
                    value={selectedMailWeek?.weekId || ''}
                    onChange={(e) => {
                      setSelectedMailWeekId(e.target.value);
                      setMailError(null);
                    }}
                    className="w-full p-2 border rounded-md"
                  >
                    {(selectedMailMonth?.weeks || []).map((week) => (
                      <option key={week.weekId} value={week.weekId}>
                        {week.weekLabel}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700">
                {availableMailMonthGroups.length === 0
                  ? 'No uploaded protocols match this reviewer yet. Check that the reviewer ID or name in the protocol assignment matches this reviewer record.'
                  : `${selectedIndividualProtocols.length} protocol${selectedIndividualProtocols.length === 1 ? '' : 's'} will be included for this reviewer.`}
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setIsMailModalOpen(false);
                  setMailReviewer(null);
                  setMailError(null);
                }}
                className="bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300"
                disabled={sendingMail}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendIndividualReviewerMail}
                className="bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700 disabled:opacity-50"
                disabled={sendingMail || availableMailMonthGroups.length === 0 || selectedIndividualProtocols.length === 0 || !mailReviewer.email}
              >
                {sendingMail ? 'Sending...' : 'Send Email'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Add Reviewer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Add New Reviewer</h2>
            
            <form onSubmit={addReviewer}>
              {formError && (
                <div className="mb-4 p-2 bg-red-100 text-red-800 rounded">
                  {formError}
                </div>
              )}
              
              <div className="mb-4">
                <label htmlFor="reviewerId" className="block text-sm font-medium text-gray-700 mb-1">
                  Reviewer ID
                </label>
                <input
                  type="text"
                  id="reviewerId"
                  value={newReviewerId}
                  onChange={(e) => setNewReviewerId(e.target.value)}
                  placeholder="e.g. DRAPL-001"
                  className="w-full p-2 border rounded-md"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use a unique identifier for the reviewer (e.g. DRAPL-001)
                </p>
              </div>
              
              <div className="mb-6">
                <label htmlFor="reviewerName" className="block text-sm font-medium text-gray-700 mb-1">
                  Reviewer Name
                </label>
                <input
                  type="text"
                  id="reviewerName"
                  value={newReviewerName}
                  onChange={(e) => setNewReviewerName(e.target.value)}
                  placeholder="e.g. Dr. John Doe"
                  className="w-full p-2 border rounded-md"
                  required
                />
              </div>

              <div className="mb-6">
                <label htmlFor="reviewerEmail" className="block text-sm font-medium text-gray-700 mb-1">
                  Reviewer Email
                </label>
                <input
                  type="email"
                  id="reviewerEmail"
                  value={newReviewerEmail}
                  onChange={(e) => setNewReviewerEmail(e.target.value)}
                  placeholder="reviewer@spup.edu.ph"
                  className="w-full p-2 border rounded-md"
                />
              </div>
              
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setNewReviewerId('');
                    setNewReviewerName('');
                    setNewReviewerEmail('');
                    setFormError(null);
                  }}
                  className="bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Adding...' : 'Add Reviewer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Edit Reviewer Modal */}
      {isEditModalOpen && selectedReviewer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-4">Edit Reviewer</h2>
            
            <form onSubmit={editReviewer}>
              {formError && (
                <div className="mb-4 p-2 bg-red-100 text-red-800 rounded">
                  {formError}
                </div>
              )}
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reviewer ID
                </label>
                <input
                  type="text"
                  value={selectedReviewer.id}
                  className="w-full p-2 border rounded-md bg-gray-100"
                  disabled
                />
                <p className="text-xs text-gray-500 mt-1">
                  Reviewer ID cannot be changed
                </p>
              </div>
              
              <div className="mb-6">
                <label htmlFor="editReviewerName" className="block text-sm font-medium text-gray-700 mb-1">
                  Reviewer Name
                </label>
                <input
                  type="text"
                  id="editReviewerName"
                  value={newReviewerName}
                  onChange={(e) => setNewReviewerName(e.target.value)}
                  placeholder="e.g. Dr. John Doe"
                  className="w-full p-2 border rounded-md"
                  required
                />
              </div>

              <div className="mb-6">
                <label htmlFor="editReviewerEmail" className="block text-sm font-medium text-gray-700 mb-1">
                  Reviewer Email
                </label>
                <input
                  type="email"
                  id="editReviewerEmail"
                  value={newReviewerEmail}
                  onChange={(e) => setNewReviewerEmail(e.target.value)}
                  placeholder="reviewer@spup.edu.ph"
                  className="w-full p-2 border rounded-md"
                />
              </div>
              
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setSelectedReviewer(null);
                    setNewReviewerName('');
                    setNewReviewerEmail('');
                    setFormError(null);
                  }}
                  className="bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-2">Confirm Deletion</h2>
            <p className="mb-4 text-gray-600">
              Are you sure you want to delete this reviewer? This action cannot be undone.
            </p>
            
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteReviewer}
                className="bg-red-500 text-white py-2 px-4 rounded hover:bg-red-600 disabled:opacity-50"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Deleting...' : 'Delete Reviewer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 
