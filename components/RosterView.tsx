
import React, { useState, useEffect } from 'react';
import { CalendarDays, RefreshCw, Loader2, Database, AlertCircle, Store, Globe, Link as LinkIcon, ChevronRight } from 'lucide-react';
import { RosterData, SheetTab } from '../types';
import { fetchCsvStreaming } from '../services/dataProcessor';
import { parseRosterCSV, fetchSheetTabs } from '../services/rosterProcessor';

const STORAGE_KEY_ROSTER_MASTER = 'bakery_roster_master_url';
const STORAGE_KEY_ROSTER_TABS = 'bakery_roster_tabs_cache';

const RosterView: React.FC = () => {
  const [masterUrl, setMasterUrl] = useState<string>(() => localStorage.getItem(STORAGE_KEY_ROSTER_MASTER) || '');
  const [tabs, setTabs] = useState<SheetTab[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ROSTER_TABS);
    return saved ? JSON.parse(saved) : [];
  });
  
  const [activeGid, setActiveGid] = useState<string>('');
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [detectingTabs, setDetectingTabs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 當主網址變動時存入 localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ROSTER_MASTER, masterUrl);
  }, [masterUrl]);

  // 當分頁列表變動時存入快取
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ROSTER_TABS, JSON.stringify(tabs));
    if (!activeGid && tabs.length > 0) {
      setActiveGid(tabs[0].gid);
    }
  }, [tabs]);

  const handleSyncTabs = async () => {
    if (!masterUrl) return alert("請先輸入 Google Sheets 發佈連結");
    setDetectingTabs(true);
    setError(null);
    try {
      const detectedTabs = await fetchSheetTabs(masterUrl);
      setTabs(detectedTabs);
      if (detectedTabs.length > 0) setActiveGid(detectedTabs[0].gid);
    } catch (err: any) {
      setError("偵測工作表失敗。請確認連結是否正確，且已設定為「發佈到網路 (全份文件)」。");
    } finally {
      setDetectingTabs(false);
    }
  };

  const fetchRosterData = async (gid: string) => {
    if (!masterUrl || !gid) return;
    setLoading(true);
    setError(null);
    try {
      // 從 pubhtml 連結中提取檔案 ID
      const sheetIdMatch = masterUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!sheetIdMatch) throw new Error("無效的 Google Sheets 網址結構");
      
      const sheetId = sheetIdMatch[1];
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      
      const csv = await fetchCsvStreaming(csvUrl, () => {});
      const data = parseRosterCSV(csv);
      setRoster(data);
    } catch (err: any) {
      setError(err.message || "讀取班表數據失敗");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeGid) fetchRosterData(activeGid);
  }, [activeGid]);

  const getShiftColor = (shift: string) => {
    switch (shift.toUpperCase()) {
      case 'A': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'B': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'C': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'H': return 'bg-rose-100 text-rose-800 border-rose-200';
      default: return 'bg-slate-50 text-slate-400 border-slate-100';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Settings */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">班表中心</h1>
          <p className="text-slate-500 font-bold text-sm">一鍵連結所有月份班表</p>
        </div>
        
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <LinkIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              value={masterUrl}
              onChange={(e) => setMasterUrl(e.target.value)}
              placeholder="貼上發佈連結 (pubhtml)"
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <button 
            onClick={handleSyncTabs}
            disabled={detectingTabs}
            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black shadow-lg hover:bg-black transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {detectingTabs ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            偵測月份
          </button>
        </div>
      </div>

      {/* Tab Switcher */}
      {tabs.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.gid}
              onClick={() => setActiveGid(tab.gid)}
              className={`px-5 py-2.5 rounded-xl text-xs font-black whitespace-nowrap border transition-all flex items-center gap-2 ${
                activeGid === tab.gid 
                ? 'bg-orange-600 text-white border-orange-700 shadow-md scale-105' 
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              {tab.name}
            </button>
          ))}
        </div>
      )}

      {/* Main View */}
      {loading ? (
        <div className="bg-white rounded-[32px] p-24 flex flex-col items-center justify-center border border-slate-200 shadow-sm animate-pulse">
          <Loader2 className="w-12 h-12 text-orange-500 animate-spin mb-4" />
          <p className="font-black text-slate-800">正在從 Google Sheets 載入...</p>
        </div>
      ) : error ? (
        <div className="bg-rose-50 border border-rose-200 rounded-[32px] p-12 flex flex-col items-center text-center">
          <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
          <h3 className="font-black text-rose-800 text-xl mb-2">無法顯示班表</h3>
          <p className="text-rose-600 font-bold max-w-md mb-6">{error}</p>
          <div className="bg-white p-6 rounded-2xl border border-rose-100 text-left text-xs font-medium text-rose-800 space-y-2 max-w-lg shadow-sm">
            <p className="font-black flex items-center gap-2 text-rose-900"><Globe className="w-4 h-4" /> 設定檢查清單：</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>確保試算表已設為「檔案 > 共用 > <b>發佈到網路</b>」</li>
              <li>發佈範圍必須選擇「<b>全份文件</b>」</li>
              <li>發佈格式建議選擇「<b>網頁</b>」</li>
              <li>複製視窗中產生的 `pubhtml` 連結並貼在上方</li>
            </ul>
          </div>
        </div>
      ) : roster ? (
        <div className="space-y-4 animate-in fade-in duration-500">
          <div className="bg-slate-900 text-white p-7 rounded-[32px] flex items-center justify-between shadow-2xl relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform"><CalendarDays className="w-32 h-32" /></div>
             <div className="flex items-center gap-5 relative z-10">
                <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center shadow-inner"><CalendarDays className="text-orange-400 w-7 h-7" /></div>
                <div>
                   <h2 className="text-3xl font-black">{roster.year} 年 {roster.month}</h2>
                   <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">BakeryOS Schedule Dashboard</p>
                </div>
             </div>
             <div className="hidden lg:flex gap-6 relative z-10 bg-black/20 p-4 rounded-2xl backdrop-blur-sm">
                <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-900"></div><span className="text-[11px] font-black tracking-widest uppercase">早班 A</span></div>
                <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded-full bg-amber-400 shadow-sm shadow-amber-900"></div><span className="text-[11px] font-black tracking-widest uppercase">午班 B</span></div>
                <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded-full bg-indigo-400 shadow-sm shadow-indigo-900"></div><span className="text-[11px] font-black tracking-widest uppercase">晚班 C</span></div>
                <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded-full bg-rose-400 shadow-sm shadow-rose-900"></div><span className="text-[11px] font-black tracking-widest uppercase">休假 H</span></div>
             </div>
          </div>

          <div className="bg-white rounded-[40px] border border-slate-200 shadow-xl overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="sticky left-0 z-20 bg-slate-50 p-6 text-left text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-r border-slate-200 min-w-[150px] shadow-[4px_0_8px_rgba(0,0,0,0.02)]">單位與員工</th>
                    {roster.days.map(d => (
                      <th key={d} className="p-4 text-center text-xs font-black text-slate-800 border-r border-slate-100 min-w-[50px] bg-slate-50/50">
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {roster.staffs.map((staff, idx) => (
                    <tr key={`${staff.staffName}-${idx}`} className="hover:bg-slate-50 transition-colors group">
                      <td className="sticky left-0 z-10 bg-white p-5 border-r border-slate-200 shadow-[4px_0_10px_rgba(0,0,0,0.01)] group-hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black text-orange-600 flex items-center gap-1.5 uppercase tracking-wider"><Store className="w-3 h-3" /> {staff.shopName}</span>
                          <span className="text-base font-black text-slate-800 mt-1">{staff.staffName}</span>
                        </div>
                      </td>
                      {roster.days.map(d => {
                        const shiftInfo = staff.shifts.find(s => s.date === d);
                        return (
                          <td key={d} className="p-1.5 border-r border-slate-50 text-center">
                            {shiftInfo ? (
                              <div className={`w-10 h-10 mx-auto rounded-2xl flex items-center justify-center font-black text-sm border shadow-sm transition-all group-hover:scale-110 ${getShiftColor(shiftInfo.shift)}`}>
                                {shiftInfo.shift}
                              </div>
                            ) : (
                              <div className="w-10 h-10 mx-auto rounded-2xl bg-slate-50/30"></div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-[40px] p-24 flex flex-col items-center justify-center border border-slate-200 shadow-sm text-center animate-in fade-in zoom-in duration-500">
           <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mb-6 shadow-inner"><Database className="w-12 h-12 text-slate-300" /></div>
           <h3 className="text-2xl font-black text-slate-800">尚未連結數據庫</h3>
           <p className="text-slate-400 font-bold mt-3 max-w-sm mx-auto leading-relaxed">請在上方輸入您 Google Sheets 的「發佈到網路」連結，我們將自動為您整理所有月份的排班資料。</p>
           <div className="mt-10 p-5 bg-indigo-50 rounded-3xl border border-indigo-100 text-indigo-700 text-xs font-black flex items-center gap-3">
              <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-lg">教學</span>
              <span>點擊 Google 試算表 > 檔案 > 共用 > 發佈到網路 (全份文件)</span>
           </div>
        </div>
      )}
    </div>
  );
};

export default RosterView;
