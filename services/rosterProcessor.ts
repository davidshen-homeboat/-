
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
 * 解碼 Unicode 轉義字元
 */
const decodeUnicode = (str: string): string => {
  if (!str) return "";
  let decoded = str;
  try {
    decoded = str.replace(/\\\\u([a-fA-F0-9]{4})/g, (_, grp) => 
      String.fromCharCode(parseInt(grp, 16))
    );
    decoded = decoded.replace(/\\u([a-fA-F0-9]{4})/g, (_, grp) => 
      String.fromCharCode(parseInt(grp, 16))
    );
  } catch (e) {
    return str;
  }
  return decoded;
};

/**
 * 偵測內容是否為 Google 登錄牆或權限受限頁面
 */
const checkLoginWall = (content: string): string | null => {
  if (!content) return null;
  const indicators = [
    { key: 'ServiceLogin', msg: '偵測到 Google 登錄頁面。' },
    { key: 'AccountChooser', msg: '偵測到帳號選擇頁面。' },
    { key: 'data-google-domain-action', msg: '偵測到公司帳號 (Workspace) 權限限制。' },
    { key: 'identifierId', msg: '偵測到登錄表單。' },
    { key: 'google-site-verification', msg: '讀取到無效的 Google 驗證頁面。' },
    { key: '<!DOCTYPE html>', msg: '讀取到 HTML 網頁而非純文字資料。' }
  ];

  for (const ind of indicators) {
    if (content.includes(ind.key)) {
      return `${ind.msg}請確認試算表已「發佈到網路 (整份文件)」，且共用權限設定正確。`;
    }
  }
  return null;
};

/**
 * 將原始連結轉換為正確的 CSV 匯出連結 (對齊 dataProcessor.ts 邏輯)
 */
const convertToCsvUrl = (url: string, gid?: string): string => {
  let targetUrl = url.trim();
  
  if (!targetUrl.includes('output=csv') && !targetUrl.includes('format=csv')) {
    if (targetUrl.includes('/spreadsheets/d/') && !targetUrl.includes('/pub')) {
      const idMatch = targetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const urlGidMatch = targetUrl.match(/gid=([0-9]+)/);
      const finalGid = gid || urlGidMatch?.[1] || '0';
      if (idMatch) targetUrl = `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv&gid=${finalGid}`;
    } else if (targetUrl.includes('/pub')) {
      targetUrl = targetUrl.replace(/\/pubhtml.*/, '/pub?output=csv').replace(/\/pub$/, '/pub?output=csv');
      if (gid) {
        targetUrl += targetUrl.includes('?') ? `&gid=${gid}` : `?gid=${gid}`;
      }
    }
  }

  // 加入 Cache Buster
  const cacheBuster = `t=${Date.now()}`;
  return targetUrl.includes('?') ? `${targetUrl}&${cacheBuster}` : `${targetUrl}?${cacheBuster}`;
};

/**
 * 從 HTML 字串中提取分頁資訊
 */
const parseTabsFromHtml = (html: string): SheetTab[] => {
  const tabs: SheetTab[] = [];
  if (!html) return tabs;

  const bootstrapPatterns = [
    /\[\d+,\s*"([^"]+)"\s*(?:,[^,\]]*){4,12},\s*"?(\d{5,20})"?\s*\]/g,
    /\["?(\d{5,20})"?\s*,\s*"([^"]+)"\s*,\s*0\s*,\s*0\s*,\s*0/g
  ];

  bootstrapPatterns.forEach(pattern => {
    const matches = Array.from(html.matchAll(pattern));
    matches.forEach(match => {
      let name = "";
      let gid = "";
      if (match[1].length > 4 && /^\d+$/.test(match[1])) {
        gid = match[1];
        name = decodeUnicode(match[2]);
      } else {
        name = decodeUnicode(match[1]);
        gid = match[2];
      }
      if (name && gid && name.length < 50 && !tabs.find(t => t.gid === gid)) {
        if (!['gid', 'name', 'true', 'false', 'null', 'undefined'].includes(name.toLowerCase())) {
          tabs.push({ name, gid });
        }
      }
    });
  });

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const menuItems = doc.querySelectorAll('#sheet-menu li a');
  menuItems.forEach(item => {
    const name = item.textContent?.trim() || '';
    const href = item.getAttribute('href') || '';
    const gidMatch = href.match(/gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : href.replace('#', '');
    if (name && gid && !tabs.find(t => t.gid === gid)) {
      tabs.push({ name, gid });
    }
  });

  return tabs;
};

