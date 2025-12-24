
import { CalendarDays, RefreshCw, Loader2, Database, AlertCircle, Store, Globe, Link as LinkIcon, ChevronRight, Plus, Trash2, HelpCircle, Info, ExternalLink, MousePointer2, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { RosterData, SheetTab } from '../types';
import { parseRosterCSV, fetchSheetTabsWithDiagnostic, fetchRosterCsvWithProxy, FetchDiagnostic } from '../services/rosterProcessor';

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
  const [diagnostic, setDiagnostic] = useState<FetchDiagnostic | undefined>(undefined);
  const [showDiagnostic, setShowDiagnostic] = useState(false);

  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualGid, setManualGid] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ROSTER_MASTER, masterUrl);
  }, [masterUrl]);

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
    setDiagnostic(undefined);
    setShowDiagnostic(false);
    
    try {
      const { tabs: detectedTabs, diagnostic: diag } = await fetchSheetTabsWithDiagnostic(masterUrl);
      setDiagnostic(diag);
      
      if (detectedTabs.length === 0) {
        throw new Error("偵測不到任何分頁，這通常代表 Google Workspace 權限限制或尚未發佈為「整份文件」。");
      }
      
      setTabs(detectedTabs);
      if (detectedTabs.length > 0) setActiveGid(detectedTabs[0].gid);
    } catch (err: any) {
      setError(err.message || "偵測工作表失敗。");
    } finally {
      setDetectingTabs(false);
    }
  };

  const handleAddManualTab = () => {
    if (!manualName || !manualGid) return alert("請輸入名稱與 GID");
    const cleanGid = manualGid.includes('=') ? manualGid.split('=')[1] : manualGid;
    const newTab = { name: manualName, gid: cleanGid.trim() };
    setTabs(prev => [...prev, newTab]);
    setManualName('');
    setManualGid('');
    setShowManualAdd(false);
  };

  const removeTab = (gid: string) => {
    setTabs(prev => prev.filter(t => t.gid !== gid));
    if (activeGid === gid) setActiveGid(tabs.find(t => t.gid !== gid)?.gid || '');
  };

  const fetchRosterData = async (gid: string) => {
    if (!masterUrl || !gid) return;
    setLoading(true);
    setError(null);
    try {
      const sheetIdMatch = masterUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!sheetIdMatch) throw new Error("無效的 Google Sheets 網址結構");
      
      const sheetId = sheetIdMatch[1];
      const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
      
      const csv = await fetchRosterCsvWithProxy(csvUrl);
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
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-orange-500 shadow-sm"
            />
          </div>
          <button 
            onClick={handleSyncTabs}
            disabled={detectingTabs}
            className="px-6 py-2 bg-slate-900 text-white rounded-xl text-xs font-black shadow-lg hover:bg-black transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {detectingTabs ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            偵測月份
          </button>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
        {tabs.map((tab) => (
          <div key={tab.gid} className="relative group">
            <button
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
            <button 
              onClick={() => removeTab(tab.gid)}
              className="absolute -top-1 -right-1 bg-slate-800 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-sm z-10"
            >
              <Trash2 className="w-2 h-2" />
            </button>
          </div>
        ))}
        <button 
          onClick={() => setShowManualAdd(!showManualAdd)}
          className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 border border-dashed ${showManualAdd ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-300 hover:bg-slate-50'}`}
        >
          <Plus className="w-3.5 h-3.5" />
          手動新增分頁
        </button>
      </div>

      {/* Manual Add Form with Tooltip */}
      {showManualAdd && (
        <div className="bg-white p-6 rounded-[32px] border border-slate-200 shadow-xl animate-in slide-in-from-top-2 duration-300 space-y-4">
          <div className="flex items-center gap-3 text-orange-600 mb-2">
            <Info className="w-5 h-5" />
            <h4 className="font-black text-sm uppercase tracking-wider">如何獲取 GID？</h4>
          </div>
          <p className="text-xs text-slate-500 font-bold leading-relaxed">
            請打開您的試算表，點選該月份的分頁標籤。查看網址列末端 <code>gid=數字</code>，該數字即為 GID。
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1 flex-1 min-w-[120px]">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">分頁名稱 (如: 4月)</label>
              <input 
                type="text" 
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="名稱"
                className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-xs font-bold focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <div className="space-y-1 flex-1 min-w-[120px]">
              <label className="text-[10px] font-black text-slate-400 uppercase ml-1">GID 數字</label>
              <input 
                type="text" 
                value={manualGid}
                onChange={(e) => setManualGid(e.target.value)}
                placeholder="例如: 123456"
                className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-xs font-bold focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <button 
              onClick={handleAddManualTab}
              className="px-8 py-3 bg-orange-600 text-white rounded-2xl text-xs font-black shadow-lg hover:bg-orange-700 transition-all h-[44px]"
            >
              確認新增
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="bg-white rounded-[40px] p-24 flex flex-col items-center justify-center border border-slate-200 shadow-sm animate-pulse">
          <Loader2 className="w-12 h-12 text-orange-500 animate-spin mb-4" />
          <p className="font-black text-slate-800">正在同步雲端資料庫...</p>
        </div>
      ) : error ? (
        <div className="space-y-6">
          <div className="bg-rose-50 border border-rose-200 rounded-[32px] p-10 flex flex-col items-center text-center">
            <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
            <h3 className="font-black text-rose-800 text-xl mb-2">連線或解析失敗</h3>
            <p className="text-rose-600 font-bold max-w-md mb-6">{error}</p>
            
            <div className="bg-white w-full max-w-2xl p-8 rounded-[32px] border border-rose-100 text-left shadow-sm space-y-6">
              <div className="flex items-center gap-3 text-rose-900 border-b pb-4 border-rose-50">
                <MousePointer2 className="w-5 h-5" />
                <span className="font-black text-sm uppercase tracking-widest">排錯建議</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <div className="w-8 h-8 bg-rose-600 text-white rounded-lg flex items-center justify-center font-black text-xs">01</div>
                  <p className="text-xs font-black text-slate-800">請確認試算表已設定為「發佈到網路 (整份文件)」。</p>
                </div>
                <div className="space-y-3">
                  <div className="w-8 h-8 bg-rose-600 text-white rounded-lg flex items-center justify-center font-black text-xs">02</div>
                  <p className="text-xs font-black text-slate-800">
                    公司帳號常因內部限制導致抓取失敗，請聯絡 IT 或嘗試手動輸入 GID。
                  </p>
                </div>
              </div>

              {/* Diagnostic Toggle */}
              {diagnostic && (
                <div className="mt-4 border-t border-rose-50 pt-4">
                  <button 
                    onClick={() => setShowDiagnostic(!showDiagnostic)}
                    className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest"
                  >
                    <Terminal className="w-3 h-3" />
                    {showDiagnostic ? '隱藏診斷資訊' : '查看技術診斷資訊'}
                    {showDiagnostic ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  
                  {showDiagnostic && (
                    <div className="mt-3 p-4 bg-slate-900 rounded-2xl font-mono text-[10px] text-emerald-400 overflow-hidden shadow-inner">
                      <div className="mb-2 text-slate-400 border-b border-slate-700 pb-1">Fetch Metadata:</div>
                      <div>Status: {diagnostic.status} ({diagnostic.statusText})</div>
                      <div>Proxy: {diagnostic.proxyName}</div>
                      <div className="mt-2 text-slate-400 border-b border-slate-700 pb-1">Response Head:</div>
                      <div className="break-all whitespace-pre-wrap opacity-80">{diagnostic.contentSnippet}...</div>
                      {diagnostic.isLoginWall && (
                        <div className="mt-2 p-2 bg-rose-900/50 text-rose-300 rounded-lg border border-rose-700">
                          ⚠️ 系統判定此為「Google 登錄牆」，程式無法穿透身份驗證。
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              
              <div className="pt-4">
                 <button 
                  onClick={() => { setShowManualAdd(true); setError(null); }}
                  className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-sm shadow-xl hover:bg-rose-700 transition-all flex items-center justify-center gap-2"
                 >
                   <Plus className="w-4 h-4" /> 嘗試手動輸入 GID
                 </button>
              </div>
            </div>
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
                <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-900"></div><span className="text-[11px] font-black tracking-widest uppercase">早 A</span></div>
                <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded-full bg-amber-400 shadow-sm shadow-amber-900"></div><span className="text-[11px] font-black tracking-widest uppercase">午 B</span></div>
                <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded-full bg-indigo-400 shadow-sm shadow-indigo-900"></div><span className="text-[11px] font-black tracking-widest uppercase">晚 C</span></div>
                <div className="flex items-center gap-2"><div className="w-3.5 h-3.5 rounded-full bg-rose-400 shadow-sm shadow-rose-900"></div><span className="text-[11px] font-black tracking-widest uppercase">休 H</span></div>
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
           <h3 className="text-2xl font-black text-slate-800">班表數據庫未連結</h3>
           <p className="text-slate-400 font-bold mt-3 max-w-sm mx-auto leading-relaxed">請在上方輸入您 Google Sheets 的「發佈到網路」連結。若自動偵測失敗，可使用「手動新增」輸入分頁 GID。</p>
           <div className="mt-10 p-5 bg-indigo-50 rounded-3xl border border-indigo-100 text-indigo-700 text-xs font-black flex items-center gap-3">
              <span className="bg-indigo-600 text-white px-2 py-0.5 rounded-lg">提醒</span>
              <span>必須將試算表設定為「發佈到網路 (全份文件)」</span>
           </div>
        </div>
      )}
    </div>
  );
};

export default RosterView;
