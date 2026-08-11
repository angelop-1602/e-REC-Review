export type ReviewStatus = 'In Progress' | 'Completed';

export interface ReviewerIdentity {
  id: string;
  name: string;
}

export interface ReviewerAssignmentDto {
  assignmentId: string;
  protocolKey: string;
  sourceDocumentId: string;
  recCode: string;
  researchTitle: string;
  principalInvestigator: string;
  adviser: string;
  courseProgram: string;
  documentLink: string;
  monthId: string;
  weekId: string;
  monthLabel: string;
  weekLabel: string;
  releasePeriod: string;
  status: ReviewStatus;
  dueDate: string;
  completedAt: string | null;
  protocolCreatedAt: string;
  formType: string;
  formName: string;
  formUrl: string;
}

export interface ReviewerAssignmentsResponse {
  reviewer: ReviewerIdentity;
  assignments: ReviewerAssignmentDto[];
}

export interface ReviewerNoticeDto {
  id: string;
  title: string;
  content: string;
  priority: 'none' | 'low' | 'medium' | 'high';
  createdAt: string;
  expiresAt: string | null;
  likeCount: number;
  likedByReviewer: boolean;
}

export interface SystemNoticeDto {
  id: string;
  noticeNumber: number;
  title: string;
  subtitle: string;
  message: string;
  keyPoints: string[];
  actionButton: { text: string; href: string } | null;
  publishedAt: string;
  expiresAt: string | null;
}
