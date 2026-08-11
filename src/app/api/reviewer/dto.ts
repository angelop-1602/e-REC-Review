import type { MysqlReviewerProtocolDto } from '@/lib/mysql';
import type { ReviewerAssignmentDto, ReviewerNoticeDto } from '@/app/reviewer/types';
import type { MysqlNoticeDto } from '@/lib/mysql';

const FORM_URLS: Record<string, string> = {
  PRA1: 'https://forms.office.com/r/4WuaHiiJar',
  PRA2: 'https://forms.office.com/r/4WuaHiiJar',
  ICA: 'https://forms.office.com/r/0nQCTjvBsv',
  IACUC: 'https://forms.office.com/r/vT231a87fj',
  IACUC2: 'https://forms.office.com/r/vT231a87fj',
  CREF1: 'https://forms.office.com/r/n6RU8EuT3P',
  CREF2: 'https://forms.office.com/r/n6RU8EuT3P',
};

const FORM_NAMES: Record<string, string> = {
  PRA1: 'Protocol Review Assessment Form',
  PRA2: 'Protocol Review Assessment Form',
  ICA: 'Informed Consent Assessment Form',
  IACUC: 'Protocol Review Assessment for Experimental Form',
  IACUC2: 'Protocol Review Assessment for Experimental Form',
  CREF1: 'Checklist for Exemption from Review Form',
  CREF2: 'Checklist for Exemption from Review Form',
};

function monthLabel(monthId: string): string {
  const match = /^([A-Za-z]+)(\d{4})$/.exec(monthId);
  return match ? `${match[1]} ${match[2]}` : monthId;
}

export function reviewerAssignmentDto(item: MysqlReviewerProtocolDto): ReviewerAssignmentDto {
  const formType = item.reviewer.form_type || '';
  return {
    assignmentId: item.assignmentId,
    protocolKey: item.protocol.internalId,
    sourceDocumentId: item.protocol.id,
    recCode: item.protocol.spup_rec_code || item.protocol.id,
    researchTitle: item.protocol.research_title || item.protocol.protocol_name,
    principalInvestigator: item.protocol.principal_investigator || '',
    adviser: item.protocol.adviser || '',
    courseProgram: item.protocol.course_program || item.protocol.academic_level || '',
    documentLink: item.protocol.e_link || item.protocol.protocol_file || '',
    monthId: item.protocol.monthId,
    weekId: item.protocol.weekId,
    monthLabel: monthLabel(item.protocol.monthId),
    weekLabel: `Week ${item.protocol.weekId.match(/\d+/)?.[0] || item.protocol.weekId}`,
    releasePeriod: item.protocol.release_period,
    status: item.reviewer.status === 'Completed' ? 'Completed' : 'In Progress',
    dueDate: item.reviewer.due_date || item.protocol.due_date || '',
    completedAt: item.reviewer.completed_at || null,
    protocolCreatedAt: item.protocol.created_at,
    formType,
    formName: FORM_NAMES[formType] || formType || 'N/A',
    formUrl: FORM_URLS[formType] || '',
  };
}

export function reviewerNoticeDto(notice: MysqlNoticeDto): ReviewerNoticeDto {
  return {
    id: notice.internalId,
    title: notice.title,
    content: notice.content,
    priority: notice.priority,
    createdAt: notice.created_at,
    expiresAt: notice.expires_at,
    likeCount: notice.likeCount,
    likedByReviewer: notice.likedByReviewer === true,
  };
}
