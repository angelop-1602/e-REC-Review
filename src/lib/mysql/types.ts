export interface MysqlReviewerDto {
  internalId: string;
  id: string;
  name: string;
  email?: string;
  isActive: boolean;
}

export interface MysqlReviewerAssignmentDto {
  internalId: string;
  id: string;
  name: string;
  status: string;
  form_type?: string;
  due_date?: string;
  completed_at?: string | null;
}

export interface MysqlProtocolDto {
  internalId: string;
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewers: MysqlReviewerAssignmentDto[];
  due_date: string;
  status: string;
  protocol_file: string;
  created_at: string;
  research_title: string;
  e_link: string;
  course_program: string;
  spup_rec_code: string;
  principal_investigator: string;
  adviser: string;
  monthId: string;
  weekId: string;
  _path: string;
}

export interface MysqlReviewerProtocolDto {
  assignmentId: string;
  protocol: MysqlProtocolDto;
  reviewer: MysqlReviewerAssignmentDto;
}

export interface MysqlNoticeDto {
  internalId: string;
  id: string;
  title: string;
  content: string;
  priority: 'none' | 'low' | 'medium' | 'high';
  created_at: string;
  expires_at: string | null;
  likes: string[];
  likeCount: number;
  likedByReviewer?: boolean;
}

export interface MysqlNotificationSettingsDto {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'twice-weekly';
  sendToReviewers: boolean;
  dueSoonThreshold: number;
  lastRun?: string;
}

export interface MysqlSystemNoticeDto {
  internalId: string;
  id: string;
  noticeNumber: number;
  title: string;
  subtitle: string;
  message: string;
  keyPoints: string[];
  actionButton?: { text: string; href: string };
  created_at: string;
  expires_at: string | null;
}

export interface MysqlMailBatchDto {
  id: string;
  status: string;
  periodLabel: string;
  scope: string;
  total: number;
  pending: number;
  sending: number;
  sent: number;
  skipped: number;
  failed: number;
  protocolCount: number;
  reviewerCount: number;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt?: string | null;
  lastError?: string;
}

export interface MysqlMailDeliveryDto {
  id: string;
  batchId: string;
  status: string;
  periodLabel: string;
  reviewerName: string;
  email: string;
  protocolCount: number;
  attempts: number;
  maxAttempts: number;
  reason?: string;
  lastError?: string;
  createdAt: string | null;
  updatedAt: string | null;
}
