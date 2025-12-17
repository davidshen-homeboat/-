export interface Reservation {
  id: string;
  customerName: string;
  time: string;
  pax: number;
  date: string;
  type: string;   // '內用' | '外帶' | '包場'
  phone?: string;
  table?: string;
  notes?: string;
}

export interface DataSource {
  id: string;
  name: string;
  url: string;
  type: 'RESERVATIONS'; // Only allow reservations now
  lastUpdated: string;
  status: 'ACTIVE' | 'ERROR';
}

export enum AppView {
  RESERVATIONS = 'RESERVATIONS',
  INTEGRATION = 'INTEGRATION'
}
