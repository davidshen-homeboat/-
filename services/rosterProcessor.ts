
import { RosterData, StaffRoster, RosterShift, SheetTab } from "../types";

/**
 * 解碼 Unicode 轉義字元 (如 \u6708 -> 月)
 * 支援多重轉義處理
 */
const decodeUnicode = (str: string): string => {
  let decoded = str;
  try {
    // 處理 JSON 格式的轉義
    decoded = JSON.parse(`"${str.replace(/"/g, '\\"')}"`);
  } catch {
    // 暴力正則替換
    decoded = str.replace(/\\u([a-fA-F0-9]{4})/g, (_, grp) => 
      String.fromCharCode(parseInt(grp, 16))
    );
  }
  // 處理二次轉義 (\\u -> \u)
  if (decoded.includes('\\u')) {
    return decodeUnicode(decoded.replace(/\\\\u/g, '\\u'));
  }
  return decoded;
};

/**
 * 具備逾時功能的 fetch 封裝
 */
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 6000): Promise<Response> => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
};

/**
 * 從 HTML 字串中提取分頁資訊
 */
const parseTabsFromHtml = (html: string): SheetTab[] => {
  const tabs: SheetTab[] = [];
  
  // 1. 標準 HTML 結構解析 (pubhtml 底部選單)
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const menuItems = doc.querySelectorAll('#sheet-menu li a');
  if (menuItems.length > 0) {
    menuItems.forEach(item => {
      const name = item.textContent?.trim() || '';
      const href = item.getAttribute('href') || '';
      const gidMatch = href.match(/gid=([0-9]+)/);
      const gid = gidMatch ? gidMatch[1] : href.replace('#', '');
      if (name && gid && !tabs.find(t => t.gid === gid)) {
        tabs.push({ name, gid });
      }
    });
  }

  // 2. 深度解析 bootstrapData
  const bootstrapMatch = html.match(/_W_bootstrapData\s*=\s*({.+?});/s);
  if (bootstrapMatch) {
    try {
      const bootstrapJson = JSON.parse(bootstrapMatch[1]);
      const searchJson = (obj: any) => {
        if (!obj || typeof obj !== 'object') return;
        if (obj.gid !== undefined && obj.name !== undefined) {
          const gid = String(obj.gid);
          const name = decodeUnicode(String(obj.name));
          if (gid && name && !tabs.find(t => t.gid === gid) && !name.includes('{')) {
            tabs.push({ name, gid });
          }
        }
        Object.values(obj).forEach(searchJson);
      };
      searchJson(bootstrapJson);
    } catch (e) {
      console.debug("BootstrapData parse failed.");
    }
  }

  // 3. 強化版 Regex 解析
  const gidPatterns = [
    /"gid"\s*:\s*"?(\d+)"?\s*,\s*"name"\s*:\s*"([^"]+)"/g,
    /"id"\s*:\s*"?(\d+)"?\s*,\s*"name"\s*:\s*"([^"]+)"/g,
    /\{"1":(\d+),"2":"([^"]+)"/g,
    /\[(\d+),"([^"]+)",\d+\]/g
  ];

  gidPatterns.forEach(pattern => {
    const matches = Array.from(html.matchAll(pattern));
    matches.forEach(match => {
      const gid = match[1];
      const name = decodeUnicode(match[2]);
      if (gid && name && name.length < 50 && !tabs.find(t => t.gid === gid) && !name.includes('{') && !name.includes(':')) {
        tabs.push({ name, gid });
      }
    });
  });

  return tabs;
};

export const fetchSheetTabs = async (pubHtmlUrl: string): Promise<SheetTab[]> => {
  let cleanUrl = pubHtmlUrl.trim().split('#')[0]; // 移除 GID 片段以免干擾代理
  if (cleanUrl.includes('/edit')) {
    cleanUrl = cleanUrl.replace(/\/edit.*$/, '/pubhtml');
  }

  const proxies = [
    { name: 'Codetabs', url: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}` },
    { name: 'AllOrigins', url: (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}` },
    { name: 'CorsProxyIO', url: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}` },
    { name: 'ThingProxy', url: (url: string) => `https://thingproxy.freeboard.io/fetch/${url}` }
  ];

  let lastError = null;

  for (const proxy of proxies) {
    try {
      console.log(`Trying proxy: ${proxy.name}...`);
      const targetProxyUrl = proxy.url(cleanUrl);
      const response = await fetchWithTimeout(targetProxyUrl);
      
      if (!response.ok) {
        console.warn(`Proxy ${proxy.name} returned status ${response.status}`);
        continue;
      }

      let html = '';
      if (proxy.name === 'AllOrigins') {
        const data = await response.json();
        html = data.contents;
      } else {
        html = await response.text();
      }

      if (!html || html.length < 200) continue;

      const cleanHtml = html.replace(/\s{2,}/g, ' ');
      const detectedTabs = parseTabsFromHtml(cleanHtml);
      
      if (detectedTabs.length > 0) {
        console.log(`Successfully detected ${detectedTabs.length} tabs via ${proxy.name}`);
        return detectedTabs.sort((a, b) => {
          const aHasMonth = /月/.test(a.name);
          const bHasMonth = /月/.test(b.name);
          if (aHasMonth && !bHasMonth) return -1;
          if (!aHasMonth && bHasMonth) return 1;
          return 0;
        });
      }
    } catch (err) {
      lastError = err;
      console.warn(`Proxy ${proxy.name} failed:`, err);
    }
  }

  // 最後嘗試：若網址本身帶有 GID，至少回傳該分頁
  const urlGidMatch = pubHtmlUrl.match(/gid=([0-9]+)/);
  if (urlGidMatch) {
    return [{ name: "預設分頁 (從網址提取)", gid: urlGidMatch[1] }];
  }

  throw new Error("偵測工作表失敗。可能是所有代理伺服器暫時無法連線，建議您使用「手動新增分頁」輸入 GID。");
};

export const parseRosterCSV = (csvText: string): RosterData => {
  const lines = csvText.split(/\r?\n/).map(line => {
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
    return row;
  });

  if (lines.length < 6) throw new Error("班表格式不正確 (行數不足)");

  const month = lines[0][0] || "未知";
  const year = lines[0][2] || "未知";

  const dateRow = lines[3];
  const days: number[] = [];
  for (let i = 4; i < dateRow.length; i++) {
    const d = parseInt(dateRow[i]);
    if (!isNaN(d)) days.push(d);
    else break; 
  }

  const staffs: StaffRoster[] = [];
  for (let i = 5; i < lines.length; i++) {
    const row = lines[i];
    if (!row[1]) continue; 

    const shopName = row[0];
    const staffName = row[1];
    const shifts: RosterShift[] = [];

    for (let j = 0; j < days.length; j++) {
      const shiftValue = row[4 + j] || "";
      if (shiftValue) {
        shifts.push({
          date: days[j],
          shift: shiftValue
        });
      }
    }
    staffs.push({ shopName, staffName, shifts });
  }

  return { year, month, days, staffs };
};
