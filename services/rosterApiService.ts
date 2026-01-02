
/**
 * homeboat 1.0 智能排班雲端 API 服務
 */
export const saveRosterToCloud = async (writeUrl: string, payload: {
  action: 'saveRoster';
  tabName: string;
  data: any[][];
}): Promise<boolean> => {
  if (!writeUrl) return false;
  
  try {
    // 再次確保 data 內的所有內容都是基本字串，防止 Google Sheets 拒絕寫入
    const safeData = payload.data.map(row => 
      row.map(cell => (cell === null || cell === undefined) ? "休" : String(cell))
    );

    const safePayload = {
      ...payload,
      data: safeData
    };

    const jsonBody = JSON.stringify(safePayload);
    
    // 使用 no-cors 模式確保能跨網域傳送到 Google Script 
    await fetch(writeUrl.trim(), {
      method: 'POST',
      mode: 'no-cors', 
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: jsonBody
    });
    
    // 因為 no-cors 無法取得 response body，但只要沒 catch 到 error 就視為成功
    return true;
  } catch (e) {
    console.error("homeboat 1.0 Cloud Sync Failed", e);
    return false;
  }
};
