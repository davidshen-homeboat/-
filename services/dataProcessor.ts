import { Reservation } from "../types";

// Simple CSV Parser
export const parseCSV = (text: string): string[][] => {
  const lines = text.split(/\r?\n/); 
  
  return lines.map(line => {
    // Keep empty rows as empty arrays to preserve relative spacing
    if (line.trim() === '') return []; 

    const regex = /(?:,|\n|^)("(?:(?:"")*[^"]*)*"|[^",\n]*|(?:\n|$))/g;
    const matches = [];
    let match;
    while ((match = regex.exec(line)) !== null) {
        let value = match[1];
        if (value.startsWith(',')) value = value.substring(1);
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.substring(1, value.length - 1).replace(/""/g, '"');
        }
        matches.push(value.trim());
    }
    return matches.filter(m => m !== undefined);
  });
};

const normalizeDate = (raw: string): string => {
  if (!raw) return '';
  
  let clean = raw.trim()
      .replace(/\([^\)]+\)/g, '')   
      .replace(/（[^）]+）/g, '') 
      .replace(/[年月日]/g, '/')    
      .replace(/[.-]/g, '/');      

  clean = clean.split(' ')[0];
  const parts = clean.split('/').filter(p => p.length > 0);
  let year = 0, month = 0, day = 0;

  if (parts.length === 2) {
      const now = new Date();
      year = now.getFullYear();
      month = parseInt(parts[0]);
      day = parseInt(parts[1]);
  } else if (parts.length === 3) {
      let y = parseInt(parts[0]);
      month = parseInt(parts[1]);
      day = parseInt(parts[2]);
      if (y >= 100 && y <= 199) year = y + 1911;
      else if (y < 100) year = y + 2000;
      else year = y;
  } else {
      const d = new Date(clean);
      if (!isNaN(d.getTime())) {
         let y = d.getFullYear();
         if (y < 200) y += 1900; 
         if (y >= 100 && y <= 199) y += 1911;
         year = y;
         month = d.getMonth() + 1;
         day = d.getDate();
      } else {
         return '';
      }
  }

  const d = new Date(year, month - 1, day);
  if (isNaN(d.getTime()) || d.getMonth() !== month - 1) return '';
  
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  
  return `${yy}-${mm}-${dd}`;
};

export const fetchCsvFromUrl = async (url: string): Promise<string> => {
  let targetUrl = url;
  const googleSheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = url.match(/gid=([0-9]+)/);
  
  if (googleSheetIdMatch && googleSheetIdMatch[1]) {
    const sheetId = googleSheetIdMatch[1];
    let params = `tqx=out:csv`;
    if (gidMatch && gidMatch[1]) {
        params += `&gid=${gidMatch[1]}`;
    }
    targetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${params}`;
  }

  const response = await fetch(targetUrl);
  if (!response.ok) {
     throw new Error(`Failed to fetch CSV: ${response.statusText}`);
  }
  return await response.text();
};

// --- Mappers ---

export const mapReservationsCSV = (csvText: string): Reservation[] => {
  try {
    const rows = parseCSV(csvText);
    return rows.map((row, index) => {
        if (!row[0]) return null;
        const nDate = normalizeDate(row[0]);
        if (!nDate) return null;

        // Expect: Date, _, Type, Time, Pax, Name, Phone, _, Table
        return {
            id: `res-${index}`,
            date: nDate,
            type: row[2] || '內用', 
            time: row[3] || '00:00',
            pax: parseInt(row[4]) || 1,
            customerName: row[5] || '未知貴賓',
            phone: row[6] || '',
            table: row[8] || '', 
            notes: '' 
        };
    }).filter(r => r !== null) as Reservation[];
  } catch (e) {
    console.error("Error parsing reservations", e);
    return [];
  }
};