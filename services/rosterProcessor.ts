
import { RosterData, StaffRoster, RosterShift, SheetTab } from "../types";

/**
 * 診斷資訊介面
 */
export interface FetchDiagnostic {
  status?: number;
  statusText?: string;
  proxyName?: string;
  contentSnippet?: string;
  isLoginWall?: boolean;
}

/**
 * 偵測內容是否為 Google 登錄牆
 */
const checkLoginWall = (content: string): string | null => {
  if (!content || typeof content !== 'string') return null;
  const indicators = ['ServiceLogin', 'AccountChooser', 'Sign in', 'data-google-domain-action', 'google-site-verification', '<!DOCTYPE html>'];
  if (indicators.some(ind => content.includes(ind))) {
    return "偵測到公司帳號權限限制。請確保試算表已「發佈到網路」，且設定為「任何知道連結的人」。";
  }
  return null;
};

/**
 * 連結轉換
 */
const convertToCsvUrl = (url: string, gid?: string): string => {
  let targetUrl = url.trim();
  if (targetUrl.includes('script.google.com')) {
    const separator = targetUrl.includes('?') ? '&' : '?';
    if (!targetUrl.includes('action=')) targetUrl += `${separator}action=export`;
    if (gid) targetUrl += `&gid=${gid}`;
    return targetUrl;
  }
  if (!targetUrl.includes('output=csv') && !targetUrl.includes('format=csv')) {
    const idMatch = targetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const urlGidMatch = targetUrl.match(/gid=([0-9]+)/);
    const finalGid = gid || urlGidMatch?.[1] || '0';
    if (idMatch) {
      targetUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${finalGid}`;
    } else if (targetUrl.includes('/pubhtml')) {
      targetUrl = targetUrl.replace(/\/pubhtml.*/, `/pub?output=csv&gid=${finalGid}`);
    }
  }
  return targetUrl;
};

export const fetchSheetTabsWithDiagnostic = async (masterUrl: string): Promise<{ tabs: SheetTab[], diagnostic?: FetchDiagnostic }> => {
  const cleanUrl = masterUrl.trim();
  if (cleanUrl.includes('script.google.com')) {
    try {
      const separator = cleanUrl.includes('?') ? '&' : '?';
      const scriptUrl = `${cleanUrl}${separator}action=getTabs`;
      const response = await fetch(scriptUrl);
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data.length > 0) {
          return { tabs: data.map(t => ({ name: t.name, gid: String(t.gid) })) };
        }
      }
    } catch (e) {}
  }
  let detectionUrl = cleanUrl;
  if (!cleanUrl.includes('script.google.com')) {
    detectionUrl = cleanUrl.replace(/\/edit.*$/, '/pubhtml').replace(/\/pub.*$/, '/pubhtml');
    if (!detectionUrl.includes('/pubhtml')) detectionUrl += '/pubhtml';
  }
  const PROXIES = [{ name: 'Direct', url: (u: string) => u }, { name: 'CorsProxyIO', url: (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}` }];
  let lastDiagnostic: FetchDiagnostic = {};
  for (const proxy of PROXIES) {
    try {
      const targetUrl = proxy.url(detectionUrl);
      const response = await fetch(targetUrl);
      lastDiagnostic = { status: response.status, statusText: response.statusText, proxyName: proxy.name };
      if (!response.ok) continue;
      let html = await response.text();
      const loginError = checkLoginWall(html);
      if (loginError) { lastDiagnostic.isLoginWall = true; continue; }
      const tabs: SheetTab[] = [];
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const menuItems = doc.querySelectorAll('#sheet-menu li a, .sheet-tabs li a, #footer a, ul[role="tablist"] a');
      menuItems.forEach(item => {
        const name = item.textContent?.trim() || '';
        const href = item.getAttribute('href') || '';
        const gidMatch = href.match(/gid=([0-9]+)/);
        if (name && gidMatch && !tabs.find(t => t.gid === gidMatch[1])) {
          tabs.push({ name, gid: gidMatch[1] });
        }
      });
      if (tabs.length > 0) return { tabs };
    } catch (err) {}
  }
  return { tabs: [], diagnostic: lastDiagnostic };
};

export const fetchRosterCsvWithProxy = async (csvUrl: string, gid?: string): Promise<string> => {
  const finalCsvUrl = convertToCsvUrl(csvUrl, gid);
  const PROXY_URL = `https://corsproxy.io/?${encodeURIComponent(finalCsvUrl)}&t=${Date.now()}`;
  try {
    const response = await fetch(PROXY_URL);
    if (response.ok) {
      const text = await response.text();
      if (!checkLoginWall(text)) return text;
    }
  } catch (e) {}
  const directResp = await fetch(finalCsvUrl);
  if (directResp.ok) {
    const text = await directResp.text();
    const loginError = checkLoginWall(text);
    if (loginError) throw new Error(loginError);
    return text;
  }
  throw new Error("連線失敗。請確認試算表已「發佈到網路」。");
};

const splitCsvToLines = (csv: string): string[][] => {
  const result: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const nextChar = csv[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') { currentCell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) { currentRow.push(currentCell.trim()); currentCell = ''; }
    else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentCell.trim());
      if (currentRow.length > 0 || currentCell !== '') result.push(currentRow);
      currentRow = []; currentCell = '';
    } else currentCell += char;
  }
  if (currentCell !== '' || currentRow.length > 0) { currentRow.push(currentCell.trim()); result.push(currentRow); }
  return result;
};

