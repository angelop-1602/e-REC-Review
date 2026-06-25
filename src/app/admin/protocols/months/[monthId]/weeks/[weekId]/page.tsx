'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import ProtocolTable from '@/components/ProtocolTable';
import ProtocolDetailsModal from '@/components/ProtocolDetailsModal';
import ProtocolStatusCard from '@/components/ProtocolStatusCard';
import ReassignmentModal from '@/components/ReassignmentModal';
import {
  buildNotificationProtocols,
  formatMonthLabel,
  formatWeekLabel,
  getProtocolStatusCounts,
  getReviewerTotals,
  normalizeProtocolData,
  sortProtocols,
  type Protocol,
  type Reviewer,
} from '@/lib/protocols';

interface SendSummary {
  sent: unknown[];
  skipped: unknown[];
  failed: unknown[];
}

type ProtocolFormMode = 'create' | 'edit';

interface ReviewerFormRow {
  id: string;
  name: string;
  form_type: string;
  status: string;
  due_date: string;
  completed_at?: unknown;
}

interface ProtocolFormState {
  spup_rec_code: string;
  research_title: string;
  principal_investigator: string;
  adviser: string;
  course_program: string;
  e_link: string;
  due_date: string;
  status: string;
  reviewers: ReviewerFormRow[];
}

const FORM_TYPE_OPTIONS = ['PRA1', 'PRA2', 'ICA', 'IACUC', 'IACUC2', 'CREF1', 'CREF2'];
const STATUS_OPTIONS = ['In Progress', 'Completed'];

function getDefaultDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);

  return date.toISOString().split('T')[0];
}

function getEmptyProtocolForm(dueDate = getDefaultDueDate()): ProtocolFormState {
  return {
    spup_rec_code: '',
    research_title: '',
    principal_investigator: '',
    adviser: '',
    course_program: '',
    e_link: '',
    due_date: dueDate,
    status: 'In Progress',
    reviewers: [],
  };
}

function createReviewerFormRow(dueDate: string): ReviewerFormRow {
  return {
    id: '',
    name: '',
    form_type: FORM_TYPE_OPTIONS[0],
    status: 'In Progress',
    due_date: dueDate,
  };
}

function formatNotificationSummary(summary: SendSummary): string {
  const parts = [];

  if (summary.sent.length > 0) {
    parts.push(`sent ${summary.sent.length} reviewer email${summary.sent.length === 1 ? '' : 's'}`);
  }

  if (summary.skipped.length > 0) {
    parts.push(`skipped ${summary.skipped.length} reviewer${summary.skipped.length === 1 ? '' : 's'} without email`);
  }

  if (summary.failed.length > 0) {
    parts.push(`${summary.failed.length} email${summary.failed.length === 1 ? '' : 's'} failed`);
  }

  return parts.length > 0 ? parts.join(', ') : 'no reviewer emails were sent';
}

