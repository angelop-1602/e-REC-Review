'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import AdminNav from '../AdminNav';
import { isOverdue, isDueSoon, formatDate, getFormTypeName } from '@/lib/utils';

interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  due_date: string;
  status: string;
  document_type?: string;
  reviewers?: {
    id: string;
    name: string;
    status: string;
    document_type: string;
  }[];
}

export default function ProtocolsPage() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterRelease, setFilterRelease] = useState('all');
  const [filterAcademic, setFilterAcademic] = useState('all');
  const [releaseOptions, setReleaseOptions] = useState<string[]>([]);
  const [academicOptions, setAcademicOptions] = useState<string[]>([]);

  useEffect(() => {
    const fetchProtocols = async () => {
      try {
        setLoading(true);
        const protocolsQuery = query(
          collection(db, 'protocols'),
          orderBy('created_at', 'desc')
        );
        const querySnapshot = await getDocs(protocolsQuery);
        
        const fetchedProtocols: Protocol[] = [];
        const uniqueReleases = new Set<string>();
        const uniqueAcademic = new Set<string>();
        
        querySnapshot.forEach((doc) => {
          const data = doc.data() as Protocol;
          fetchedProtocols.push({ 
            ...data,
            id: doc.id 
          });
          
          if (data.release_period) {
            uniqueReleases.add(data.release_period);
          }
          
          if (data.academic_level) {
            uniqueAcademic.add(data.academic_level);
          }
        });
        
        setProtocols(fetchedProtocols);
        setReleaseOptions(Array.from(uniqueReleases).sort());
        setAcademicOptions(Array.from(uniqueAcademic).sort());
      } catch (err) {
        console.error("Error fetching protocols:", err);
        setError("Failed to load protocols");
      } finally {
        setLoading(false);
      }
    };

    fetchProtocols();
  }, []);

  const filteredProtocols = protocols.filter((protocol) => {
    const matchesSearch = protocol.protocol_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || protocol.status === filterStatus || 
      (filterStatus === 'overdue' && isOverdue(protocol.due_date)) ||
      (filterStatus === 'due-soon' && isDueSoon(protocol.due_date));
    const matchesRelease = filterRelease === 'all' || protocol.release_period === filterRelease;
    const matchesAcademic = filterAcademic === 'all' || protocol.academic_level === filterAcademic;
    
    return matchesSearch && matchesStatus && matchesRelease && matchesAcademic;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
        <div className="bg-white p-4 rounded-lg shadow-md mb-6">
        <div className="mb-6 flex justify-between items-center border-b-2 border-gray-200 pb-2 ">
          <h1 className="text-2xl font-bold">Protocol Management</h1>
          <Link 
            href="/admin/csv-upload" 
            className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600"
          >
            Upload CSV
          </Link>
        </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <div>
              <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
                Search
              </label>
              <input
                type="text"
                id="search"
                className="border border-gray-300 rounded-md w-full p-2"
                placeholder="Search protocols..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                id="status"
                className="border border-gray-300 rounded-md w-full p-2"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
                <option value="overdue">Overdue</option>
                <option value="due-soon">Due Soon</option>
              </select>
            </div>
            <div>
              <label htmlFor="release" className="block text-sm font-medium text-gray-700 mb-1">
                Release Period
              </label>
              <select
                id="release"
                className="border border-gray-300 rounded-md w-full p-2"
                value={filterRelease}
                onChange={(e) => setFilterRelease(e.target.value)}
              >
                <option value="all">All Releases</option>
                {releaseOptions.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="academic" className="block text-sm font-medium text-gray-700 mb-1">
                Academic Level
              </label>
              <select
                id="academic"
                className="border border-gray-300 rounded-md w-full p-2"
                value={filterAcademic}
                onChange={(e) => setFilterAcademic(e.target.value)}
              >
                <option value="all">All Levels</option>
                {academicOptions.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center p-8">
            <p>Loading protocols...</p>
          </div>
        ) : error ? (
          <div className="text-center p-8 bg-red-50 text-red-600 rounded-lg">
            <p>{error}</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Protocol
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Release Period
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Academic Level
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Form Type
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Reviewers
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Due Date
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredProtocols.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-4 text-center text-sm text-gray-500">
                        No protocols found matching your criteria
                      </td>
                    </tr>
                  ) : (
                    filteredProtocols.map(protocol => (
                      <tr key={protocol.id}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {protocol.protocol_name}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {protocol.release_period || "N/A"}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {protocol.academic_level || "N/A"}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {protocol.document_type ? getFormTypeName(protocol.document_type) : (
                              protocol.reviewers && protocol.reviewers[0]?.document_type ? 
                              getFormTypeName(protocol.reviewers[0].document_type) : 'N/A'
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-500">
                            {protocol.reviewers ? `${protocol.reviewers.length} reviewer(s)` : "1 reviewer"}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            protocol.status === 'Completed' ? 'bg-green-100 text-green-800' : 
                            protocol.due_date && isOverdue(protocol.due_date) ? 'bg-red-100 text-red-800' :
                            protocol.due_date && isDueSoon(protocol.due_date) ? 'bg-yellow-100 text-yellow-800' :
                            'bg-blue-100 text-blue-800'
                          }`}>
                            {protocol.status === 'Completed' ? 'Completed' : 
                             protocol.due_date && isOverdue(protocol.due_date) ? 'Overdue' :
                             protocol.due_date && isDueSoon(protocol.due_date) ? 'Due Soon' :
                             'In Progress'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className={`text-sm ${
                            protocol.due_date && isOverdue(protocol.due_date) ? 'text-red-600 font-semibold' : 
                            protocol.due_date && isDueSoon(protocol.due_date) ? 'text-orange-600 font-semibold' : 
                            'text-gray-500'
                          }`}>
                            {protocol.due_date ? formatDate(protocol.due_date) : "No due date"}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <Link 
                            href={`/admin/protocols/${protocol.id}`}
                            className="text-indigo-600 hover:text-indigo-900 mr-3"
                          >
                            View
                          </Link>
                          {protocol.status !== 'Completed' && protocol.due_date && isOverdue(protocol.due_date) && (
                            <Link 
                              href={`/admin/protocols/${protocol.id}`}
                              className="text-red-600 hover:text-red-900"
                            >
                              Manage
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </div>
  );
}