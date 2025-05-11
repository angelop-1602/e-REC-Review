// Function to process release period and calculate due date
export function processReleaseInfo(fileName: string): { 
  releasePeriod: string, 
  academicLevel: string | null,
  dueDate: string | null
} {
  const lowerFileName = fileName.toLowerCase();
  let releasePeriod = "";
  let academicLevel: string | null = null;
  let dueDate: string | null = null;
  
  // Handle release periods (1st-4th)
  if (lowerFileName.includes('first-release')) {
    releasePeriod = "First Release";
    academicLevel = lowerFileName.includes('undergraduate') ? "Undergraduate" : "Graduate";
  } else if (lowerFileName.includes('second-release')) {
    releasePeriod = "Second Release";
    academicLevel = lowerFileName.includes('undergraduate') ? "Undergraduate" : "Graduate";
  } else if (lowerFileName.includes('third-release')) {
    releasePeriod = "Third Release";
    academicLevel = lowerFileName.includes('undergraduate') ? "Undergraduate" : "Graduate";
  } else if (lowerFileName.includes('fourth-release')) {
    releasePeriod = "Fourth Release";
    academicLevel = lowerFileName.includes('undergraduate') ? "Undergraduate" : "Graduate";
  }
  // Handle monthly weekly releases
  else if (lowerFileName.match(/[a-z]+_[1-4][a-z]+week/)) {
    // Extract month and week from filename
    const monthMatch = lowerFileName.match(/([a-z]+)_/);
    const weekMatch = lowerFileName.match(/_([1-4])[a-z]+week/);
    
    if (monthMatch && weekMatch) {
      const month = monthMatch[1].charAt(0).toUpperCase() + monthMatch[1].slice(1);
      const week = weekMatch[1];
      releasePeriod = `${month} ${week}${getOrdinalSuffix(parseInt(week))} Week`;
      
      // Calculate due date (Saturday + 14 days from release date)
      // Find the Saturday of the week in the given month
      const year = new Date().getFullYear();
      const monthIndex = getMonthIndex(month);
      
      if (monthIndex !== -1) {
        const saturday = findSaturdayOfWeek(year, monthIndex, parseInt(week));
        if (saturday) {
          // Add 14 days for due date
          const dueDateTime = new Date(saturday);
          dueDateTime.setDate(dueDateTime.getDate() + 14);
          dueDate = dueDateTime.toISOString().split('T')[0]; // Format as YYYY-MM-DD
        }
      }
    }
  }
  
  return { releasePeriod, academicLevel, dueDate };
}

// Helper to get month index (0-11) from month name
function getMonthIndex(month: string): number {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                 'July', 'August', 'September', 'October', 'November', 'December'];
  return months.findIndex(m => m.toLowerCase() === month.toLowerCase());
}

// Helper to find the Saturday of a specific week in a month
function findSaturdayOfWeek(year: number, monthIndex: number, weekNumber: number): Date | null {
  // Get the first day of the month
  const firstDay = new Date(year, monthIndex, 1);
  
  // Find the first Saturday of the month
  let firstSaturday = new Date(firstDay);
  const dayOfWeek = firstDay.getDay();
  const daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
  firstSaturday.setDate(firstSaturday.getDate() + daysUntilSaturday);
  
  // Calculate the Saturday of the requested week
  const targetSaturday = new Date(firstSaturday);
  targetSaturday.setDate(targetSaturday.getDate() + (weekNumber - 1) * 7);
  
  // Verify the Saturday is still in the correct month
  if (targetSaturday.getMonth() !== monthIndex) {
    return null;
  }
  
  return targetSaturday;
}

// Helper to get ordinal suffix (1st, 2nd, 3rd, 4th)
function getOrdinalSuffix(num: number): string {
  const j = num % 10,
        k = num % 100;
  if (j === 1 && k !== 11) {
    return "st";
  }
  if (j === 2 && k !== 12) {
    return "nd";
  }
  if (j === 3 && k !== 13) {
    return "rd";
  }
  return "th";
}