export default function ProtocolWeekPage() {
  const params = useParams<{ monthId: string; weekId: string }>();
  const monthId = decodeURIComponent(params.monthId);
  const weekId = decodeURIComponent(params.weekId);
  const monthLabel = formatMonthLabel(monthId);
  const weekLabel = formatWeekLabel(weekId);

  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [reviewerList, setReviewerList] = useState<Reviewer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol | null>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignmentData, setReassignmentData] = useState<{
    protocol: Protocol;
    reviewerId: string;
    reviewerName: string;
  } | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [protocolFormOpen, setProtocolFormOpen] = useState(false);
  const [protocolFormMode, setProtocolFormMode] = useState<ProtocolFormMode>('create');
  const [editingProtocol, setEditingProtocol] = useState<Protocol | null>(null);
  const [protocolForm, setProtocolForm] = useState<ProtocolFormState>(() => getEmptyProtocolForm());
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Protocol | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const fetchWeekProtocols = async () => {
    try {
      setLoading(true);
      setError(null);

      const protocolsRef = collection(db, 'protocols', monthId, weekId);
      const protocolsSnapshot = await getDocs(protocolsRef);
      const nextProtocols = protocolsSnapshot.docs.map((protocolDoc) =>
        normalizeProtocolData(protocolDoc.id, protocolDoc.data(), monthId, weekId)
      );

      setProtocols(sortProtocols(nextProtocols));
    } catch (fetchError) {
      console.error('Error fetching week protocols:', fetchError);
      setError('Failed to load protocols for this week.');
    } finally {
      setLoading(false);
    }
  };

  const fetchReviewers = async () => {
    try {
      const reviewersQuery = query(collection(db, 'reviewers'), orderBy('name'));
      const reviewersSnapshot = await getDocs(reviewersQuery);
      const nextReviewers = reviewersSnapshot.docs.map((reviewerDoc) => ({
        id: reviewerDoc.id,
        name: typeof reviewerDoc.data().name === 'string' ? reviewerDoc.data().name : reviewerDoc.id,
        status: 'In Progress',
      }));

      setReviewerList(nextReviewers);
    } catch (reviewerError) {
      console.error('Error fetching reviewers:', reviewerError);
    }
  };

  useEffect(() => {
    fetchWeekProtocols();
    fetchReviewers();
  }, [monthId, weekId]);

  const filteredProtocols = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return protocols;
    }

    return protocols.filter((protocol) => {
      const reviewerText = (protocol.reviewers || [])
        .map((reviewer) => `${reviewer.id} ${reviewer.name}`)
        .join(' ')
        .toLowerCase();
      const haystack = [
        protocol.spup_rec_code,
        protocol.id,
        protocol.research_title,
        protocol.protocol_name,
        protocol.principal_investigator,
        protocol.course_program,
        reviewerText,
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [protocols, searchTerm]);

  const statusCounts = useMemo(() => getProtocolStatusCounts(filteredProtocols), [filteredProtocols]);
  const reviewerTotals = useMemo(() => getReviewerTotals(filteredProtocols), [filteredProtocols]);

  const handleViewProtocol = (protocol: Protocol) => {
    setSelectedProtocol(protocol);
    setDetailsModalOpen(true);
  };

  const handleReassign = (protocol: Protocol, reviewerId: string, reviewerName: string) => {
    setReassignmentData({ protocol, reviewerId, reviewerName });
    setReassignModalOpen(true);
  };

  const getProtocolDocumentRef = (protocolId: string) => doc(db, 'protocols', monthId, weekId, protocolId);

  const openCreateProtocol = () => {
    setProtocolFormMode('create');
    setEditingProtocol(null);
    setProtocolForm(getEmptyProtocolForm());
    setFormError(null);
    setProtocolFormOpen(true);
  };

  const openEditProtocol = (protocol: Protocol) => {
    setProtocolFormMode('edit');
    setEditingProtocol(protocol);
    setProtocolForm({
      spup_rec_code: protocol.spup_rec_code || protocol.id,
      research_title: protocol.research_title || protocol.protocol_name || '',
      principal_investigator: protocol.principal_investigator || '',
      adviser: protocol.adviser || '',
      course_program: protocol.course_program || protocol.academic_level || '',
      e_link: protocol.e_link || protocol.protocol_file || '',
      due_date: protocol.due_date || getDefaultDueDate(),
      status: protocol.status || 'In Progress',
      reviewers: (protocol.reviewers || []).map((reviewer) => ({
        id: reviewer.id || '',
        name: reviewer.name || reviewer.id || '',
        form_type: reviewer.form_type || reviewer.document_type || FORM_TYPE_OPTIONS[0],
        status: reviewer.status || 'In Progress',
        due_date: reviewer.due_date || protocol.due_date || getDefaultDueDate(),
        completed_at: reviewer.completed_at,
      })),
    });
    setFormError(null);
    setProtocolFormOpen(true);
  };

  const closeProtocolForm = () => {
    if (formSubmitting) {
      return;
    }

    setProtocolFormOpen(false);
    setEditingProtocol(null);
    setFormError(null);
  };

  function updateProtocolFormField<K extends keyof ProtocolFormState>(
    field: K,
    value: ProtocolFormState[K]
  ) {
    setProtocolForm((currentForm) => ({
      ...currentForm,
      [field]: value,
    }));
  }

  const addReviewerRow = () => {
    setProtocolForm((currentForm) => ({
      ...currentForm,
      reviewers: [...currentForm.reviewers, createReviewerFormRow(currentForm.due_date || getDefaultDueDate())],
    }));
  };

  const updateReviewerRow = (index: number, field: keyof ReviewerFormRow, value: string) => {
    setProtocolForm((currentForm) => ({
      ...currentForm,
      reviewers: currentForm.reviewers.map((reviewer, reviewerIndex) => {
        if (reviewerIndex !== index) {
          return reviewer;
        }

        const nextReviewer: ReviewerFormRow = {
          ...reviewer,
          [field]: value,
        };

        if (field === 'id') {
          const selectedReviewer = reviewerList.find((item) => item.id === value);
          nextReviewer.name = selectedReviewer?.name || value;
        }

        if (field === 'status') {
          nextReviewer.completed_at = value === 'Completed' ? reviewer.completed_at || Timestamp.now() : undefined;
          nextReviewer.due_date = value === 'Completed' ? '' : reviewer.due_date || currentForm.due_date;
        }

        return nextReviewer;
      }),
    }));
  };

  const removeReviewerRow = (index: number) => {
    setProtocolForm((currentForm) => ({
      ...currentForm,
      reviewers: currentForm.reviewers.filter((_, reviewerIndex) => reviewerIndex !== index),
    }));
  };

  const buildProtocolPayload = () => {
    const spupRecCode = protocolForm.spup_rec_code.trim();
    const researchTitle = protocolForm.research_title.trim();
    const dueDate = protocolForm.due_date;
    const createdAt = editingProtocol?.created_at || new Date().toISOString();

    const reviewers = protocolForm.reviewers
      .map((reviewer) => ({
        ...reviewer,
        id: reviewer.id.trim(),
        name: reviewer.name.trim() || reviewer.id.trim(),
        form_type: reviewer.form_type.trim(),
        status: reviewer.status || 'In Progress',
        due_date: reviewer.due_date || dueDate,
      }))
      .filter((reviewer) => reviewer.id || reviewer.name)
      .map((reviewer) => ({
        id: reviewer.id,
        name: reviewer.name,
        form_type: reviewer.form_type || FORM_TYPE_OPTIONS[0],
        status: reviewer.status,
        due_date: reviewer.status === 'Completed' ? '' : reviewer.due_date,
        completed_at: reviewer.status === 'Completed' ? reviewer.completed_at || Timestamp.now() : null,
      }));

    return {
      spup_rec_code: spupRecCode,
      principal_investigator: protocolForm.principal_investigator.trim(),
      research_title: researchTitle,
      protocol_name: researchTitle,
      adviser: protocolForm.adviser.trim(),
      course_program: protocolForm.course_program.trim(),
      academic_level: protocolForm.course_program.trim(),
      e_link: protocolForm.e_link.trim(),
      protocol_file: protocolForm.e_link.trim(),
      due_date: dueDate,
      status: protocolForm.status,
      reviewers,
      release_period: `${monthLabel} ${weekLabel}`,
      created_at: createdAt,
      updated_at: new Date().toISOString(),
    };
  };

  const handleProtocolSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const spupRecCode = protocolForm.spup_rec_code.trim();
    const researchTitle = protocolForm.research_title.trim();

    if (!spupRecCode) {
      setFormError('SPUP REC code is required.');
      return;
    }

    if (spupRecCode.includes('/')) {
      setFormError('SPUP REC code cannot contain a slash (/).');
      return;
    }

    if (!researchTitle) {
      setFormError('Research title is required.');
      return;
    }

    if (!protocolForm.due_date) {
      setFormError('Due date is required.');
      return;
    }

    const duplicateProtocol = protocols.find((protocol) => {
      const existingCode = (protocol.spup_rec_code || protocol.id).trim().toLowerCase();
      return existingCode === spupRecCode.toLowerCase() && protocol.id !== editingProtocol?.id;
    });

    if (duplicateProtocol) {
      setFormError('Another protocol in this week already uses that SPUP REC code.');
      return;
    }

    setFormSubmitting(true);
    setFormError(null);

    try {
      const protocolId = protocolFormMode === 'create' ? spupRecCode : editingProtocol?.id;

      if (!protocolId) {
        throw new Error('Protocol document could not be identified.');
      }

      const protocolRef = getProtocolDocumentRef(protocolId);

      if (protocolFormMode === 'create') {
        const existingProtocol = await getDoc(protocolRef);

        if (existingProtocol.exists()) {
          setFormError('A protocol document with this REC code already exists for this week.');
          return;
        }
      }

      await setDoc(protocolRef, buildProtocolPayload(), { merge: protocolFormMode === 'edit' });
      await fetchWeekProtocols();

      setNotice({
        type: 'success',
        message: protocolFormMode === 'create' ? 'Protocol added successfully.' : 'Protocol updated successfully.',
      });
      setProtocolFormOpen(false);
      setEditingProtocol(null);
    } catch (submitError) {
      console.error('Failed to save protocol:', submitError);
      setFormError(submitError instanceof Error ? submitError.message : 'Failed to save protocol.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteProtocol = async () => {
    if (!deleteTarget) {
      return;
    }

    setDeleteSubmitting(true);

    try {
      await deleteDoc(getProtocolDocumentRef(deleteTarget.id));
      await fetchWeekProtocols();

      if (selectedProtocol?.id === deleteTarget.id) {
        setDetailsModalOpen(false);
        setSelectedProtocol(null);
      }

      setNotice({ type: 'success', message: 'Protocol deleted successfully.' });
      setDeleteTarget(null);
    } catch (deleteError) {
      console.error('Failed to delete protocol:', deleteError);
      setNotice({
        type: 'error',
        message: deleteError instanceof Error ? deleteError.message : 'Failed to delete protocol.',
      });
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const sendWeekEmail = async () => {
    if (protocols.length === 0) {
      setNotice({ type: 'info', message: 'No protocols are available for this week.' });
      return;
    }

    setSendingEmail(true);
    setNotice(null);

    try {
      const response = await fetch('/api/admin/review-notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: 'week',
          monthDocumentId: monthId,
          weekId,
          protocols: buildNotificationProtocols(protocols),
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send reviewer notifications.');
      }

      setNotice({
        type: result.failed?.length > 0 ? 'error' : 'success',
        message: `${monthLabel} ${weekLabel}: ${formatNotificationSummary(result as SendSummary)}. Track details on the Mailing page.`,
      });
    } catch (sendError) {
      console.error('Failed to send week notifications:', sendError);
      setNotice({
        type: 'error',
        message: sendError instanceof Error ? sendError.message : 'Failed to send reviewer notifications.',
      });
    } finally {
      setSendingEmail(false);
    }
  };

  const currentReviewer = reassignmentData
    ? reassignmentData.protocol.reviewers?.find((reviewer) => reviewer.id === reassignmentData.reviewerId) || {
        id: reassignmentData.reviewerId,
        name: reassignmentData.reviewerName,
        status: 'In Progress',
        due_date: reassignmentData.protocol.due_date,
      }
    : null;

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded" role="alert">
          <strong className="font-bold">Error!</strong>
          <span className="block sm:inline"> {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <Link href="/admin/protocols" className="text-sm text-blue-600 hover:text-blue-800">
            Back to protocol months
          </Link>
          <h1 className="text-2xl font-bold mt-2">{monthLabel} - {weekLabel}</h1>
          <p className="text-gray-600">
            Manage protocols uploaded for this week, including details, reassignment, and reviewer notifications.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openCreateProtocol}
            className="px-4 py-2 rounded-md bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
          >
            Add Protocol
          </button>
          <button
            type="button"
            onClick={sendWeekEmail}
            disabled={sendingEmail || protocols.length === 0}
            className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {sendingEmail ? 'Sending...' : 'Send Week Email'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ProtocolStatusCard title="Protocols" count={statusCounts.total} color="blue" />
        <ProtocolStatusCard title="In Progress" count={statusCounts.inProgress} color="yellow" />
        <ProtocolStatusCard title="Overdue" count={statusCounts.overdue} color="red" />
        <ProtocolStatusCard title="Reviewer Reviews" count={reviewerTotals.completed} total={reviewerTotals.total} color="green" />
      </div>

      {notice && (
        <div className={`rounded-md px-4 py-3 text-sm ${
          notice.type === 'success'
            ? 'bg-green-50 text-green-800'
            : notice.type === 'error'
              ? 'bg-red-50 text-red-800'
              : 'bg-blue-50 text-blue-800'
        }`}>
          {notice.message}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <label htmlFor="week-protocol-search" className="block text-sm font-medium text-gray-700 mb-1">
          Search this week
        </label>
        <input
          id="week-protocol-search"
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search by REC code, title, PI, course, or reviewer"
          className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        <ProtocolTable
          protocols={filteredProtocols}
          loading={false}
          emptyMessage="No protocols found for this week."
          onViewDetails={(protocol) => handleViewProtocol(protocol as Protocol)}
          onEdit={(protocol) => openEditProtocol(protocol as Protocol)}
          onDelete={(protocol) => setDeleteTarget(protocol as Protocol)}
          onReassign={(protocol, reviewerId, reviewerName) => handleReassign(protocol as Protocol, reviewerId, reviewerName)}
        />
      </div>

      {protocolFormOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {protocolFormMode === 'create' ? 'Add Protocol' : 'Edit Protocol'}
                </h2>
                <p className="text-sm text-gray-500">{monthLabel} - {weekLabel}</p>
              </div>
              <button
                type="button"
                onClick={closeProtocolForm}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close protocol form"
              >
                <span className="text-2xl leading-none">&times;</span>
              </button>
            </div>

            <form onSubmit={handleProtocolSubmit} className="space-y-6 p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="spup-rec-code" className="block text-sm font-medium text-gray-700 mb-1">
                    SPUP REC Code
                  </label>
                  <input
                    id="spup-rec-code"
                    type="text"
                    value={protocolForm.spup_rec_code}
                    onChange={(event) => updateProtocolFormField('spup_rec_code', event.target.value)}
                    className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="protocol-status" className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    id="protocol-status"
                    value={protocolForm.status}
                    onChange={(event) => updateProtocolFormField('status', event.target.value)}
                    className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {STATUS_OPTIONS.map((statusOption) => (
                      <option key={statusOption} value={statusOption}>
                        {statusOption}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="research-title" className="block text-sm font-medium text-gray-700 mb-1">
                    Research Title
                  </label>
                  <textarea
                    id="research-title"
                    value={protocolForm.research_title}
                    onChange={(event) => updateProtocolFormField('research_title', event.target.value)}
                    rows={3}
                    className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="principal-investigator" className="block text-sm font-medium text-gray-700 mb-1">
                    Principal Investigator
                  </label>
                  <input
                    id="principal-investigator"
                    type="text"
                    value={protocolForm.principal_investigator}
                    onChange={(event) => updateProtocolFormField('principal_investigator', event.target.value)}
                    className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="adviser" className="block text-sm font-medium text-gray-700 mb-1">
                    Adviser
                  </label>
                  <input
                    id="adviser"
                    type="text"
                    value={protocolForm.adviser}
                    onChange={(event) => updateProtocolFormField('adviser', event.target.value)}
                    className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="course-program" className="block text-sm font-medium text-gray-700 mb-1">
                    Course/Program
                  </label>
                  <input
                    id="course-program"
                    type="text"
                    value={protocolForm.course_program}
                    onChange={(event) => updateProtocolFormField('course_program', event.target.value)}
                    className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label htmlFor="due-date" className="block text-sm font-medium text-gray-700 mb-1">
                    Due Date
                  </label>
                  <input
                    id="due-date"
                    type="date"
                    value={protocolForm.due_date}
                    onChange={(event) => updateProtocolFormField('due_date', event.target.value)}
                    className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="protocol-link" className="block text-sm font-medium text-gray-700 mb-1">
                    E Link
                  </label>
                  <input
                    id="protocol-link"
                    type="url"
                    value={protocolForm.e_link}
                    onChange={(event) => updateProtocolFormField('e_link', event.target.value)}
                    className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg">
                <div className="flex flex-col gap-3 border-b border-gray-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Reviewers</h3>
                    <p className="text-sm text-gray-500">Assigned reviewers and form types for this protocol.</p>
                  </div>
                  <button
                    type="button"
                    onClick={addReviewerRow}
                    className="px-3 py-2 rounded-md border border-blue-200 text-blue-700 text-sm font-medium hover:bg-blue-50"
                  >
                    Add Reviewer
                  </button>
                </div>

                <div className="divide-y divide-gray-200">
                  {protocolForm.reviewers.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-gray-500">No reviewers assigned.</div>
                  ) : (
                    protocolForm.reviewers.map((reviewer, index) => (
                      <div key={`${reviewer.id}-${index}`} className="grid grid-cols-1 gap-3 px-4 py-4 lg:grid-cols-[1.3fr_1.1fr_0.8fr_0.9fr_auto] lg:items-end">
                        <div>
                          <label htmlFor={`reviewer-id-${index}`} className="block text-xs font-medium text-gray-600 mb-1">
                            Reviewer
                          </label>
                          <select
                            id={`reviewer-id-${index}`}
                            value={reviewer.id}
                            onChange={(event) => updateReviewerRow(index, 'id', event.target.value)}
                            className="border border-gray-300 rounded-md w-full p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Select reviewer</option>
                            {reviewerList.map((reviewerOption) => (
                              <option key={reviewerOption.id} value={reviewerOption.id}>
                                {reviewerOption.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label htmlFor={`reviewer-name-${index}`} className="block text-xs font-medium text-gray-600 mb-1">
                            Name
                          </label>
                          <input
                            id={`reviewer-name-${index}`}
                            type="text"
                            value={reviewer.name}
                            onChange={(event) => updateReviewerRow(index, 'name', event.target.value)}
                            className="border border-gray-300 rounded-md w-full p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>

                        <div>
                          <label htmlFor={`reviewer-form-type-${index}`} className="block text-xs font-medium text-gray-600 mb-1">
                            Form Type
                          </label>
                          <select
                            id={`reviewer-form-type-${index}`}
                            value={reviewer.form_type}
                            onChange={(event) => updateReviewerRow(index, 'form_type', event.target.value)}
                            className="border border-gray-300 rounded-md w-full p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {FORM_TYPE_OPTIONS.map((formType) => (
                              <option key={formType} value={formType}>
                                {formType}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label htmlFor={`reviewer-status-${index}`} className="block text-xs font-medium text-gray-600 mb-1">
                            Status
                          </label>
                          <select
                            id={`reviewer-status-${index}`}
                            value={reviewer.status}
                            onChange={(event) => updateReviewerRow(index, 'status', event.target.value)}
                            className="border border-gray-300 rounded-md w-full p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            {STATUS_OPTIONS.map((statusOption) => (
                              <option key={statusOption} value={statusOption}>
                                {statusOption}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="grid grid-cols-[1fr_auto] gap-2 lg:contents">
                          {reviewer.status !== 'Completed' && (
                            <div>
                              <label htmlFor={`reviewer-due-date-${index}`} className="block text-xs font-medium text-gray-600 mb-1">
                                Due Date
                              </label>
                              <input
                                id={`reviewer-due-date-${index}`}
                                type="date"
                                value={reviewer.due_date}
                                onChange={(event) => updateReviewerRow(index, 'due_date', event.target.value)}
                                className="border border-gray-300 rounded-md w-full p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => removeReviewerRow(index)}
                            className="self-end px-3 py-2 rounded-md border border-red-200 text-red-700 text-sm font-medium hover:bg-red-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {formError && (
                <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
                  {formError}
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={closeProtocolForm}
                  disabled={formSubmitting}
                  className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {formSubmitting ? 'Saving...' : 'Save Protocol'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Delete Protocol</h2>
            <p className="text-sm text-gray-600">
              Delete {deleteTarget.spup_rec_code || deleteTarget.id}? This action cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteSubmitting}
                className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteProtocol}
                disabled={deleteSubmitting}
                className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deleteSubmitting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ProtocolDetailsModal
        isOpen={detailsModalOpen}
        protocol={selectedProtocol}
        onClose={() => setDetailsModalOpen(false)}
        onReassign={(protocol, reviewerId, reviewerName) => handleReassign(protocol as Protocol, reviewerId, reviewerName)}
        reviewerList={reviewerList}
      />

      {reassignmentData && currentReviewer && (
        <ReassignmentModal
          isOpen={reassignModalOpen}
          protocol={reassignmentData.protocol}
          currentReviewer={currentReviewer}
          reviewerList={reviewerList}
          loading={false}
          onCancel={() => {
            setReassignModalOpen(false);
            setReassignmentData(null);
          }}
          onSuccess={() => {
            setReassignModalOpen(false);
            setReassignmentData(null);
            fetchWeekProtocols();
          }}
        />
      )}
    </div>
  );
}
