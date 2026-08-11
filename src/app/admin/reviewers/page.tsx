'use client';

import Link from 'next/link';
import { useState, useEffect, useMemo } from 'react';
import {
  buildNotificationProtocols,
  getMonthSortValue,
  groupProtocolsByMonth,
  type MonthGroup,
  type Protocol,
} from '@/lib/protocols';
import {
  getProtocolsForReviewer,
  getReviewerAssignmentStats,
  isReviewerAssignmentMatch,
  type ReviewerRecord,
} from '@/lib/reviewerProfiles';

type Reviewer = ReviewerRecord;

type MailScope = 'month' | 'week';

interface SendSummary {
  sent: unknown[];
  skipped: unknown[];
  failed: unknown[];
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'The request failed.');
  }
  return payload as T;
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

function getCurrentMonthSortValue(): number {
  const now = new Date();

  return now.getFullYear() * 100 + now.getMonth() + 1;
}

function getDefaultMailMonthId(monthGroups: MonthGroup[]): string {
  const currentMonthValue = getCurrentMonthSortValue();

  return monthGroups.find((month) => getMonthSortValue(month.monthId) === currentMonthValue)?.monthId
    || monthGroups[0]?.monthId
    || '';
}

function getMonthRangeGroups(monthGroups: MonthGroup[], startMonthId: string, endMonthId: string): MonthGroup[] {
  const startMonth = monthGroups.find((month) => month.monthId === startMonthId);
  const endMonth = monthGroups.find((month) => month.monthId === endMonthId) || startMonth;

  if (!startMonth || !endMonth) {
    return [];
  }

  const startSort = getMonthSortValue(startMonth.monthId);
  const endSort = getMonthSortValue(endMonth.monthId);
  const minSort = Math.min(startSort, endSort);
  const maxSort = Math.max(startSort, endSort);

  return monthGroups
    .filter((month) => {
      const monthSort = getMonthSortValue(month.monthId);

      return monthSort >= minSort && monthSort <= maxSort;
    })
    .sort((left, right) => getMonthSortValue(left.monthId) - getMonthSortValue(right.monthId));
}

