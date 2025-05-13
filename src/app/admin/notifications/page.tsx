'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';


interface NotificationSettings {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'twice-weekly';
  sendToReviewers: boolean;
  sendToAdmins: boolean;
  adminEmails: string[];
  overdueThreshold: number;  // Days after due date to send notification
  dueSoonThreshold: number;  // Days before due date to send notification
  lastRun?: string;          // ISO date string of last notification run
}

export default function NotificationsSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings>({
    enabled: false,
    frequency: 'daily',
    sendToReviewers: true,
    sendToAdmins: true,
    adminEmails: [],
    overdueThreshold: 1,
    dueSoonThreshold: 3
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  
  const [notification, setNotification] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message: string;
  }>({
    isOpen: false,
    type: 'info',
    title: '',
    message: ''
  });

  const showNotification = (type: 'success' | 'error' | 'info' | 'warning', title: string, message: string) => {
    setNotification({
      isOpen: true,
      type,
      title,
      message
    });
  };

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        setLoading(true);
        
        // Fetch notification settings from Firestore
        const settingsRef = doc(db, 'system', 'notification_settings');
        const settingsSnap = await getDoc(settingsRef);
        
        if (settingsSnap.exists()) {
          setSettings(settingsSnap.data() as NotificationSettings);
        } else {
          // Use default settings
          const defaultSettings: NotificationSettings = {
            enabled: false,
            frequency: 'daily',
            sendToReviewers: true,
            sendToAdmins: true,
            adminEmails: [],
            overdueThreshold: 1,
            dueSoonThreshold: 3
          };
          
          // Save default settings to Firestore
          await setDoc(settingsRef, defaultSettings);
          setSettings(defaultSettings);
        }
      } catch (error) {
        console.error('Error fetching notification settings:', error);
        showNotification('error', 'Error', 'Failed to load notification settings');
      } finally {
        setLoading(false);
      }
    };
    
    fetchSettings();
  }, []);

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      
      // Update settings in Firestore
      const settingsRef = doc(db, 'system', 'notification_settings');
      await setDoc(settingsRef, settings);
      
      showNotification('success', 'Settings Saved', 'Notification settings have been saved successfully');
    } catch (error) {
      console.error('Error saving notification settings:', error);
      showNotification('error', 'Error', 'Failed to save notification settings');
    } finally {
      setSaving(false);
    }
  };

  const handleAddEmail = () => {
    if (!emailInput.trim()) return;
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailInput)) {
      showNotification('warning', 'Invalid Email', 'Please enter a valid email address');
      return;
    }
    
    // Add email to the list if it doesn't already exist
    if (!settings.adminEmails.includes(emailInput)) {
      setSettings({
        ...settings,
        adminEmails: [...settings.adminEmails, emailInput]
      });
      setEmailInput('');
    } else {
      showNotification('warning', 'Duplicate Email', 'This email address is already in the list');
    }
  };

  const handleRemoveEmail = (email: string) => {
    setSettings({
      ...settings,
      adminEmails: settings.adminEmails.filter(e => e !== email)
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Notification Settings</h1>
      
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Email Notifications</h2>
        
        <div className="space-y-6">
          {/* Enable/Disable Notifications */}
          <div className="flex items-start">
            <div className="flex h-6 items-center">
              <input
                id="notifications-enabled"
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
            </div>
            <div className="ml-3 text-sm leading-6">
              <label htmlFor="notifications-enabled" className="font-medium text-gray-900">
                Enable Email Notifications
              </label>
              <p className="text-gray-500">
                When enabled, the system will send automatic email notifications about overdue protocols.
              </p>
            </div>
          </div>
          
          {/* Notification Frequency */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notification Frequency
            </label>
            <select
              value={settings.frequency}
              onChange={(e) => setSettings({ ...settings, frequency: e.target.value as any })}
              className="mt-1 block w-full rounded-md border-gray-300 py-2 pl-3 pr-10 text-base focus:border-blue-500 focus:outline-none focus:ring-blue-500 sm:text-sm"
              disabled={!settings.enabled}
            >
              <option value="daily">Daily</option>
              <option value="twice-weekly">Twice Weekly (Mon & Thu)</option>
              <option value="weekly">Weekly (Monday)</option>
            </select>
            <p className="mt-1 text-sm text-gray-500">
              How often should the system send notification emails.
            </p>
          </div>
          
          {/* Notification Recipients */}
          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">
              Notification Recipients
            </label>
            
            <div className="flex items-start">
              <div className="flex h-6 items-center">
                <input
                  id="send-to-reviewers"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                  checked={settings.sendToReviewers}
                  onChange={(e) => setSettings({ ...settings, sendToReviewers: e.target.checked })}
                  disabled={!settings.enabled}
                />
              </div>
              <div className="ml-3 text-sm leading-6">
                <label htmlFor="send-to-reviewers" className="font-medium text-gray-900">
                  Send to Reviewers
                </label>
                <p className="text-gray-500">
                  Notify reviewers about their own overdue protocols.
                </p>
              </div>
            </div>
            
            <div className="flex items-start">
              <div className="flex h-6 items-center">
                <input
                  id="send-to-admins"
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                  checked={settings.sendToAdmins}
                  onChange={(e) => setSettings({ ...settings, sendToAdmins: e.target.checked })}
                  disabled={!settings.enabled}
                />
              </div>
              <div className="ml-3 text-sm leading-6">
                <label htmlFor="send-to-admins" className="font-medium text-gray-900">
                  Send to Administrators
                </label>
                <p className="text-gray-500">
                  Send a summary of all overdue protocols to administrators.
                </p>
              </div>
            </div>
          </div>
          
          {/* Admin Email List */}
          {settings.sendToAdmins && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Administrator Email Addresses
              </label>
              
              <div className="flex mb-2">
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="Enter admin email address"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  disabled={!settings.enabled}
                />
                <button
                  type="button"
                  onClick={handleAddEmail}
                  className="ml-2 inline-flex items-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  disabled={!settings.enabled || !emailInput.trim()}
                >
                  Add
                </button>
              </div>
              
              <div className="mt-2">
                {settings.adminEmails.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">No administrator emails added yet.</p>
                ) : (
                  <ul className="divide-y divide-gray-200 border rounded-md">
                    {settings.adminEmails.map((email) => (
                      <li key={email} className="flex items-center justify-between py-2 px-3">
                        <span className="text-sm text-gray-800">{email}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveEmail(email)}
                          className="text-red-600 hover:text-red-800"
                          disabled={!settings.enabled}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          
          {/* Threshold Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="overdue-threshold" className="block text-sm font-medium text-gray-700">
                Overdue Threshold (days)
              </label>
              <input
                type="number"
                id="overdue-threshold"
                min="0"
                max="30"
                value={settings.overdueThreshold}
                onChange={(e) => setSettings({ ...settings, overdueThreshold: parseInt(e.target.value) || 0 })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                disabled={!settings.enabled}
              />
              <p className="mt-1 text-sm text-gray-500">
                Days after the due date to consider a protocol overdue for notifications.
              </p>
            </div>
            
            <div>
              <label htmlFor="due-soon-threshold" className="block text-sm font-medium text-gray-700">
                Due Soon Threshold (days)
              </label>
              <input
                type="number"
                id="due-soon-threshold"
                min="1"
                max="14"
                value={settings.dueSoonThreshold}
                onChange={(e) => setSettings({ ...settings, dueSoonThreshold: parseInt(e.target.value) || 3 })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                disabled={!settings.enabled}
              />
              <p className="mt-1 text-sm text-gray-500">
                Days before the due date to send upcoming deadline notifications.
              </p>
            </div>
          </div>
          
          {/* Last Run Information */}
          {settings.lastRun && (
            <div className="mt-2 p-3 bg-gray-50 rounded-md border border-gray-200">
              <p className="text-sm text-gray-600">
                <span className="font-medium">Last notification sent:</span>{' '}
                {new Date(settings.lastRun).toLocaleString()}
              </p>
            </div>
          )}
          
          {/* Save Button */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveSettings}
              className="inline-flex items-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              disabled={saving}
            >
              {saving ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Saving...
                </span>
              ) : (
                'Save Settings'
              )}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
} 