
import { RosterData, StaffRoster, RosterShift, SheetTab } from "../types";

/**
 * 解碼 Unicode 轉義字元 (如 \u6708 -> 月)
 * 支援多重轉義處理
 */
const decodeUnicode = (str: string): string => {
  let decoded = str;
  try {
    // 第一層解碼
    decoded = JSON.parse(`"${str.replace(/"/g, '\\"')}"`);
  } catch {
    decoded = str.replace(/\\u([a-fA-F0-9]{4})/g, (_, grp) => 
      String.fromCharCode(parseInt(grp, 16))
    );
  }
  // 處理可能的二次轉義 (\\u -> \u)
  if (decoded.includes('\\u')) {
    return decodeUnicode(decoded.replace(/\\\\u/g, '\\u'));
  }
  return decoded;
};

/**
 * 核心偵測邏輯：從 HTML 字串中提取分頁資訊
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

  // 2. 暴力 Regex 解析 (針對混淆或隱藏在腳本中的 JSON 資料)
  // 模式 A: 標準 GID 格式
  const gidPatterns = [
    /"gid"\s*:\s*"?(\d+)"?\s*,\s*"name"\s*:\s*"([^"]+)"/g,
    /"id"\s*:\s*"?(\d+)"?\s*,\s*"name"\s*:\s*"([^"]+)"/g,
    /\{"1":(\d+),"2":"([^"]+)"/g // Google 內部的壓縮格式備援
  ];

  gidPatterns.forEach(pattern => {
    const matches = Array.from(html.matchAll(pattern));
    matches.forEach(match => {
      const gid = match[1];
      const name = decodeUnicode(match[2]);
      if (gid && name && !tabs.find(t => t.gid === gid) && !name.includes('{')) {
        tabs.push({ name, gid });
      }
    });
  });

  return tabs;
};

export const fetchSheetTabs = async (pubHtmlUrl: string): Promise<SheetTab[]> => {
  let targetUrl = pubHtmlUrl.trim();
  if (targetUrl.includes('/edit')) {
    targetUrl = targetUrl.replace(/\/edit.*$/, '/pubhtml');
  }

  const proxies = [
    (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`
  ];

  let lastError = null;

  // 嘗試多個代理伺服器
  for (const getProxyUrl of proxies) {
    try {
      const proxyUrl = getProxyUrl(targetUrl);
      const response = await fetch(proxyUrl);
      if (!response.ok) continue;

      let html = '';
      if (proxyUrl.includes('allorigins')) {
        const data = await response.json();
        html = data.contents;
      } else {
        html = await response.text();
      }

      if (!html || html.length < 100) continue;

      const detectedTabs = parseTabsFromHtml(html);
      if (detectedTabs.length > 0) {
        return detectedTabs;
      }
    } catch (err) {
      lastError = err;
      console.warn("Proxy failed, trying next...", err);
    }
  }

  // 如果所有代理都失敗，但網址本身有 GID，則回傳單一分頁
  const urlGidMatch = targetUrl.match(/gid=([0-9]+)/);
  if (urlGidMatch) {
    return [{ name: "目前分頁", gid: urlGidMatch[1] }];
  }

  throw lastError || new Error("無法從連結中取得內容。請確認試算表已發佈，且連結正確。");
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

  // A1 (0,0) 是月份, C1 (0,2) 是年份
  const month = lines[0][0] || "未知";
  const year = lines[0][2] || "未知";

  // 第4列 (index 3) 從 E 欄 (index 4) 開始是日期
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