/**
 * 輔助函式：從字串提取年月
 */
const extractDateInfo = (str: string) => {
  let year = "";
  let month = "";

  // 1. 偵測年份：支援 2024-2029 或 113-119 (民國)
  const yearMatch = str.match(/(202[4-9]|11[3-9])/);
  if (yearMatch) {
    let yVal = parseInt(yearMatch[1]);
    if (yVal < 200) yVal += 1911; // 民國年換算
    year = yVal.toString();
  }

  // 2. 偵測月份：支援 1-12，後接「月」、「Month」、「.」或字串結尾
  const monthMatch = str.match(/(\d{1,2})(?:月|Month|\.|$|號)/i);
  if (monthMatch) {
    const mVal = parseInt(monthMatch[1]);
    if (mVal >= 1 && mVal <= 12) month = mVal.toString();
  }

  return { year, month };
};

export const parseRosterCSV = (csv: string, tabName?: string): RosterData => {
  const cleanCsv = csv.replace(/^\ufeff/, '');
  const lines = splitCsvToLines(cleanCsv).filter(row => row.length > 0);
  if (lines.length === 0) throw new Error("資料格式不正確。");

  let detectedYear = new Date().getFullYear().toString();
  let detectedMonth = (new Date().getMonth() + 1).toString();
  
  // 1. 年月偵測優先權一：從分頁名稱提取 (通常最準確)
  if (tabName) {
    const { year, month } = extractDateInfo(tabName);
    if (year) detectedYear = year;
    if (month) detectedMonth = month;
  }

  // 1. 年月偵測優先權二：若分頁名沒抓到，從 CSV 內容前幾列提取
  if (!tabName || detectedYear === "" || detectedMonth === "") {
    for (let i = 0; i < Math.min(15, lines.length); i++) {
      const rowStr = lines[i].join(' ');
      const { year, month } = extractDateInfo(rowStr);
      if (year && !detectedYear) detectedYear = year;
      if (month && !detectedMonth) detectedMonth = month;
      if (detectedYear && detectedMonth) break;
    }
  }

  // 2. 定位「物理錨點 (Physical Anchor)」
  let headerIdx = -1;
  let nameAnchorCol = -1;
  let dateAnchorCol = -1;

  for (let i = 0; i < Math.min(45, lines.length); i++) {
    const row = lines[i];
    const nIdx = row.findIndex(c => c === '姓名' || c === 'Name');
    const dIdx = row.findIndex(c => c === '1' || c === '01');
    const isDateHeader = dIdx !== -1 && row.length > dIdx + 1 && (row[dIdx+1] === '2' || row[dIdx+1] === '02');

    if (isDateHeader) {
      headerIdx = i;
      dateAnchorCol = dIdx;
      if (nIdx !== -1) nameAnchorCol = nIdx;
      else if (i > 0) {
        const prevRow = lines[i-1];
        nameAnchorCol = prevRow.findIndex(c => c === '姓名' || c === 'Name');
      }
      break;
    }
  }

  if (headerIdx === -1) headerIdx = 3;
  if (nameAnchorCol === -1) nameAnchorCol = 1;
  if (dateAnchorCol === -1) dateAnchorCol = 4;

  const anchorDelta = dateAnchorCol - nameAnchorCol;
  const staffs: StaffRoster[] = [];
  let lastValidShopName = "未知分店";
  const dataStartRow = headerIdx + 1;

  for (let i = dataStartRow; i < lines.length; i++) {
    const row = lines[i];
    if (!row || row.length <= 1) continue;

    let staffName = "";
    let actualNameIdx = -1;

    const searchOffsets = [0, -1, 1, -2, 2];
    for (const off of searchOffsets) {
      const targetIdx = nameAnchorCol + off;
      const val = (row[targetIdx] || "").trim();
      if (val && val.length >= 2 && val.length <= 10 && !/^\d+$/.test(val) && !['姓名', '店名', '店別', '序號'].includes(val)) {
        staffName = val;
        actualNameIdx = targetIdx;
        break;
      }
    }

    if (!staffName || actualNameIdx === -1) continue;

    let shopNameCandidate = (row[0] || "").trim();
    if (shopNameCandidate && shopNameCandidate !== staffName && shopNameCandidate.length < 20) {
      lastValidShopName = shopNameCandidate;
    }

    const finalStartCol = actualNameIdx + anchorDelta;
    const shifts: RosterShift[] = [];
    for (let d = 0; d < 31; d++) {
      const colIdx = finalStartCol + d;
      let val = (colIdx >= 0 && colIdx < row.length) ? (row[colIdx] || "").trim() : "";
      if (val === staffName || (val.length > 5 && !['休', 'OFF'].includes(val))) {
        val = "";
      }
      shifts.push({ date: d + 1, shift: val });
    }

    staffs.push({ shopName: lastValidShopName, staffName, shifts });
  }

  if (staffs.length === 0) throw new Error("解析失敗：找不到員工資料或姓名錨點。");
  return { 
    year: detectedYear, 
    month: detectedMonth, 
    days: Array.from({length: 31}, (_, i) => i + 1), 
    staffs 
  };
};
