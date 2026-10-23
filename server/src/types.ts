/** The contract every platform sends. Swift and Kotlin mirror these shapes field for field. */
export type Platform = 'healthkit' | 'healthconnect';

export type Reading = {
  /** HealthKit sample UUID or Health Connect record id. The idempotency key; survives reinstalls. */
  id: string;
  platform: Platform;
  /** mmHg. The OS converts units on read, so the server never does. */
  systolic: number;
  diastolic: number;
  /** UTC. */
  measuredAt: string;
  /** The phone's offset from UTC at the reading, so AM/PM and days are the member's own. */
  tzOffsetMin: number;
  source: { appId: string; appName: string; deviceModel?: string; manufacturer?: string };
  /** HKMetadataKeyWasUserEntered / Health Connect recordingMethod. */
  method: 'device' | 'manual' | 'unknown';
};

export type Tombstone = { id: string; platform: Platform };

/** One page from the device: everything between two anchors. The app advances its anchor only on 2xx. */
export type Changes = { readings: Reading[]; tombstones: Tombstone[] };

export type Entry = 'watch_event' | 'history' | 'clinician';

/** Clinical config. Owned by the clinical lead, versioned, served to the app. */
export type Config = {
  version: string;
  crisis: { systolic: number; diastolic: number };
  historyScan: { lookbackDays: number; minDays: number; systolic: number; diastolic: number };
  protocol: {
    days: number;
    discardFirstDay: boolean;
    minReadings: number;
    /** Local hours, [start, end). */
    amHours: [number, number];
    pmHours: [number, number];
    duplicateWindowSec: number;
  };
  /** Validated cuffs. Without a model, any reading from that app counts. */
  cuffs: { appId: string; model?: string }[];
  stalledAfterHours: number;
  /** Grace before the first reading. A mailed cuff takes days, so 72 hours would stall it in transit. */
  firstReadingWithinHours: number;
};
