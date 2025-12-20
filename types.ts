
export interface Reservation {
  id: string;
  sourceId?: string; // Track which data source this reservation belongs to
  customerName: string;
  time: string;
  pax: number;
  date: string;
  type: string;   // '內用' | '外帶' | '包場'
  phone?: string;
  table?: string;
  notes?: string;
  creator?: string; // 沈家杭 | TAKA
  isLocal?: boolean;
  syncStatus?: 'synced' | 'pending' | 'failed';
}

export type DataType = 'RESERVATIONS';

export interface DataSource {
  id: string;
  name: string;
  url: string;
  writeUrl?: string; // Apps Script Web App URL
  type: DataType;
  lastUpdated: string;
  status: 'ACTIVE' | 'ERROR';
}

export enum AppView {
  RESERVATIONS = 'RESERVATIONS',
  INTEGRATION = 'INTEGRATION'
}
