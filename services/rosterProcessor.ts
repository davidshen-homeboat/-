
import { RosterData, StaffRoster, RosterShift, SheetTab } from "../types";

export const fetchSheetTabs = async (pubHtmlUrl: string): Promise<SheetTab[]> => {
  try {
    const response = await fetch(pubHtmlUrl);
    if (!response.ok) throw new Error("無法讀取 Google Sheets 頁面，請確認是否已發佈到網路。");
    const html = await response.text();
    
    const tabs: SheetTab[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Google Sheets pubhtml 底部選單通常在 id 為 sheet-menu 的 <ul> 中
    const menuItems = doc.querySelectorAll('#sheet-menu li a');
    
    if (menuItems.length > 0) {
      menuItems.forEach(item => {
        const name = item.textContent?.trim() || '';
        const href = item.getAttribute('href') || '';
        const gid = href.replace('#', '').replace('gid=', '');
        if (name && gid) tabs.push({ name, gid });
      });
    } else {
      // 備選方案：解析 javascript 中的腳本物件
      const gidMatches = html.matchAll(/"gid":"(\d+)","name":"([^"]+)"/g);
      for (const match of gidMatches) {
        tabs.push({ gid: match[1], name: match[2] });
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
