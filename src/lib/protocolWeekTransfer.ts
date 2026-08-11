import { collection, doc, getDocs, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { formatMonthLabel, formatWeekLabel } from '@/lib/protocols';

const MAX_PROTOCOLS_PER_TRANSFER = 250;

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

  const sourceCollection = collection(db, 'protocols', sourceMonthId, weekId);
  const sourceListing = await getDocs(sourceCollection);

  if (sourceListing.empty) {
    throw new Error('This week no longer contains any protocols to move.');
  }

  if (sourceListing.size > MAX_PROTOCOLS_PER_TRANSFER) {
    throw new Error(
      `This week contains ${sourceListing.size} protocols. Move at most ${MAX_PROTOCOLS_PER_TRANSFER} protocols in one atomic transfer.`
    );
  }

  const protocolIds = sourceListing.docs.map((protocolDocument) => protocolDocument.id);
  const sourceRefs = protocolIds.map((protocolId) =>
    doc(db, 'protocols', sourceMonthId, weekId, protocolId)
  );
  const targetRefs = protocolIds.map((protocolId) =>
    doc(db, 'protocols', targetMonthId, weekId, protocolId)
  );

  await runTransaction(db, async (transaction) => {
    const [sourceSnapshots, targetSnapshots] = await Promise.all([
      Promise.all(sourceRefs.map((sourceRef) => transaction.get(sourceRef))),
      Promise.all(targetRefs.map((targetRef) => transaction.get(targetRef))),
    ]);

    const missingSourceIds = sourceSnapshots
      .filter((sourceSnapshot) => !sourceSnapshot.exists())
      .map((sourceSnapshot) => sourceSnapshot.id);

    if (missingSourceIds.length > 0) {
      throw new Error('The source week changed while it was being moved. Refresh the page and try again.');
    }

    const conflictingIds = targetSnapshots
      .filter((targetSnapshot) => targetSnapshot.exists())
      .map((targetSnapshot) => targetSnapshot.id);

    if (conflictingIds.length > 0) {
      const displayedIds = conflictingIds.slice(0, 5).join(', ');
      const remainingCount = conflictingIds.length - 5;
      const remainingLabel = remainingCount > 0 ? ` and ${remainingCount} more` : '';

      throw new Error(
        `The destination already contains ${displayedIds}${remainingLabel}. Resolve these duplicate protocol IDs before moving the week.`
      );
    }

    sourceSnapshots.forEach((sourceSnapshot, index) => {
      transaction.set(targetRefs[index], {
        ...sourceSnapshot.data(),
        release_period: `${formatMonthLabel(targetMonthId)} ${formatWeekLabel(weekId)}`,
      });
      transaction.delete(sourceRefs[index]);
    });
  });

  return {
    movedCount: protocolIds.length,
    sourceMonthId,
    targetMonthId,
    weekId,
  };
}