function formatMonthRangeLabel(monthGroups: MonthGroup[]): string {
  if (monthGroups.length === 0) {
    return '';
  }

  const firstMonth = monthGroups[0];
  const lastMonth = monthGroups[monthGroups.length - 1];

  return firstMonth.monthId === lastMonth.monthId
    ? firstMonth.monthLabel
    : `${firstMonth.monthLabel} to ${lastMonth.monthLabel}`;
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
  const [selectedMailEndMonthId, setSelectedMailEndMonthId] = useState('');
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
      const { reviewers: reviewersList } = await requestJson<{ reviewers: Reviewer[] }>('/api/admin/reviewers');
      
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

      const { protocols: fetchedProtocols } = await requestJson<{ protocols: Protocol[] }>(
        '/api/admin/reviewers/protocol-periods'
      );

      const monthGroups = groupProtocolsByMonth(fetchedProtocols);
      const defaultMonthId = getDefaultMailMonthId(monthGroups);
      const defaultMonth = monthGroups.find((month) => month.monthId === defaultMonthId);

      setProtocols(fetchedProtocols);
      setSelectedMailMonthId((currentMonthId) => currentMonthId || defaultMonthId);
      setSelectedMailEndMonthId((currentMonthId) => currentMonthId || defaultMonthId);
      setSelectedMailWeekId((currentWeekId) => currentWeekId || defaultMonth?.weeks[0]?.weekId || '');
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
      
      await requestJson('/api/admin/reviewers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newReviewerId.trim(),
          name: newReviewerName.trim(),
          email: newReviewerEmail.trim(),
        }),
      });
      
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
      
      await requestJson(`/api/admin/reviewers/${encodeURIComponent(selectedReviewer.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newReviewerName.trim(),
          email: newReviewerEmail.trim(),
        }),
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
      
      await requestJson(`/api/admin/reviewers/${encodeURIComponent(confirmDeleteId)}`, {
        method: 'DELETE',
      });
      
      // Refresh the list
      await fetchReviewers();
      
      // Reset state
      setConfirmDeleteId('');
      setIsDeleteModalOpen(false);
      
      showNotification('Reviewer archived successfully', 'success');
    } catch (err) {
      console.error('Error deleting reviewer:', err);
      showNotification(`Failed to archive reviewer: ${err}`, 'error');
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
    const defaultMonthId = getDefaultMailMonthId(reviewerMonthGroups);
    const defaultMonth = reviewerMonthGroups.find((month) => month.monthId === defaultMonthId);

    setMailReviewer(reviewer);
    setMailScope('month');
    setSelectedMailMonthId(defaultMonthId);
    setSelectedMailEndMonthId(defaultMonthId);
    setSelectedMailWeekId(defaultMonth?.weeks[0]?.weekId || '');
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
  const reviewerStats = useMemo(() => new Map(
    reviewers.map((reviewer) => [reviewer.id, getReviewerAssignmentStats(protocols, reviewer)])
  ), [protocols, reviewers]);
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
  const selectedMailMonthRangeGroups = useMemo(
    () => getMonthRangeGroups(
      availableMailMonthGroups,
      selectedMailMonthId,
      selectedMailEndMonthId || selectedMailMonthId
    ),
    [availableMailMonthGroups, selectedMailEndMonthId, selectedMailMonthId]
  );
  const selectedMailPeriodLabel = useMemo(() => {
    if (mailScope === 'week') {
      return selectedMailMonth && selectedMailWeek
        ? `${selectedMailMonth.monthLabel} ${selectedMailWeek.weekLabel}`
        : '';
    }

    return formatMonthRangeLabel(selectedMailMonthRangeGroups);
  }, [mailScope, selectedMailMonth, selectedMailMonthRangeGroups, selectedMailWeek]);
  const selectedIndividualProtocols = useMemo(() => {
    if (!mailReviewer) {
      return [];
    }

    const periodProtocols = mailScope === 'week'
      ? selectedMailWeek?.protocols ?? []
      : selectedMailMonthRangeGroups.flatMap((month) => month.protocols);

    return periodProtocols.filter((protocol) =>
      (protocol.reviewers || []).some((reviewer) => isReviewerAssignmentMatch(reviewer, mailReviewer))
    );
  }, [mailReviewer, mailScope, selectedMailMonthRangeGroups, selectedMailWeek]);

  useEffect(() => {
    if (availableMailMonthGroups.length === 0) {
      setSelectedMailMonthId('');
      setSelectedMailEndMonthId('');
      return;
    }

    const hasSelectedStartMonth = availableMailMonthGroups.some((month) => month.monthId === selectedMailMonthId);
    const hasSelectedEndMonth = availableMailMonthGroups.some((month) => month.monthId === selectedMailEndMonthId);

    if (!selectedMailMonthId || !hasSelectedStartMonth) {
      const defaultMonthId = getDefaultMailMonthId(availableMailMonthGroups);

      setSelectedMailMonthId(defaultMonthId);
      setSelectedMailEndMonthId(defaultMonthId);
      return;
    }

    if (!selectedMailEndMonthId || !hasSelectedEndMonth) {
      setSelectedMailEndMonthId(selectedMailMonthId);
    }
  }, [availableMailMonthGroups, selectedMailEndMonthId, selectedMailMonthId]);

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
    if (!mailReviewer) {
      return;
    }

    if (!mailReviewer.email) {
      setMailError('This reviewer does not have an email address.');
      return;
    }

    if (mailScope === 'week' && (!selectedMailMonth || !selectedMailWeek)) {
      setMailError('Please select a week.');
      return;
    }

    if (mailScope === 'month' && selectedMailMonthRangeGroups.length === 0) {
      setMailError('Please select a month range.');
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
      const notificationMonthId = mailScope === 'week'
        ? selectedMailMonth?.monthId
        : selectedMailMonthRangeGroups[0]?.monthId;

      if (!notificationMonthId || !selectedMailPeriodLabel) {
        setMailError('Please select a valid month period.');
        return;
      }

      const response = await fetch('/api/admin/review-notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: mailScope,
          monthDocumentId: notificationMonthId,
          weekId: mailScope === 'week' ? selectedMailWeek?.weekId : undefined,
          periodLabel: selectedMailPeriodLabel,
          protocols: notificationProtocols,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send reviewer email.');
      }

      const hasProblems = result.failed?.length > 0 || result.sent?.length === 0;

      setIsMailModalOpen(false);
      setMailReviewer(null);
      showNotification(
        `${mailReviewer.name} - ${selectedMailPeriodLabel}: ${formatNotificationSummary(result as SendSummary)}. Track details on the Mailing page.`,
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
            placeholder="Search by name, ID, or email..."
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
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Reviewer</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Reviewer ID</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Email</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Assigned</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Completed</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Pending</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredReviewers.map((reviewer) => {
                  const stats = reviewerStats.get(reviewer.id) ?? {
                    total: 0,
                    completed: 0,
                    pending: 0,
                    overdue: 0,
                    dueSoon: 0,
                  };

                  return (
                    <tr key={reviewer.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-800">
                            {reviewer.name.charAt(0).toUpperCase()}
                          </div>
                          <Link
                            href={`/admin/reviewers/${encodeURIComponent(reviewer.id)}`}
                            className="font-medium text-gray-900 hover:text-blue-700"
                          >
                            {reviewer.name}
                          </Link>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">{reviewer.id}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {reviewer.email || <span className="text-gray-400">No email</span>}
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-gray-700">{stats.total}</td>
                      <td className="px-4 py-3 text-center font-medium text-green-700">{stats.completed}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={stats.overdue > 0 ? 'font-semibold text-red-700' : 'font-medium text-amber-700'}>
                          {stats.pending}
                        </span>
                        {stats.overdue > 0 && (
                          <span className="ml-1 text-xs text-red-600">({stats.overdue} overdue)</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <Link
                            href={`/admin/reviewers/${encodeURIComponent(reviewer.id)}`}
                            className="font-medium text-blue-700 hover:text-blue-900"
                          >
                            Profile
                          </Link>
                          <button
                            type="button"
                            onClick={() => openMailModal(reviewer)}
                            disabled={!reviewer.email || protocolLoading || monthGroups.length === 0}
                            className="font-medium text-green-700 hover:text-green-900 disabled:cursor-not-allowed disabled:text-gray-300"
                            title={!reviewer.email ? 'Reviewer has no email' : protocolLoading ? 'Loading periods' : 'Send review email'}
                          >
                            Email
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(reviewer)}
                            className="font-medium text-gray-700 hover:text-gray-950"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => openDeleteModal(reviewer.id)}
                            className="font-medium text-red-600 hover:text-red-800"
                          >
                            Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
                  <option value="month">Month Range</option>
                  <option value="week">Specific Week</option>
                </select>
              </div>

              {mailScope === 'month' ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="mailStartMonth" className="block text-sm font-medium text-gray-700 mb-1">
                      From Month
                    </label>
                    <select
                      id="mailStartMonth"
                      value={selectedMailMonthId}
                      onChange={(e) => {
                        const monthId = e.target.value;

                        setSelectedMailMonthId(monthId);
                        setSelectedMailEndMonthId((currentEndMonthId) => currentEndMonthId || monthId);
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

                  <div>
                    <label htmlFor="mailEndMonth" className="block text-sm font-medium text-gray-700 mb-1">
                      To Month
                    </label>
                    <select
                      id="mailEndMonth"
                      value={selectedMailEndMonthId || selectedMailMonthId}
                      onChange={(e) => {
                        setSelectedMailEndMonthId(e.target.value);
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
                </div>
              ) : (
                <>
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
                        setSelectedMailEndMonthId(monthId);
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
                </>
              )}

              <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm text-gray-700">
                {availableMailMonthGroups.length === 0
                  ? 'No uploaded protocols match this reviewer yet. Check that the reviewer ID or name in the protocol assignment matches this reviewer record.'
                  : `${selectedMailPeriodLabel ? `${selectedMailPeriodLabel}: ` : ''}${selectedIndividualProtocols.length} protocol${selectedIndividualProtocols.length === 1 ? '' : 's'} will be included for this reviewer.`}
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
      
      {/* Archive Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-semibold mb-2">Confirm Deletion</h2>
            <p className="mb-4 text-gray-600">
              Archive this reviewer? They will be hidden from active lists, while assignments and history are retained.
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
                {isSubmitting ? 'Archiving...' : 'Archive Reviewer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 
