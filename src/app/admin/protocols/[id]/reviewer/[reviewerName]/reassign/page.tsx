'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import ReassignmentModal from '@/components/ReassignmentModal';

interface ReviewerData {
  id: string;
  name: string;
  status?: string;
  form_type?: string;
  due_date?: string;
}

interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer: string;
  reviewers?: ReviewerData[];
  due_date: string;
  status: string;
  protocol_file: string;
  form_type: string;
  created_at: string;
  spup_rec_code?: string;
  research_title?: string;
  course_program?: string;
  principal_investigator?: string;
  adviser?: string;
  _path?: string;
}

export default function ReassignReviewerPage() {
  const params = useParams();
  const id = params.id as string;
  const reviewerName = decodeURIComponent(params.reviewerName as string);
  const router = useRouter();
  
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [currentReviewer, setCurrentReviewer] = useState<ReviewerData | null>(null);
  const [availableReviewers, setAvailableReviewers] = useState<ReviewerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(true);
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch protocol data
        const protocolRef = doc(db, 'protocols', id);
        const protocolSnap = await getDoc(protocolRef);
        
        if (!protocolSnap.exists()) {
          setError('Protocol not found');
          setLoading(false);
          return;
        }
        
        const protocolData = { 
          id: protocolSnap.id,
          ...protocolSnap.data() 
        } as Protocol;
        
        setProtocol(protocolData);
        
        // Find the current reviewer in the protocol
        let foundReviewer: ReviewerData | null = null;
        
        if (protocolData.reviewers && protocolData.reviewers.length > 0) {
          foundReviewer = protocolData.reviewers.find(r => r.name === reviewerName) || null;
        } else if (protocolData.reviewer === reviewerName) {
          // For legacy format
          foundReviewer = {
            id: reviewerName,
            name: reviewerName,
            status: protocolData.status,
            form_type: protocolData.form_type,
            due_date: protocolData.due_date
          };
        }
        
        if (!foundReviewer) {
          setError('Reviewer not found in this protocol');
          setLoading(false);
          return;
        }
        
        setCurrentReviewer(foundReviewer);
        
        // Fetch all reviewers
        const reviewersRef = collection(db, 'reviewers');
        const reviewersSnap = await getDocs(reviewersRef);
        
        const reviewersData: ReviewerData[] = [];
        reviewersSnap.forEach((doc) => {
          const reviewer = { id: doc.id, ...doc.data() } as ReviewerData;
          
          // Skip the current reviewer and any reviewers already assigned to this protocol
          if (reviewer.name !== reviewerName && 
              (!protocolData.reviewers || 
                !protocolData.reviewers.some(r => r.name === reviewer.name))) {
            reviewersData.push({
              id: reviewer.id,
              name: reviewer.name
            });
          }
        });
        
        setAvailableReviewers(reviewersData);
        
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [id, reviewerName]);
  
  const handleSuccess = () => {
    setSuccess('Reviewer successfully reassigned!');
    setTimeout(() => {
      router.push(`/admin/protocols/${id}`);
    }, 2000);
  };
  
  const handleCancel = () => {
    router.push(`/admin/protocols/${id}`);
  };
  
  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        <p>Loading data...</p>
      </div>
    );
  }
  
  if (error && !protocol) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        <p className="text-red-600">{error}</p>
        <div className="mt-4">
          <Link href="/admin/protocols" className="text-blue-500 hover:underline">
            Back to Protocols
          </Link>
        </div>
      </div>
    );
  }
  
  return (
    <>
      {protocol && currentReviewer && (
        <ReassignmentModal
          isOpen={showModal}
          protocol={protocol}
          currentReviewer={currentReviewer}
          reviewerList={availableReviewers}
          loading={loading}
          onCancel={handleCancel}
          onSuccess={handleSuccess}
        />
      )}
      
      {error && (
        <div className="fixed top-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}
      
      {success && (
        <div className="fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
          {success}
        </div>
      )}
    </>
  );
} 