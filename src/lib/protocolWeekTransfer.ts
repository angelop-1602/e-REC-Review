interface MoveProtocolWeekOptions {
  sourceMonthId: string;
  targetMonthId: string;
  weekId: string;
}

export interface MoveProtocolWeekResult {
  movedCount: number;
  sourceMonthId: string;
  targetMonthId: string;
  weekId: string;
}

export async function moveProtocolWeek({
  sourceMonthId,
  targetMonthId,
  weekId,
}: MoveProtocolWeekOptions): Promise<MoveProtocolWeekResult> {
  if (!sourceMonthId || !targetMonthId || !weekId) {
    throw new Error('The source month, destination month, and week are required.');
  }

  if (sourceMonthId === targetMonthId) {
    throw new Error('Choose a different destination month.');
  }

  const response = await fetch('/api/admin/protocol-weeks/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceMonthId, targetMonthId, weekId }),
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Failed to move the protocol week.');
  }

  return result as MoveProtocolWeekResult;
}
