/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { getFormTypeName } from '@/lib/utils';
import { doc, collection, getDocs, query, where, addDoc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { isOverdue, isDueSoon } from './utils';

/**
 * Checks for overdue protocols that need attention
 * @param protocols The list of protocols to check
 * @returns An object containing overdue and soon-to-be-due protocols
 */
export function checkOverdueProtocols(protocols: any[]): {
  overdue: any[];
  dueSoon: any[];
} {
  const today = new Date();
  
  // Filter protocols
  const overdue = protocols.filter(protocol => {
    return (
      protocol.status !== 'Completed' && 
      protocol.due_date && 
      isOverdue(protocol.due_date)
    );
  });
  
  const dueSoon = protocols.filter(protocol => {
    return (
      protocol.status !== 'Completed' && 
      protocol.due_date && 
      isDueSoon(protocol.due_date) && 
      !isOverdue(protocol.due_date)
    );
  });
  
  return {
    overdue,
    dueSoon
  };
}

/**
 * Generates an email notification template for overdue protocols
 * @param protocols List of overdue protocols
 * @returns HTML string for email notification
 */
export function generateOverdueEmailContent(protocols: any[]): string {
  if (protocols.length === 0) {
    return '';
  }
  
  // Group protocols by reviewer
  const reviewerGroups: Record<string, any[]> = {};
  
  protocols.forEach(protocol => {
    if (protocol.reviewers && protocol.reviewers.length > 0) {
      // Handle multiple reviewers case
      protocol.reviewers.forEach((reviewer: any) => {
        if (reviewer.status !== 'Completed') {
          const key = reviewer.id || reviewer.name;
          if (!reviewerGroups[key]) {
            reviewerGroups[key] = [];
          }
          reviewerGroups[key].push({
            ...protocol,
            currentReviewer: reviewer
          });
        }
      });
    } else if (protocol.reviewer) {
      // Handle single reviewer case
      const key = protocol.reviewer;
      if (!reviewerGroups[key]) {
        reviewerGroups[key] = [];
      }
      reviewerGroups[key].push(protocol);
    }
  });
  
  // Generate HTML email content
  let html = `
    <h2>Overdue Protocol Review Notification</h2>
    <p>The following protocols are overdue for review:</p>
  `;
  
  // Add protocol list by reviewer
  Object.entries(reviewerGroups).forEach(([reviewer, reviewerProtocols]) => {
    html += `
      <h3>Reviewer: ${reviewer}</h3>
      <table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%;">
        <tr style="background-color: #f2f2f2;">
          <th>Protocol</th>
          <th>Due Date</th>
          <th>Release Period</th>
          <th>Form Type</th>
        </tr>
    `;
    
    reviewerProtocols.forEach(protocol => {
      const dueDate = protocol.due_date ? new Date(protocol.due_date).toLocaleDateString() : 'Not set';
      const formType = protocol.currentReviewer?.document_type || protocol.document_type || 'Not specified';
      
      html += `
        <tr>
          <td>${protocol.protocol_name}</td>
          <td style="color: red; font-weight: bold;">${dueDate}</td>
          <td>${protocol.release_period || 'Not specified'}</td>
          <td>${formType}</td>
        </tr>
      `;
    });
    
    html += `</table><br/>`;
  });
  
  // Add footer
  html += `
    <p>
      Please log in to the e-REC system to complete these reviews or contact the administrator if you need assistance.
    </p>
    <p>
      <a href="https://your-erec-system-url.com" style="padding: 10px 15px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px;">
        Go to e-REC System
      </a>
    </p>
  `;
  
  return html;
}

/**
 * Generates an email notification template for protocols due soon
 * @param protocols List of protocols due soon
 * @returns HTML string for email notification
 */
export function generateDueSoonEmailContent(protocols: any[]): string {
  if (protocols.length === 0) {
    return '';
  }
  
  // Group protocols by reviewer (similar to overdue function)
  const reviewerGroups: Record<string, any[]> = {};
  
  protocols.forEach(protocol => {
    if (protocol.reviewers && protocol.reviewers.length > 0) {
      protocol.reviewers.forEach((reviewer: any) => {
        if (reviewer.status !== 'Completed') {
          const key = reviewer.id || reviewer.name;
          if (!reviewerGroups[key]) {
            reviewerGroups[key] = [];
          }
          reviewerGroups[key].push({
            ...protocol,
            currentReviewer: reviewer
          });
        }
      });
    } else if (protocol.reviewer) {
      const key = protocol.reviewer;
      if (!reviewerGroups[key]) {
        reviewerGroups[key] = [];
      }
      reviewerGroups[key].push(protocol);
    }
  });
  
  // Generate HTML email content
  let html = `
    <h2>Upcoming Protocol Review Deadlines</h2>
    <p>The following protocols are due for review in the next 3 days:</p>
  `;
  
  // Add protocol list by reviewer
  Object.entries(reviewerGroups).forEach(([reviewer, reviewerProtocols]) => {
    html += `
      <h3>Reviewer: ${reviewer}</h3>
      <table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%;">
        <tr style="background-color: #f2f2f2;">
          <th>Protocol</th>
          <th>Due Date</th>
          <th>Release Period</th>
          <th>Form Type</th>
        </tr>
    `;
    
    reviewerProtocols.forEach(protocol => {
      const dueDate = protocol.due_date ? new Date(protocol.due_date).toLocaleDateString() : 'Not set';
      const formType = protocol.currentReviewer?.document_type || protocol.document_type || 'Not specified';
      
      html += `
        <tr>
          <td>${protocol.protocol_name}</td>
          <td style="color: orange; font-weight: bold;">${dueDate}</td>
          <td>${protocol.release_period || 'Not specified'}</td>
          <td>${formType}</td>
        </tr>
      `;
    });
    
    html += `</table><br/>`;
  });
  
  // Add footer
  html += `
    <p>
      Please complete these reviews before the due date to avoid delays in the protocol review process.
    </p>
    <p>
      <a href="https://your-erec-system-url.com" style="padding: 10px 15px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px;">
        Go to e-REC System
      </a>
    </p>
  `;
  
  return html;
}

/**
 * Generates a daily summary for administrators
 * @param stats Current protocol stats
 * @returns HTML string for admin summary email
 */
export function generateAdminSummaryEmail(stats: {
  totalProtocols: number;
  totalReviews: number;
  overdueCount: number;
  completedCount: number;
  inProgressCount: number;
  dueSoonCount: number;
}): string {
  const html = `
    <h2>e-REC Daily Protocol Review Summary</h2>
    
    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
      <h3 style="margin-top: 0;">Current Stats</h3>
      <table cellpadding="8" style="width: 100%;">
        <tr>
          <td><strong>Total Protocols:</strong></td>
          <td>${stats.totalProtocols}</td>
        </tr>
        <tr>
          <td><strong>Total Reviews:</strong></td>
          <td>${stats.totalReviews}</td>
        </tr>
        <tr>
          <td><strong>Completed:</strong></td>
          <td style="color: green;">${stats.completedCount}</td>
        </tr>
        <tr>
          <td><strong>In Progress:</strong></td>
          <td style="color: blue;">${stats.inProgressCount}</td>
        </tr>
        <tr>
          <td><strong>Overdue:</strong></td>
          <td style="color: red; font-weight: bold;">${stats.overdueCount}</td>
        </tr>
        <tr>
          <td><strong>Due Soon:</strong></td>
          <td style="color: orange;">${stats.dueSoonCount}</td>
        </tr>
      </table>
    </div>
    
    <p>
      <a href="https://your-erec-system-url.com/admin/due-dates" style="padding: 10px 15px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; display: inline-block; margin-right: 10px;">
        View Overdue Protocols
      </a>
      <a href="https://your-erec-system-url.com/admin/dashboard" style="padding: 10px 15px; background-color: #6c757d; color: white; text-decoration: none; border-radius: 4px; display: inline-block;">
        Go to Dashboard
      </a>
    </p>
  `;
  
  return html;
}

// Function to send notifications for overdue protocols
export const sendOverdueProtocolNotifications = async (adminEmails: string[], overdueThreshold: number = 0) => {
  try {
    // Get current date for comparison
    const today = new Date();
    console.log('Checking for overdue protocols with threshold:', overdueThreshold);
    console.log('Admin emails:', adminEmails.join(', '));
    
    // Add implementation here
    
  } catch (error) {
    console.error('Error checking overdue protocols:', error);
  }
} 