// Map document type codes to full form names
export function getFormTypeName(documentType: string): string {
  if (!documentType) return 'N/A';
  
  // Normalize the document type by removing "FORM" suffix and trimming
  const normalizedType = documentType.replace(/\s*FORM$/i, '').trim();
  
  const formTypes: Record<string, string> = {
    'CFEFR': 'Continuing Full Ethics Form Review',
    'Form 04A CERF': 'Continuing Ethics Review Form',
    'Form 06B1 PRA': 'Protocol Review Assessment Form',
    'Form 06B2 PRA-EX': 'Protocol Review Assessment-Exemption Form',
    'Form 06C ICA': 'Informed Consent Assessment Form',
    'PRA': 'Protocol Review Assessment Form',
    'PRA-EX': 'Protocol Review Assessment-Exemption Form',
    'PRA_EX': 'Protocol Review Assessment-Exemption Form',
    'ICA': 'Informed Consent Assessment Form'
  };
  
  return formTypes[normalizedType] || documentType;
}

// Get the form URL based on the document type
export function getFormUrl(documentType: string): string {
  if (!documentType) return '';
  
  // Normalize the document type
  const normalizedType = documentType.replace(/\s*FORM$/i, '').trim();
  
  const formUrls: Record<string, string> = {
    'ICA': 'https://forms.office.com/r/0nQCTjvBsv',
    'PRA': 'https://forms.office.com/r/4WuaHiiJar',
    'PRA-EX': 'https://forms.office.com/r/vT231a87fj',
    'PRA_EX': 'https://forms.office.com/r/vT231a87fj',
    'CFEFR': 'https://forms.office.com/r/n6RU8EuT3P',
    'Form 06C ICA': 'https://forms.office.com/r/0nQCTjvBsv',
    'Form 06B1 PRA': 'https://forms.office.com/r/4WuaHiiJar',
    'Form 06B2 PRA-EX': 'https://forms.office.com/r/vT231a87fj'
  };
  
  return formUrls[normalizedType] || '';
}

// Unified function to get reviewer's document type from a protocol
export function getReviewerFormType(protocol: any, reviewerId: string, reviewerName: string): {
  formType: string;
  formName: string;
  formUrl: string;
} {
  if (!protocol) {
    return { formType: '', formName: 'N/A', formUrl: '' };
  }
  
  let documentType = '';
  
  // First check if the document type exists in the reviewers array for this reviewer
  if (protocol.reviewers && Array.isArray(protocol.reviewers)) {
    for (const r of protocol.reviewers) {
      const idMatch = r.id === reviewerId;
      const nameMatch = r.name === reviewerName;
      const nameIncludes = Boolean(r.name && reviewerName && r.name.toLowerCase().includes(reviewerName.toLowerCase()));
      const reverseIncludes = Boolean(reviewerName && r.name && reviewerName.toLowerCase().includes(r.name.toLowerCase()));
      
      if (idMatch || nameMatch || nameIncludes || reverseIncludes) {
        if (r.document_type) {
          documentType = r.document_type;
          break;
        }
      }
    }
  }
  
  // Fall back to the protocol level document type if it exists
  if (!documentType && protocol.document_type) {
    documentType = protocol.document_type;
  }
  
  // Get form name and URL based on document type
  const formName = getFormTypeName(documentType);
  const formUrl = getFormUrl(documentType);
  
  return {
    formType: documentType,
    formName,
    formUrl
  };
}

// Check if a protocol is overdue
export function isOverdue(dueDate: string): boolean {
  if (!dueDate) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDateObj = new Date(dueDate);
  dueDateObj.setHours(0, 0, 0, 0);
  
  return dueDateObj < today;
}

// Check if a protocol is due soon (within 3 days)
export function isDueSoon(dueDate: string): boolean {
  if (!dueDate || isOverdue(dueDate)) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDateObj = new Date(dueDate);
  dueDateObj.setHours(0, 0, 0, 0);
  
  const diffTime = dueDateObj.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays <= 3;
}

// Format date for display (YYYY-MM-DD to MM/DD/YYYY)
export function formatDate(dateString: string): string {
  if (!dateString) return 'No date set';
  
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

// Get the status of a protocol based on its due date and current status
export function getProtocolStatus(status: string, dueDate: string): {
  status: string;
  className: string;
} {
  if (status === 'Completed') {
    return { status: 'Completed', className: 'bg-green-100 text-green-800' };
  }
  
  if (isOverdue(dueDate)) {
    return { status: 'Overdue', className: 'bg-red-100 text-red-800' };
  }
  
  if (isDueSoon(dueDate)) {
    return { status: 'Due Soon', className: 'bg-yellow-100 text-yellow-800' };
  }
  
  return { status: 'In Progress', className: 'bg-blue-100 text-blue-800' };
} 