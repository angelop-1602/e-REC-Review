import { listProtocols } from '@/lib/mysql';
import type { Protocol } from '@/lib/protocols';

export async function loadProtocolDtos(): Promise<Protocol[]> {
  return (await listProtocols()) as unknown as Protocol[];
}
