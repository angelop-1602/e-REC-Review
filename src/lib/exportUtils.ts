function processFieldForExport(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

function convertToCSV(data: Array<Record<string, unknown>>): string {
  if (data.length === 0) return '';

  const keys = Array.from(new Set(data.flatMap((item) => Object.keys(item))));
  const rows = data.map((item) => keys.map((key) => {
    const value = processFieldForExport(item[key]);
    if (typeof value === 'string' && /[,"\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return String(value);
  }).join(','));

  return `${keys.join(',')}\n${rows.join('\n')}\n`;
}

export async function exportCollection(collectionName: string): Promise<{ csv: string; json: string }> {
  const monthMatch = /^protocols\/(.+)$/.exec(collectionName);
  const search = monthMatch ? `?monthId=${encodeURIComponent(monthMatch[1])}` : '';
  const response = await fetch(`/api/admin/protocols${search}`, { cache: 'no-store' });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Failed to export protocol data.');
  }

  const data = result.protocols as Array<Record<string, unknown>>;
  return {
    csv: convertToCSV(data),
    json: JSON.stringify(data, null, 2),
  };
}

export function downloadAsFile(data: string, fileName: string, type: 'csv' | 'json'): void {
  const blob = new Blob([data], { type: type === 'csv' ? 'text/csv' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function generateExportFileName(collectionName: string, type: 'csv' | 'json'): string {
  const date = new Date().toISOString().split('T')[0];
  return `${collectionName}_export_${date}.${type}`;
}
