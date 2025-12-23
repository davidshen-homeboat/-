
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
  duration?: number; // 用餐分鐘數
  isLocal?: boolean;
  syncStatus?: 'synced' | 'pending' | 'failed';
}

export type DataType = 'RESERVATIONS' | 'ROSTER';

export interface DataSource {
  id: string;
  name: string;
  url: string;
  writeUrl?: string; // Apps Script Web App URL
  type: DataType;
  lastUpdated: string;
  status: 'ACTIVE' | 'ERROR';
  diningDuration: number; // In minutes, custom for each shop
}

export interface SheetTab {
  name: string;
  gid: string;
}

export interface RosterShift {
  date: number;
  shift: string; // A, B, C, H
}

export interface StaffRoster {
  shopName: string;
  staffName: string;
  shifts: RosterShift[];
}

export interface RosterData {
  year: string;
  month: string;
  days: number[];
  staffs: StaffRoster[];
}

export enum AppView {
  RESERVATIONS = 'RESERVATIONS',
  INTEGRATION = 'INTEGRATION',
  ROSTER = 'ROSTER'
}