const PROXIES = [
  { name: 'Direct', url: (url: string) => url },
  { name: 'CorsProxyIO', url: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
  { name: 'AllOriginsRaw', url: (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}` },
  { name: 'AllOriginsJSON', url: (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}` }
];

export const fetchSheetTabsWithDiagnostic = async (pubHtmlUrl: string): Promise<{ tabs: SheetTab[], diagnostic?: FetchDiagnostic }> => {
  let cleanUrl = pubHtmlUrl.trim();
  
  // 準備 HTML 偵測用的 URL (pubhtml)
  let detectionUrl = cleanUrl.split('#')[0].split('?')[0]; 
  if (detectionUrl.includes('/edit')) {
    detectionUrl = detectionUrl.replace(/\/edit.*$/, '/pubhtml');
  } else if (!detectionUrl.endsWith('/pubhtml') && detectionUrl.includes('/spreadsheets/d/')) {
    detectionUrl = detectionUrl.replace(/\/pub$/, '') + '/pubhtml';
  }

  const cacheBuster = `t=${Date.now()}`;
  const finalDetectionUrl = detectionUrl.includes('?') ? `${detectionUrl}&${cacheBuster}` : `${detectionUrl}?${cacheBuster}`;

  let lastDiagnostic: FetchDiagnostic = {};

  for (const proxy of PROXIES) {
    try {
      const targetUrl = proxy.url(finalDetectionUrl);
      const response = await fetch(targetUrl);
      
      lastDiagnostic = {
        status: response.status,
        statusText: response.statusText,
        proxyName: proxy.name
      };

      if (!response.ok) continue;

      let html = '';
      if (proxy.name === 'AllOriginsJSON') {
        const data = await response.json();
        html = data.contents;
      } else {
        html = await response.text();
      }

      if (!html) continue;
      
      const loginError = checkLoginWall(html);
      if (loginError) {
        lastDiagnostic.isLoginWall = true;
        lastDiagnostic.contentSnippet = html.substring(0, 500);
        // 如果是 Direct 模式發現登入牆，通常代表 Proxy 也會失敗，但在公司網路環境中我們繼續嘗試
        if (proxy.name === 'Direct') continue;
      }

      const detectedTabs = parseTabsFromHtml(html);
      if (detectedTabs.length > 0) {
        return { 
          tabs: detectedTabs
            .filter(t => t.name && !t.name.includes('<') && t.name.length > 0)
            .sort((a, b) => /月/.test(a.name) ? -1 : 1)
        };
      }
    } catch (err: any) {
      console.warn(`[Roster] ${proxy.name} fetch failed:`, err);
    }
  }

  const urlGidMatch = pubHtmlUrl.match(/gid=([0-9]+)/);
  if (urlGidMatch) {
    return { 
      tabs: [{ name: "預設工作表 (網址提取)", gid: urlGidMatch[1] }],
      diagnostic: lastDiagnostic 
    };
  }

  return { tabs: [], diagnostic: lastDiagnostic };
};

export const fetchSheetTabs = async (pubHtmlUrl: string): Promise<SheetTab[]> => {
  const result = await fetchSheetTabsWithDiagnostic(pubHtmlUrl);
  if (result.tabs.length > 0) return result.tabs;
  throw new Error("無法辨識分頁。請確認已發佈為「整份文件」，並檢查公司帳號權限。");
};

/**
 * 抓取班表 CSV 資料 (與訂位系統連線策略完全對齊)
 */
export const fetchRosterCsvWithProxy = async (csvUrl: string): Promise<string> => {
  // 1. 使用重寫邏輯確保 URL 格式正確
  const finalCsvUrl = convertToCsvUrl(csvUrl);
  let lastError = "";

  // 2. 針對 Workspace 環境，Direct Fetch 是唯一能攜帶 Cookie 的方式
  // 我們先嘗試 Direct Fetch，如果成功且不是登入牆，就直接回傳
  try {
    const response = await fetch(finalCsvUrl);
    if (response.ok) {
        const content = await response.text();
        const loginError = checkLoginWall(content);
        if (!loginError) return content;
        lastError = loginError;
    }
  } catch (err) {
    console.warn("[Roster] Direct fetch failed, trying proxies...", err);
  }

  // 3. 如果 Direct 失敗或抓到登入牆，才嘗試其他 Proxy (僅適用於真正的公開表單)
  for (const proxy of PROXIES) {
    if (proxy.name === 'Direct') continue; // 已經試過

    try {
      const targetUrl = proxy.url(finalCsvUrl);
      const response = await fetch(targetUrl);
      
      if (!response.ok) continue;

      let csv = '';
      if (proxy.name === 'AllOriginsJSON') {
        const data = await response.json();
        csv = data.contents;
      } else {
        csv = await response.text();
      }

      if (csv && csv.length > 20) {
        // 如果 Proxy 抓到 HTML (通常是 200 OK 但內容是登入頁)，代表 Proxy 無法穿透
        if (csv.trim().startsWith('<!DOCTYPE') || csv.trim().startsWith('<html')) {
          continue;
        }
        return csv;
      }
    } catch (err) {
      console.warn(`[Roster] ${proxy.name} CSV fetch attempt failed`);
    }
  }
  
  throw new Error(lastError || "無法讀取班表資料。這通常是公司帳號 (Workspace) 的權限限制，請確認試算表已「發佈到網路」。");
};

export const parseRosterCSV = (csv: string): RosterData => {
  if (!csv || csv.trim().startsWith('<!DOCTYPE')) {
    throw new Error("抓取的資料格式錯誤 (收到網頁內容而非 CSV)。");
  }

  const lines = csv.split(/\r?\n/).map(line => {
    let row: string[] = [];
    let inQuotes = false;
    let currentValue = '';
    for (let char of line) {
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) {
        row.push(currentValue.trim().replace(/^"|"$/g, ''));
        currentValue = '';
      } else currentValue += char;
    }
    row.push(currentValue.trim().replace(/^"|"$/g, ''));
    return row;
  });

  if (lines.length < 2) throw new Error("CSV 資料不足");

  let year = new Date().getFullYear().toString();
  let month = (new Date().getMonth() + 1).toString();

  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const text = lines[i].join('');
    const match = text.match(/(\d{4})[年/](\d{1,2})[月]?/);
    if (match) {
      year = match[1];
      month = match[2];
      break;
    }
  }

  let headerIdx = -1;
  let days: number[] = [];
  let startCol = -1;

  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const row = lines[i];
    const potentialDays = row.map(v => parseInt(v)).filter(n => n >= 1 && n <= 31);
    if (potentialDays.length >= 28) {
      headerIdx = i;
      days = potentialDays;
      startCol = row.findIndex(v => parseInt(v) === 1);
      break;
    }
  }

  if (headerIdx === -1) {
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const idx = lines[i].findIndex(v => v === '1' || v === '01');
      if (idx !== -1) {
        headerIdx = i;
        startCol = idx;
        days = lines[i].slice(startCol).map(v => parseInt(v)).filter(n => !isNaN(n) && n >= 1 && n <= 31);
        break;
      }
    }
  }

  if (headerIdx === -1 || startCol === -1) {
    throw new Error("無法辨識班表格式 (找不到日期標題列)");
  }

  const staffs: StaffRoster[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = lines[i];
    const shopName = row[0] || "";
    const staffName = row[1] || "";
    
    if (!staffName || staffName.length > 20 || staffName.includes('日期')) continue;

    const shifts: RosterShift[] = [];
    for (let j = 0; j < days.length; j++) {
      const shiftValue = row[startCol + j];
      if (shiftValue && shiftValue.trim()) {
        shifts.push({
          date: days[j],
          shift: shiftValue.trim().toUpperCase()
        });
      }
    }

    if (shifts.length > 0) {
      staffs.push({ shopName, staffName, shifts });
    }
  }

  return { year, month, days, staffs };
};
