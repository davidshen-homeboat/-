
import { Reservation } from "../types";

export const fetchCsvStreaming = async (
  url: string,
  onProgress: (phase: 'download' | 'parse', percent: number, loadedMb?: string) => void
): Promise<string> => {
  let targetUrl = url;
  if (!url.includes('output=csv') && !url.includes('format=csv')) {
    if (url.includes('/spreadsheets/d/') && !url.includes('/pub')) {
      const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const gidMatch = url.match(/gid=([0-9]+)/);
      if (idMatch) targetUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${gidMatch?.[1] || '0'}`;
    } else if (url.includes('/pub')) {
      targetUrl = url.replace(/\/pubhtml.*/, '/pub?output=csv').replace(/\/pub$/, '/pub?output=csv');
    }
  }

  const response = await fetch(targetUrl);
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
  // 移除空格並將所有分隔符替換為 /
  const clean = raw.trim().split(' ')[0].replace(/[年月日.-]/g, '/');
  const parts = clean.split('/');
  
  try {
    let year, month, day;
    const currentYear = new Date().getFullYear();
    
    if (parts.length === 2) {
        // 處理 "1/6" 格式
        year = currentYear;
        month = parseInt(parts[0]);
        day = parseInt(parts[1]);
    } else if (parts.length === 3) {
        // 處理 "2025/1/6" 或 "114/1/6"
        year = parseInt(parts[0]);
        month = parseInt(parts[1]);
        day = parseInt(parts[2]);
        if (year < 200) year += 1911; // 民國年轉換
    } else {
        return '';
    }
    
    if (isNaN(year) || isNaN(month) || isNaN(day)) return '';
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    
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

    // 處理包含引號的 CSV 行 (例如備註中有逗號)
    const row = line.includes('"') 
      ? line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g)?.map(v => v.replace(/^"|"$/g, '').trim()) ?? []
      : line.split(',').map(v => v.trim());

    if (row[0]) {
      const nDate = fastNormalizeDate(row[0]);
      if (nDate) {
        result.push({
          id: `rc-${sourceId}-${i}-${Date.now()}`,
          sourceId,
          date: nDate,
          type: row[2] || '內用',
          time: row[3] || '00:00',
          pax: parseInt(row[4]) || 1,
          customerName: row[5] || '未知',
          phone: row[6] || '',
          creator: row[7] || '', // H 欄 (Index 7)
          table: row[8] || '',   // I 欄 (Index 8)
          notes: row[10] || '',  // K 欄 (Index 10)
          isLocal: false
        });
      }
    }

    if (i % BATCH_SIZE === 0) {
      if (onProgress) onProgress(50 + Math.round((i / lines.length) * 50));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (onProgress) onProgress(100);
  return result;
};
