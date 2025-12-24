
import { RosterData, StaffRoster, RosterShift, SheetTab } from "../types";

/**
 * 解碼 Unicode 轉義字元 (如 \u6708 -> 月)
 */
const decodeUnicode = (str: string): string => {
  try {
    // 嘗試使用 JSON.parse 處理標準轉義字串
    return JSON.parse(`"${str}"`);
  } catch {
    // 備援：手動正則替換
    return str.replace(/\\u([a-fA-F0-9]{4})/g, (_, grp) => 
      String.fromCharCode(parseInt(grp, 16))
    );
  }
};

export const fetchSheetTabs = async (pubHtmlUrl: string): Promise<SheetTab[]> => {
  try {
    // 網址正規化：如果使用者貼入 /edit 網址，自動轉為 /pubhtml
    let targetUrl = pubHtmlUrl.trim();
    if (targetUrl.includes('/edit')) {
      targetUrl = targetUrl.replace(/\/edit.*$/, '/pubhtml');
    }
    
    // 使用 AllOrigins 代理來繞過 CORS 限制
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
    const response = await fetch(proxyUrl);
    
    if (!response.ok) throw new Error("無法連接到代理伺服器。");
    
    const data = await response.json();
    const html = data.contents;
    
    if (!html) throw new Error("無法從連結中取得內容，請確認試算表是否已正確發佈。");

    const tabs: SheetTab[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // 方案一：從 Google Sheets pubhtml 底部選單解析 (HTML 結構)
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
    
    // 方案二：從 HTML 原始碼中的 JSON 變數解析 (處理 Unicode 編碼的分頁名)
    // 強化 Regex 支援處理 gid 有無引號的情況：{"gid":"0","name":"1\u6708"} 或 {"gid":0,"name":"Sheet1"}
    const gidMatches = Array.from(html.matchAll(/"gid"\s*:\s*"?(\d+)"?\s*,\s*"name"\s*:\s*"([^"]+)"/g)) as any[];
    for (const match of gidMatches) {
      const gid = match[1];
      const rawName = match[2];
      const name = decodeUnicode(rawName);
      
      if (gid && name && !tabs.find(t => t.gid === gid)) {
        tabs.push({ name, gid });
      }
    }

    // 方案三：單一分頁備援 (如果網址帶有特定 GID)
    if (tabs.length === 0) {
      const urlGidMatch = targetUrl.match(/gid=([0-9]+)/);
      if (urlGidMatch) {
        tabs.push({ name: "預設分頁", gid: urlGidMatch[1] });
      }
    }
    
    return tabs;
  } catch (error) {
    console.error("Fetch Tabs Error:", error);
    throw error;
  }
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
    else break; // 碰到非數字停止
  }

  // 第6列 (index 5) 開始是員工資料
  const staffs: StaffRoster[] = [];
  for (let i = 5; i < lines.length; i++) {
    const row = lines[i];
    if (!row[1]) continue; // 沒有員工名字就跳過

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
