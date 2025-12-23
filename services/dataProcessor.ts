
import { Reservation } from "../types";

export const fetchCsvStreaming = async (
  url: string,
  onProgress: (phase: 'download' | 'parse', percent: number, loadedMb?: string) => void
): Promise<string> => {
  let targetUrl = url;
  
  // 基礎 URL 轉換邏輯
  if (!url.includes('output=csv') && !url.includes('format=csv')) {
    if (url.includes('/spreadsheets/d/') && !url.includes('/pub')) {
      const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const gidMatch = url.match(/gid=([0-9]+)/);
      if (idMatch) targetUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gidMatch?.[1] || '0'}`;
    } else if (url.includes('/pub')) {
      targetUrl = url.replace(/\/pubhtml.*/, '/pub?output=csv').replace(/\/pub$/, '/pub?output=csv');
    }
  }

  // 新增快取破壞 (Cache Busting) 參數，強迫 Google 伺服器回傳最新資料
  const cacheBuster = `&t=${Date.now()}`;
  const finalUrl = targetUrl.includes('?') ? `${targetUrl}${cacheBuster}` : `${targetUrl}?${cacheBuster}`;

  const response = await fetch(finalUrl);
  if (!response.ok) throw new Error(`連線失敗 (${response.status})`);

  const reader = response.body?.getReader();
  const contentLength = +(response.headers.get('Content-Length') ?? 0);
  
  if (!reader) {
    onProgress('download', 50);
    return await response.text();
  }

  let receivedLength = 0;
  let chunks = [];
  
  while(true) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedLength += value.length;
    const progress = contentLength 
      ? Math.round((receivedLength / contentLength) * 50) 
      : Math.min(49, Math.round(receivedLength / 1024 / 20));
    onProgress('download', progress, (receivedLength / 1024 / 1024).toFixed(2));
  }

  const chunksAll = new Uint8Array(receivedLength);
  let position = 0;
  for(let chunk of chunks) {
    chunksAll.set(chunk, position);
    position += chunk.length;
  }
  return new TextDecoder("utf-8").decode(chunksAll);
};

const fastNormalizeDate = (raw: string): string => {
  if (!raw) return '';
  const clean = raw.trim().split(' ')[0].replace(/[年月日.-]/g, '/');
  const parts = clean.split('/');
  
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    let year, month, day;
    if (parts.length === 2) {
        year = currentYear;
        month = parseInt(parts[0]);
        day = parseInt(parts[1]);
        if (currentMonth >= 10 && month <= 3) year += 1;
    } else if (parts.length === 3) {
        year = parseInt(parts[0]);
        month = parseInt(parts[1]);
        day = parseInt(parts[2]);
        if (year < 200) year += 1911; 
    } else {
        return '';
    }
    if (isNaN(year) || isNaN(month) || isNaN(day)) return '';
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  } catch (e) { return ''; }
};

export const mapReservationsCSVAsync = async (
  csvText: string, 
  sourceId: string,
  onProgress?: (percent: number) => void
): Promise<Reservation[]> => {
  const lines = csvText.split(/\r?\n/);
  if (lines.length <= 1) return [];

  const result: Reservation[] = [];
  const BATCH_SIZE = 500; 

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length < 3) continue;

    let row: string[] = [];
    let inQuotes = false;
    let currentValue = '';
    
    for (let char of line) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        row.push(currentValue.trim());
        currentValue = '';
      } else currentValue += char;
    }
    row.push(currentValue.trim());

    if (row[0]) {
      const nDate = fastNormalizeDate(row[0]);
      if (nDate) {
        result.push({
          id: `rc-${sourceId}-${i}`,
          sourceId,
          date: nDate,
          type: row[2] || '內用',
          time: row[3] ? row[3].substring(0, 5) : '12:00',
          pax: parseInt(row[4]) || 1,
          customerName: row[5] || '未知',
          phone: row[6] || '',
          creator: row[7] || '',
          table: row[8] || '',
          notes: row[10] || '',
          duration: row[11] ? parseInt(row[11]) : 90,
          isLocal: false
        });
      }
    }

    if (i % BATCH_SIZE === 0) {
      if (onProgress) onProgress(50 + Math.round((i / lines.length) * 50));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  return result;
};
