import { QueueEntry } from '../types/queue-entry';

export class CloudIngestDto {
  venueId!: string;
  entries!: QueueEntry[];
}
