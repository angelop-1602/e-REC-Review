'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';


interface NotificationSettings {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'twice-weekly';
  sendToReviewers: boolean;
  dueSoonThreshold: number;  // Days before due date to send notification
  lastRun?: string;          // ISO date string of last notification run
}

function normalizeNotificationSettings(data: Record<string, unknown>): NotificationSettings {
  const frequency = data.frequency === 'weekly' || data.frequency === 'twice-weekly'
    ? data.frequency
    : 'daily';
  const threshold = Number(data.dueSoonThreshold);
  let lastRun: string | undefined;

  if (typeof data.lastRun === 'string') {
    lastRun = data.lastRun;
  } else if (data.lastRun && typeof data.lastRun === 'object' && 'toDate' in data.lastRun) {
    try {
      lastRun = (data.lastRun as { toDate: () => Date }).toDate().toISOString();
    } catch {
      lastRun = undefined;
    }
  }

  return {
    enabled: data.enabled === true,
    frequency,
    sendToReviewers: data.sendToReviewers !== false,
    dueSoonThreshold: Number.isInteger(threshold) ? Math.min(14, Math.max(1, threshold)) : 3,
    lastRun,
  };
}

export default function NotificationsSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings>({
    enabled: false,
    frequency: 'daily',
    sendToReviewers: true,
    dueSoonThreshold: 3
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        
        const response = await fetch('/api/admin/notification-settings');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Failed to load settings');
        setSettings(normalizeNotificationSettings(payload.settings));
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
      
      const response = await fetch('/api/admin/notification-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Failed to save settings');
      setSettings(normalizeNotificationSettings(payload.settings));
      
      showNotification('success', 'Settings Saved', 'Notification settings have been saved successfully');
    } catch (error) {
      console.error('Error saving notification settings:', error);
      showNotification('error', 'Error', 'Failed to save notification settings');
    } finally {
      setSaving(false);
    }
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
      <h1 className="text-2xl font-bold mb-6">Automatic Review Reminders</h1>

      {notification.isOpen && (
        <div
          className={`mb-6 rounded-md border px-4 py-3 text-sm ${
            notification.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : notification.type === 'warning'
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : notification.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-blue-200 bg-blue-50 text-blue-700'
          }`}
          role="status"
        >
          <p className="font-medium">{notification.title}</p>
          <p className="mt-1">{notification.message}</p>
        </div>
      )}
      
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Reminder Email Settings</h2>
        
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
                Enable Automatic Reminders
              </label>
              <p className="text-gray-500">
                At 8:00 AM Manila time, the system checks for reviews nearing their due date and emails only reviewers who have not completed them.
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
                  Send each reviewer only their own unfinished reviews that are within the due-soon window.
                </p>
              </div>
            </div>
            
          </div>

          {/* Threshold Settings */}
          <div className="max-w-md">
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
                <span className="font-medium">Last reminder check:</span>{' '}
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
