import { Reservation } from './types';

export const MOCK_RESERVATIONS: Reservation[] = [
  { id: '1', date: '2025-12-18', time: '12:00', customerName: '陳小姐', pax: 4, type: '內用', table: 'A1', phone: '0912345678', notes: '靠窗位' },
  { id: '2', date: '2025-12-18', time: '14:30', customerName: '王先生', pax: 2, type: '外帶', phone: '0922333444', notes: '慶生' },
  { id: '3', date: '2026-01-06', time: '18:00', customerName: '林闔家', pax: 6, type: '包場', table: 'VIP', phone: '0911222333', notes: '需兒童椅' },
  { id: '4', date: '2026-01-06', time: '11:00', customerName: '張經理', pax: 12, type: '內用', table: 'B區', phone: '0955666777', notes: '部門聚餐' },
];
