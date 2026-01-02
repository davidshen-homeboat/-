
export interface Reservation {
  id: string;
  sourceId?: string;
  customerName: string;
  time: string;
  pax: number;
  date: string;
  type: string;   // '內用' | '外帶' | '包場'
  phone?: string;
  table?: string;
  notes?: string;
  creator?: string;
  duration?: number;
  isLocal?: boolean;
  syncStatus?: 'synced' | 'pending' | 'failed';
}

export type DataType = 'RESERVATIONS' | 'ROSTER';

export interface DataSource {
  id: string;
  name: string;
  url: string;
  writeUrl?: string;
  type: DataType;
  lastUpdated: string;
  status: 'ACTIVE' | 'ERROR';
  diningDuration: number;
}

export interface SheetTab {
  name: string;
  gid: string;
}

export interface RosterShift {
  date: number;
  shift: string;
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
  ROSTER = 'ROSTER',
  WEEKLY_ROSTER = 'WEEKLY_ROSTER',
  SCHEDULER = 'SCHEDULER'
}
