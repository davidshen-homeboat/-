
import { CalendarDays, RefreshCw, Loader2, Database, AlertCircle, Store, Globe, Link as LinkIcon, ChevronRight, Plus, Trash2, HelpCircle, Info, ExternalLink, MousePointer2, ChevronDown, ChevronUp, Terminal, ShieldCheck } from 'lucide-react';
import React, { useState, useEffect } from 'react';
import { RosterData, SheetTab } from '../types';
import { parseRosterCSV, fetchSheetTabsWithDiagnostic, fetchRosterCsvWithProxy, FetchDiagnostic } from '../services/rosterProcessor';

const STORAGE_KEY_ROSTER_MASTER = 'bakery_roster_master_url';
const STORAGE_KEY_ROSTER_TABS = 'bakery_roster_tabs_cache';
const STORAGE_KEY_ROSTER_MAP = 'bakery_roster_map_v1';

const RosterView: React.FC = () => {
  const [masterUrl, setMasterUrl] = useState<string>(() => localStorage.getItem(STORAGE_KEY_ROSTER_MASTER) || '');
  const [tabs, setTabs] = useState<SheetTab[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ROSTER_TABS);
    return saved ? JSON.parse(saved) : [];
  });
  
  const [activeGid, setActiveGid] = useState<string>('');
  const [rosterMap, setRosterMap] = useState<Record<string, RosterData>>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ROSTER_MAP);
    return saved ? JSON.parse(saved) : {};
  });
  
  const [activeRoster, setActiveRoster] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [detectingTabs, setDetectingTabs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualGid, setManualGid] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ROSTER_MASTER, masterUrl);
  }, [masterUrl]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ROSTER_TABS, JSON.stringify(tabs));
    if (!activeGid && tabs.length > 0) setActiveGid(tabs[0].gid);
  }, [tabs]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_ROSTER_MAP, JSON.stringify(rosterMap));
  }, [rosterMap]);

  const handleSyncTabs = async () => {
    if (!masterUrl) return alert("請先輸入網址");
    setDetectingTabs(true);
    setError(null);
    try {
      const { tabs: detectedTabs } = await fetchSheetTabsWithDiagnostic(masterUrl);
      if (detectedTabs.length === 0) throw new Error("無法自動偵測分頁。");
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
    setTabs(prev => [...prev, { name: manualName, gid: cleanGid.trim() }]);
    setManualName(''); setManualGid(''); setShowManualAdd(false);
  };

  const removeTab = (gid: string) => {
    setTabs(prev => prev.filter(t => t.gid !== gid));
    if (activeGid === gid) {
      const remaining = tabs.filter(t => t.gid !== gid);
      setActiveGid(remaining.length > 0 ? remaining[0].gid : '');
    }
  };

  const fetchRosterData = async (gid: string) => {
    if (!masterUrl || !gid) return;
    const currentTab = tabs.find(t => t.gid === gid);
    setLoading(true);
    setError(null);
    try {
      const csv = await fetchRosterCsvWithProxy(masterUrl, gid);
      const data = parseRosterCSV(csv, currentTab?.name);
      setActiveRoster(data);
      setRosterMap(prev => ({ ...prev, [`${data.year}-${data.month}`]: data }));
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
    const s = shift.toUpperCase();
    switch (s) {
      case 'A': return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'B': return 'bg-sky-100 text-sky-800 border-sky-200';
      case 'C': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case '休': 
      case 'OFF':
      case 'X':
        return 'bg-red-600 text-white border-red-700';
      default: return 'bg-white border-slate-100';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">班表中心</h1>
          <p className="text-slate-500 font-bold text-sm">各分頁根據內容自動辨識年月</p>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <input type="text" value={masterUrl} onChange={(e) => setMasterUrl(e.target.value)} placeholder="試算表連結 (/exec)" className="flex-1 md:w-96 px-4 py-2 bg-white border rounded-xl text-xs font-bold focus:ring-2 focus:ring-orange-500" />
          <button onClick={handleSyncTabs} disabled={detectingTabs} className="px-6 py-2 bg-slate-900 text-white rounded-xl text-xs font-black flex items-center gap-2 disabled:opacity-50">
            {detectingTabs ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}偵測
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
        {tabs.map((tab) => (
          <div key={tab.gid} className="relative group">
            <button onClick={() => setActiveGid(tab.gid)} className={`px-5 py-2.5 rounded-xl text-xs font-black whitespace-nowrap border transition-all flex items-center gap-2 ${activeGid === tab.gid ? 'bg-orange-600 text-white border-orange-700 shadow-md scale-105' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
              <CalendarDays className="w-3.5 h-3.5" />{tab.name}
            </button>
            <button onClick={() => removeTab(tab.gid)} className="absolute -top-1 -right-1 bg-slate-800 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"><Trash2 className="w-2 h-2" /></button>
          </div>
        ))}
        <button onClick={() => setShowManualAdd(!showManualAdd)} className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 border border-dashed ${showManualAdd ? 'bg-slate-800 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-300'}`}><Plus className="w-3.5 h-3.5" />手動</button>
      </div>

      {showManualAdd && (
        <div className="bg-white p-6 rounded-[32px] border shadow-xl space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[120px]"><label className="text-[10px] font-black text-slate-400 ml-1">名稱</label><input type="text" value={manualName} onChange={(e)=>setManualName(e.target.value)} className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-xs font-bold border-none" /></div>
            <div className="flex-1 min-w-[120px]"><label className="text-[10px] font-black text-slate-400 ml-1">GID</label><input type="text" value={manualGid} onChange={(e)=>setManualGid(e.target.value)} className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-xs font-bold border-none" /></div>
            <button onClick={handleAddManualTab} className="px-8 py-3 bg-orange-600 text-white rounded-2xl text-xs font-black h-[44px]">確認</button>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-600 flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-bold">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-[40px] p-24 flex flex-col items-center justify-center border animate-pulse"><Loader2 className="w-12 h-12 text-orange-500 animate-spin mb-4" /><p className="font-black text-slate-800">偵測與校準中...</p></div>
      ) : activeRoster ? (
        <div className="space-y-4 animate-in fade-in duration-500">
          <div className="bg-slate-900 text-white p-7 rounded-[32px] flex items-center justify-between shadow-2xl relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform"><CalendarDays className="w-32 h-32" /></div>
             <div className="flex items-center gap-5 relative z-10">
                <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center shadow-inner"><CalendarDays className="text-orange-400 w-7 h-7" /></div>
                <div><h2 className="text-3xl font-black">{activeRoster.year} 年 {activeRoster.month} 月</h2><p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">已自動偵測分頁內容並儲存於快取</p></div>
             </div>
          </div>
          <div className="bg-white rounded-[40px] border shadow-xl overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    <th className="sticky left-0 z-20 bg-slate-50 p-6 text-left text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-r min-w-[150px]">單位與員工</th>
                    {activeRoster.days.map(d => <th key={d} className="p-4 text-center text-xs font-black text-slate-800 border-r min-w-[50px]">{d}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {activeRoster.staffs.map((staff, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 group">
                      <td className="sticky left-0 z-10 bg-white p-5 border-r group-hover:bg-slate-50 transition-colors">
                        <div className="flex flex-col">
                          <span className="text-[9px] font-black text-orange-600 flex items-center gap-1.5 uppercase tracking-wider"><Store className="w-3 h-3" /> {staff.shopName}</span>
                          <span className="text-base font-black text-slate-800 mt-1">{staff.staffName}</span>
                        </div>
                      </td>
                      {activeRoster.days.map(d => { 
                        const s = staff.shifts.find(sh => sh.date === d); 
                        return <td key={d} className="p-1.5 border-r text-center">{s && s.shift ? <div className={`w-10 h-10 mx-auto rounded-2xl flex items-center justify-center font-black text-sm border shadow-sm ${getShiftColor(s.shift)}`}>{s.shift}</div> : <div className="w-10 h-10 mx-auto rounded-2xl bg-slate-50/30"></div>}</td>; 
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default RosterView;
