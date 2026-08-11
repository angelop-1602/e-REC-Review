import type { Protocol, Reviewer } from '@/lib/protocols';
import { isDueSoon, isOverdue } from '@/lib/utils';

export interface ReviewerRecord {
  id: string;
  name: string;
  email?: string;
}

export interface ReviewerProtocolAssignment {
  protocol: Protocol;
  reviewer: Reviewer | null;
  status: string;
  dueDate: string;
  formType: string;
}

export interface ReviewerAssignmentStats {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  dueSoon: number;
}

function normalizeMatchValue(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}

export function isReviewerAssignmentMatch(
  assignment: { id?: string; name?: string },
  reviewer: ReviewerRecord
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

export function getReviewerAssignments(
  protocols: Protocol[],
  reviewer: ReviewerRecord
): ReviewerProtocolAssignment[] {
  return protocols.flatMap<ReviewerProtocolAssignment>((protocol) => {
    if (protocol.reviewers && protocol.reviewers.length > 0) {
      return protocol.reviewers
        .filter((assignment) => isReviewerAssignmentMatch(assignment, reviewer))
        .map((assignment) => ({
          protocol,
          reviewer: assignment,
          status: assignment.status || protocol.status || 'In Progress',
          dueDate: assignment.due_date || protocol.due_date,
          formType: assignment.form_type || protocol.form_type || protocol.document_type || '',
        }));
    }

    const legacyReviewer = normalizeMatchValue(protocol.reviewer);
    const reviewerValues = [normalizeMatchValue(reviewer.id), normalizeMatchValue(reviewer.name)];

    if (!legacyReviewer || !reviewerValues.includes(legacyReviewer)) {
      return [];
    }

    return [{
      protocol,
      reviewer: null,
      status: protocol.status || 'In Progress',
      dueDate: protocol.due_date,
      formType: protocol.form_type || protocol.document_type || '',
    }];
  });
}

export function getProtocolsForReviewer(protocols: Protocol[], reviewer: ReviewerRecord): Protocol[] {
  const protocolMap = new Map<string, Protocol>();

  for (const assignment of getReviewerAssignments(protocols, reviewer)) {
    protocolMap.set(assignment.protocol._path || assignment.protocol.id, assignment.protocol);
  }

  return Array.from(protocolMap.values());
}

export function getReviewerAssignmentStats(
  protocols: Protocol[],
  reviewer: ReviewerRecord
): ReviewerAssignmentStats {
  const assignments = getReviewerAssignments(protocols, reviewer);
  const completed = assignments.filter((assignment) => assignment.status === 'Completed').length;
  const active = assignments.filter((assignment) => assignment.status !== 'Completed');

  return {
    total: assignments.length,
    completed,
    pending: active.length,
    overdue: active.filter((assignment) => assignment.dueDate && isOverdue(assignment.dueDate)).length,
    dueSoon: active.filter((assignment) => assignment.dueDate && isDueSoon(assignment.dueDate)).length,
  };
}
