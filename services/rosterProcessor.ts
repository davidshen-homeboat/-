
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

  // 2. 深度解析 bootstrapData (Google Sheets 存放元數據的主要腳本變數)
  // 尋找像是 _W_bootstrapData = {...}; 的區塊
  const bootstrapMatch = html.match(/_W_bootstrapData\s*=\s*({.+?});/s);
  if (bootstrapMatch) {
    try {
      const bootstrapJson = JSON.parse(bootstrapMatch[1]);
      // 通常在 bootstrapJson.changes.sheets 或類似路徑下
      // 這裡採用遍歷 JSON 的方式搜尋所有 gid/name 對
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
      console.debug("BootstrapData parse failed, falling back to regex.");
    }
  }

  // 3. 強化版 Regex 解析 (多種變體模式)
  const gidPatterns = [
    /"gid"\s*:\s*"?(\d+)"?\s*,\s*"name"\s*:\s*"([^"]+)"/g,
    /"id"\s*:\s*"?(\d+)"?\s*,\s*"name"\s*:\s*"([^"]+)"/g,
    /\{"1":(\d+),"2":"([^"]+)"/g,
    /\[(\d+),"([^"]+)",\d+\]/g // 數組形式的備援
  ];

  gidPatterns.forEach(pattern => {
    const matches = Array.from(html.matchAll(pattern));
    matches.forEach(match => {
      const gid = match[1];
      const name = decodeUnicode(match[2]);
      // 過濾掉明顯不是分頁名稱的垃圾字串
      if (gid && name && name.length < 50 && !tabs.find(t => t.gid === gid) && !name.includes('{') && !name.includes(':')) {
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

      // 預處理 HTML：移除極端空白以優化正則匹配
      const cleanHtml = html.replace(/\s{2,}/g, ' ');

      const detectedTabs = parseTabsFromHtml(cleanHtml);
      if (detectedTabs.length > 0) {
        // 排序：盡量讓含有月份名稱的排前面
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
      console.warn("Proxy failed, trying next...", err);
    }
  }

  const urlGidMatch = targetUrl.match(/gid=([0-9]+)/);
  if (urlGidMatch) {
    return [{ name: "目前分頁", gid: urlGidMatch[1] }];
  }

  throw lastError || new Error("無法偵測分頁。請確認試算表已發佈「全份文件」，而非僅單一工作表。");
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
