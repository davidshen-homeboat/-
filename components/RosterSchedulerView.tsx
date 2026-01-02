
import React, { useState, useMemo, useEffect } from 'react';
import { Save, Loader2, CheckCircle2, Users, Calendar, Sparkles, Settings, Plus, UserMinus, RefreshCw, Info, ChevronLeft, LayoutGrid, Target, AlertTriangle, CalendarDays, UserPlus, Zap, X, Search, Check, BarChart3, Heart, ShoppingBag, Scale, ShieldCheck, Clock, Ban, ListChecks, FilePlus2, Flag, AlertCircle, Copy, HelpCircle, BarChart, Coffee, Anchor, Sliders, Hash, Link2, Globe } from 'lucide-react';
import { saveRosterToCloud } from '../services/rosterApiService';
import { RosterData } from '../types';
import { GoogleGenAI } from "@google/genai";

const VERSION = "homeboat 1.0";

const SHIFT_TYPES = [
  { id: 'A', label: '早班 (A)', time: '07:00-16:00', category: 'morning', color: 'bg-rose-500', lightColor: 'bg-rose-100 text-rose-800 border-rose-200' },
  { id: 'B', label: '晚班 (B)', time: '10:00-17:00', category: 'evening', color: 'bg-sky-500', lightColor: 'bg-sky-100 text-sky-800 border-sky-200' },
  { id: 'C', label: '週日閉店 (C)', time: '08:00-17:00', category: 'evening', color: 'bg-emerald-500', lightColor: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { id: '休', label: '休息', time: '-', category: 'off', color: 'bg-red-600', lightColor: 'bg-red-600 text-white border-red-700' },
];

interface StaffPreference {
  isFullTime: boolean;
  mustOffDays: number[];
  willingness: Record<string, number>; 
  shiftMinDays: Record<string, number>; 
}

const RosterSchedulerView: React.FC = () => {
  const [writeUrl, setWriteUrl] = useState(() => localStorage.getItem('bakery_roster_write_url') || '');
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [targetTabName, setTargetTabName] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();

  const [opRequirements, setOpRequirements] = useState({
    morningMin: 1,
    eveningMin: 1
  });

  const [staffList, setStaffList] = useState<string[]>(() => {
    const saved = localStorage.getItem('bakery_scheduler_staffs');
    return saved ? JSON.parse(saved) : [];
  });

  const [staffPrefs, setStaffPrefs] = useState<Record<string, StaffPreference>>(() => {
    const saved = localStorage.getItem('bakery_scheduler_prefs');
    return saved ? JSON.parse(saved) : {};
  });

  const [editingStaff, setEditingStaff] = useState<string | null>(null);
  const [roster, setRoster] = useState<Record<string, string>>({}); 
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [manualName, setManualName] = useState('');

  const [showScanner, setShowScanner] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [foundNames, setFoundNames] = useState<{name: string, source: string}[]>([]);
  const [selectedToImport, setSelectedToImport] = useState<string[]>([]);

  const DEFAULT_PREF: StaffPreference = {
    isFullTime: true,
    mustOffDays: [],
    willingness: { A: 1, B: 1, C: 1 },
    shiftMinDays: { A: 0, B: 0, C: 0 }
  };

  useEffect(() => {
    const defaultTabName = `${year - 1911}.${String(month).padStart(2, '0')}_AI正式版`;
    setTargetTabName(defaultTabName);
  }, [year, month]);

  useEffect(() => {
    localStorage.setItem('bakery_roster_write_url', writeUrl);
    localStorage.setItem('bakery_scheduler_staffs', JSON.stringify(staffList));
    localStorage.setItem('bakery_scheduler_prefs', JSON.stringify(staffPrefs));
  }, [writeUrl, staffList, staffPrefs]);

  const getDayOfWeekNum = (d: number) => new Date(year, month - 1, d).getDay();
  const getDayOfWeek = (d: number) => ['日', '一', '二', '三', '四', '五', '六'][getDayOfWeekNum(d)];
  const isWeekend = (d: number) => {
    const day = getDayOfWeekNum(d);
    return day === 0 || day === 6;
  };

  const { staffStats, dailyCoverage } = useMemo(() => {
    const stats: Record<string, { A: number, B: number, C: number, OFF: number, total: number }> = {};
    const coverage: Record<number, { A: number, evening: number, total: number }> = {};
    
    for (let d = 1; d <= daysInMonth; d++) coverage[d] = { A: 0, evening: 0, total: 0 };

    staffList.forEach(s => {
      stats[s] = { A: 0, B: 0, C: 0, OFF: 0, total: 0 };
      for (let d = 1; d <= daysInMonth; d++) {
        const shift = roster[`${s}-${d}`] || '休';
        if (shift !== '休') {
          stats[s].total++;
          if (shift === 'A') { stats[s].A++; coverage[d].A++; }
          if (shift === 'B') { stats[s].B++; coverage[d].evening++; }
          if (shift === 'C') { stats[s].C++; coverage[d].evening++; }
          coverage[d].total++;
        } else {
          stats[s].OFF++;
        }
      }
    });
    return { staffStats: stats, dailyCoverage: coverage };
  }, [roster, staffList, daysInMonth]);

  const startGlobalScan = () => {
    setIsScanning(true);
    setShowScanner(true);
    setFoundNames([]);
    setSelectedToImport([]);
    
    setTimeout(() => {
      const discovered = new Map<string, string>();
      const rosterSaved = localStorage.getItem('bakery_roster_map_v1');
      if (rosterSaved) {
        try {
          const rosterMap: Record<string, RosterData> = JSON.parse(rosterSaved);
          Object.values(rosterMap).forEach(data => {
            if (data.staffs && Array.isArray(data.staffs)) {
              data.staffs.forEach(s => {
                const name = s.staffName?.trim();
                if (name && name.length >= 2 && !staffList.includes(name)) {
                  discovered.set(name, s.shopName || '歷史數據');
                }
              });
            }
          });
        } catch(e) { console.error("History Scan Error", e); }
      }
      const results = Array.from(discovered.entries()).map(([name, source]) => ({ name, source }));
      setFoundNames(results);
      setSelectedToImport(results.map(r => r.name));
      setIsScanning(false);
    }, 800);
  };

  const generateRoster = async () => {
    if (staffList.length < 2) return alert("至少需要 2 名員工。");
    setIsGenerating(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `你是一個專業的 Bakery 店務排班助理 (homeboat 1.0)。請為 ${year}年${month}月 (${daysInMonth}天) 進行精密排班。

      【核心排班鐵律 - homeboat 1.0 定案穩定版】
      1. 正職非休即班 (絕對優先)：身分為「正職」的人員，除了指定的「休假日期 (mustOffDays)」外，每一天都「必須」安排班次 (A, B 或 C)。禁止正職在非休假日期安排「休」。
      2. 意願比例精準分配 (機率權重)：這點至關重要！「比例 (willingness)」代表該員工被分配到各班別的天數機率。
         - 例如：某員設定 A:5, B:1, C:1，表示他的總工作日中，A 班的次數必須是 B 或 C 的 5 倍。請精確計算並輸出符合此比例的結果。
      3. 兼職補位原則：兼職人員僅在正職人數不足以支撐低標 (早A:${opRequirements.morningMin}, 晚B/C:${opRequirements.eveningMin}) 時才進行補班。若正職夠用，兼職一律安排「休」。
      4. 嚴禁晚接早：禁止任何員工在前一天晚班 (B/C)，隔天接早班 (A)。
      5. 班別保底強制性：必須優先滿足每人設定的 A/B/C 各班別起碼天數。
      6. 週日專屬規則：週日晚班代號一律為 「C」。
      
      【員工清單與精密偏好】
      ${staffList.map(name => {
        const p = staffPrefs[name] || { ...DEFAULT_PREF };
        return `- ${name}: [${p.isFullTime ? '正職' : '兼職'}], 休假:[${p.mustOffDays.join(',')}], 保底:[A:${p.shiftMinDays?.A ?? 0}, B:${p.shiftMinDays?.B ?? 0}, C:${p.shiftMinDays?.C ?? 0}], 權重比例:[A:${p.willingness?.A ?? 1}, B:${p.willingness?.B ?? 1}, C:${p.willingness?.C ?? 1}]`;
      }).join('\n')}

      請嚴格按照以上邏輯輸出 JSON 格式。
      輸出格式 JSON： { "1": {"A": ["姓名"], "B": ["姓名"], "C": ["姓名"], "休": ["姓名"]}, ... }`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: { 
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 32768 }
        }
      });

      const result = JSON.parse(response.text || "{}");
      const newRoster: Record<string, string> = {};
      staffList.forEach(s => { for(let d=1; d<=daysInMonth; d++) newRoster[`${s}-${d}`] = '休'; });

      Object.entries(result).forEach(([day, slots]: [string, any]) => {
        ['A', 'B', 'C', '休'].forEach(sID => {
          const names = slots[sID];
          if (Array.isArray(names)) {
            names.forEach(n => { 
              if (staffList.includes(n)) {
                let finalSID = sID;
                if (getDayOfWeekNum(parseInt(day)) === 0 && sID === 'B') finalSID = 'C';
                newRoster[`${n}-${day}`] = finalSID; 
              }
            });
          }
        });
      });

      setRoster(newRoster);
    } catch (e) {
      alert("AI 排班生成失敗。");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveToCloud = async () => {
    if (!writeUrl) {
        setShowApiConfig(true);
        return alert("請先設定 Google Apps Script API 連結。");
    }
    if (Object.keys(roster).length === 0) return alert("請先生成班表。");
    
    setIsSaving(true);
    
    const finalTabName = targetTabName || `${year - 1911}.${String(month).padStart(2, '0')}_AI正式版`;
    const header = ["姓名", ...Array.from({ length: daysInMonth }, (_, i) => String(i + 1)), "早(A)", "晚(B)", "閉店(C)", "休", "總計"];
    
    const data = staffList.map(s => {
      const stats = staffStats[s];
      const rowShifts = Array.from({ length: daysInMonth }, (_, i) => String(roster[`${s}-${i+1}`] || "休"));
      return [String(s), ...rowShifts, String(stats.A), String(stats.B), String(stats.C), String(stats.OFF), String(stats.total)];
    });

    const ok = await saveRosterToCloud(writeUrl, { 
      action: 'saveRoster', 
      tabName: finalTabName, 
      data: [header, ...data] 
    });
    
    setIsSaving(false);
    if(ok) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      alert(`已將「${finalTabName}」班表存入您的 Google Sheet！`);
    } else {
      alert("儲存失敗，請檢查 API 連結是否正確，或是否已在 Apps Script 中正確部署。");
    }
  };

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-slate-900 rounded-2xl flex flex-col items-center justify-center text-white shadow-xl border-b-4 border-rose-500">
            <span className="text-[10px] font-black opacity-50">{year}</span>
            <span className="text-xl font-black">{month}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
               <h1 className="text-3xl font-black text-slate-800 tracking-tight">智能排班工作台</h1>
               <span className="px-2 py-1 bg-rose-100 text-rose-600 text-[9px] font-black rounded-lg border border-rose-200">homeboat 1.0</span>
            </div>
            <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-1 mt-1"><Anchor className="w-3.5 h-3.5" /> 穩定優化版 (正職零空隙原則)</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowApiConfig(!showApiConfig)} className={`p-3 border rounded-xl shadow-sm transition-all ${showApiConfig ? 'bg-slate-900 text-white border-slate-900' : 'bg-white hover:bg-slate-50'}`}><Globe className="w-5 h-5" /></button>
          <button onClick={() => setSelectedDate(new Date(year, month - 2, 1))} className="p-3 bg-white border rounded-xl hover:bg-slate-50 shadow-sm transition-all"><ChevronLeft className="w-5 h-5" /></button>
          <button onClick={() => setSelectedDate(new Date(year, month, 1))} className="p-3 bg-white border rounded-xl hover:bg-slate-50 shadow-sm transition-all rotate-180"><ChevronLeft className="w-5 h-5" /></button>
          <button onClick={handleSaveToCloud} disabled={isSaving} className={`px-6 py-3 rounded-2xl text-xs font-black flex items-center gap-2 shadow-lg transition-all ${success ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}>
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? '正在建立分頁...' : '儲存為新工作表'}
          </button>
        </div>
      </div>

      {showApiConfig && (
        <div className="bg-slate-900 text-white p-8 rounded-[40px] shadow-2xl space-y-4 border-b-4 border-indigo-500 animate-in slide-in-from-top-4 duration-300">
           <div className="flex items-center gap-2 mb-2">
             <Link2 className="text-indigo-400 w-5 h-5" />
             <h3 className="text-lg font-black tracking-tight">雲端 API 設定 (Apps Script)</h3>
           </div>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 ml-1">APPS SCRIPT API 連結 (POST)</label>
                <input type="text" value={writeUrl} onChange={e => setWriteUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" className="w-full px-5 py-3 bg-slate-800 border-none rounded-2xl font-bold text-xs focus:ring-2 focus:ring-indigo-500 text-indigo-100" />
             </div>
             <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 ml-1">新分頁名稱 (AI 將以此名稱建立)</label>
                <input type="text" value={targetTabName} onChange={e => setTargetTabName(e.target.value)} placeholder="例如：113.04_AI正式版" className="w-full px-5 py-3 bg-slate-800 border-none rounded-2xl font-bold text-xs focus:ring-2 focus:ring-indigo-500 text-indigo-100" />
             </div>
           </div>
           <p className="text-[10px] text-slate-500 font-bold italic pt-2">※ 儲存後，AI 會自動在您的試算表中建立「{targetTabName}」分頁並寫入結果。</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-3 bg-white p-8 rounded-[40px] border shadow-sm space-y-6 overflow-hidden">
           
           <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {SHIFT_TYPES.map(t => (
                <div key={t.id} className={`p-4 rounded-2xl border flex flex-col ${t.lightColor} border-current`}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2.5 h-2.5 rounded-full ${t.color}`}></div>
                    <span className="text-xs font-black">{t.label}</span>
                  </div>
                  <span className="text-[10px] font-bold opacity-60"><Clock className="w-3 h-3 inline mr-1" />{t.time}</span>
                </div>
              ))}
           </div>

           <div className="overflow-x-auto custom-scrollbar border rounded-3xl">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b text-[10px] font-black uppercase text-slate-400">
                    <th className="sticky left-0 z-20 bg-slate-50 p-4 text-left border-r min-w-[150px]">人員</th>
                    {Array.from({ length: daysInMonth }, (_, i) => (
                      <th key={i+1} className={`p-3 text-center border-r min-w-[55px] ${isWeekend(i+1) ? 'bg-indigo-50/50 text-indigo-700' : 'text-slate-600'}`}>
                        <div className="opacity-60 mb-0.5">{getDayOfWeek(i+1)}</div>
                        <div className="text-xs">{i+1}</div>
                      </th>
                    ))}
                    <th className="p-2 text-center bg-slate-800 border-r min-w-[160px] text-white">月統計 (A/B/C/休)</th>
                  </tr>
                  <tr className="bg-slate-100/50 border-b">
                    <td className="sticky left-0 z-10 bg-slate-100 p-2 border-r text-center font-black text-[9px] text-slate-400 italic flex items-center justify-center gap-1 h-14">
                       <ShieldCheck className="w-3 h-3" /> 人力檢查
                    </td>
                    {Array.from({ length: daysInMonth }, (_, i) => {
                       const d = i + 1;
                       const cov = dailyCoverage[d];
                       const isLowA = cov.A < opRequirements.morningMin;
                       const isLowE = cov.evening < opRequirements.eveningMin;
                       const isLow = isLowA || isLowE;
                       return (
                         <td key={d} className={`p-1 border-r text-center transition-colors ${isLow ? 'bg-rose-50' : 'bg-emerald-50/30'}`}>
                            <div className="flex flex-col items-center justify-center h-full">
                              <span className={`text-[9px] font-black ${isLowA ? 'text-rose-600' : 'text-slate-400'}`}>早:{cov.A}</span>
                              <span className={`text-[9px] font-black ${isLowE ? 'text-rose-600' : 'text-slate-400'}`}>晚:{cov.evening}</span>
                            </div>
                         </td>
                       );
                    })}
                    <td className="bg-slate-200"></td>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {staffList.map(staff => {
                    const stats = staffStats[staff] || { A: 0, B: 0, C: 0, OFF: 0, total: 0 };
                    const isFT = staffPrefs[staff]?.isFullTime !== false;
                    const pref = staffPrefs[staff] || DEFAULT_PREF;

                    return (
                      <tr key={staff} className="hover:bg-slate-50 group">
                        <td className="sticky left-0 z-10 bg-white p-4 border-r group-hover:bg-slate-50 flex items-center justify-between gap-2 shadow-sm">
                          <div className="min-w-0 flex items-center gap-2">
                            <div className={`w-1.5 h-8 rounded-full ${isFT ? 'bg-indigo-600' : 'bg-amber-400'}`}></div>
                            <span className="font-black text-slate-800 text-sm truncate">{staff}</span>
                          </div>
                          <button onClick={() => setEditingStaff(staff)} className="p-2 hover:bg-slate-100 rounded-xl transition-opacity"><Settings className="w-4 h-4 text-slate-400" /></button>
                        </td>
                        {Array.from({ length: daysInMonth }, (_, i) => {
                          const shift = roster[`${staff}-${i+1}`] || '休';
                          const type = SHIFT_TYPES.find(t => t.id === shift);
                          return (
                            <td key={i+1} className="p-1 border-r text-center">
                              <div className={`w-9 h-9 mx-auto rounded-xl flex items-center justify-center font-black transition-all ${type?.lightColor || 'bg-slate-50 text-slate-300'}`}>
                                <span className="text-[10px]">{shift}</span>
                              </div>
                            </td>
                          );
                        })}
                        <td className="p-2 text-center border-r font-black text-xs flex items-center justify-center gap-1">
                          <span className="w-8 py-1.5 bg-rose-100 text-rose-800 rounded-lg shadow-sm">{stats.A}</span>
                          <span className="w-8 py-1.5 bg-sky-100 text-sky-800 rounded-lg shadow-sm">{stats.B}</span>
                          <span className="w-8 py-1.5 bg-emerald-100 text-emerald-800 rounded-lg shadow-sm">{stats.C}</span>
                          <span className="w-8 py-1.5 bg-red-600 text-white rounded-lg shadow-sm">{stats.OFF}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
           </div>
        </div>

        <div className="space-y-6">
           <div className="bg-white p-6 rounded-[32px] border shadow-sm space-y-4">
              <h3 className="font-black text-slate-800 text-sm flex items-center gap-2 text-rose-600"><ShieldCheck className="w-4 h-4" /> 營運人力低標</h3>
              <div className="grid grid-cols-2 gap-3">
                 <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 ml-1">早班(A)低標</label>
                    <input type="number" min="0" value={opRequirements.morningMin} onChange={e => setOpRequirements({...opRequirements, morningMin: parseInt(e.target.value) || 0})} className="w-full px-4 py-2 bg-slate-50 rounded-xl font-black text-xs border-none" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 ml-1">晚班(B/C)低標</label>
                    <input type="number" min="0" value={opRequirements.eveningMin} onChange={e => setOpRequirements({...opRequirements, eveningMin: parseInt(e.target.value) || 0})} className="w-full px-4 py-2 bg-slate-50 rounded-xl font-black text-xs border-none" />
                 </div>
              </div>
           </div>

           <div className="bg-white p-6 rounded-[32px] border shadow-sm space-y-4">
              <h3 className="font-black text-slate-800 text-sm flex items-center gap-2 text-indigo-600"><Users className="w-4 h-4" /> 人員管理</h3>
              <div className="flex gap-2">
                <input type="text" value={manualName} onChange={e => setManualName(e.target.value)} placeholder="姓名" className="flex-1 px-4 py-3 bg-slate-50 border-none rounded-2xl text-xs font-bold" />
                <button onClick={() => { if(!manualName) return; setStaffList(prev => [...new Set([...prev, manualName])].sort()); setManualName(''); }} className="p-3 bg-slate-900 text-white rounded-2xl"><Plus className="w-5 h-5"/></button>
              </div>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar text-[10px]">
                {staffList.map(s => (
                  <div key={s} className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-black bg-slate-50 border text-slate-700">
                    {s} <button onClick={() => setStaffList(staffList.filter(x => x !== s))} className="text-rose-400"><UserMinus className="w-3 h-3"/></button>
                  </div>
                ))}
              </div>
              <button onClick={startGlobalScan} className="w-full py-3 bg-slate-50 border border-slate-200 rounded-2xl text-[10px] font-black flex items-center justify-center gap-2 hover:bg-slate-100 transition-colors">
                 <Search className="w-3 h-3 text-orange-600" /> 同步歷史班表人員
              </button>
           </div>

           <button onClick={generateRoster} disabled={isGenerating} className="w-full py-8 bg-orange-600 text-white rounded-[40px] font-black text-xl flex flex-col items-center justify-center gap-3 shadow-2xl active:scale-95 transition-all">
              {isGenerating ? <Loader2 className="w-8 h-8 animate-spin" /> : <Sparkles className="w-8 h-8" />}
              {isGenerating ? 'AI 精算比例中...' : '生成正式班表'}
           </button>
        </div>
      </div>

      {/* 偏好編輯 Modal */}
      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setEditingStaff(null)}></div>
           <div className="bg-white w-full max-w-2xl rounded-[48px] shadow-2xl relative z-10 overflow-hidden">
              <div className="p-10 space-y-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
                 <div className="flex justify-between items-center">
                   <div>
                    <h2 className="text-3xl font-black text-slate-800">{editingStaff} 排班規則</h2>
                    <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest mt-1">homeboat 1.0 原始設定模式</p>
                   </div>
                   <button onClick={() => setEditingStaff(null)} className="p-3 hover:bg-slate-100 rounded-2xl"><X className="w-6 h-6"/></button>
                 </div>
                 
                 <div className="space-y-8">
                    <div className="flex gap-2">
                       {['正職', '兼職'].map(type => {
                         const isFT = staffPrefs[editingStaff!]?.isFullTime !== false;
                         const active = (type === '正職' && isFT) || (type === '兼職' && !isFT);
                         return (
                           <button key={type} onClick={() => setStaffPrefs(prev => ({ ...prev, [editingStaff!]: { ...(prev[editingStaff!] || DEFAULT_PREF), isFullTime: type === '正職' } }))} className={`flex-1 py-4 rounded-2xl border font-black text-sm transition-all ${active ? 'bg-indigo-600 text-white border-indigo-700 shadow-lg' : 'bg-slate-50 text-slate-400'}`}>{type}</button>
                         );
                       })}
                    </div>

                    <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200">
                      <div className="grid grid-cols-4 gap-4 mb-4 text-center">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">班別</div>
                        <div className="col-span-1 text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center justify-center gap-1"><Hash className="w-3 h-3"/> 起碼上幾天</div>
                        <div className="col-span-2 text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center justify-center gap-1"><Sliders className="w-3 h-3"/> 分配機率權重 (越大越常排)</div>
                      </div>

                      {['A', 'B', 'C'].map(s => {
                        const minDays = staffPrefs[editingStaff!]?.shiftMinDays?.[s] ?? 0;
                        const willingness = staffPrefs[editingStaff!]?.willingness?.[s] ?? 1;
                        return (
                          <div key={s} className="grid grid-cols-4 gap-4 items-center mb-3">
                            <div className="text-center font-black text-slate-800 text-sm">{s} 班</div>
                            <input 
                              type="number" min="0" max="31"
                              value={minDays}
                              onChange={e => setStaffPrefs(prev => ({
                                ...prev,
                                [editingStaff!]: {
                                  ...(prev[editingStaff!] || DEFAULT_PREF),
                                  shiftMinDays: { ...(prev[editingStaff!]?.shiftMinDays || DEFAULT_PREF.shiftMinDays), [s]: parseInt(e.target.value) || 0 }
                                }
                              }))}
                              className="w-full p-3 bg-white border rounded-xl text-center font-black text-xs shadow-sm focus:ring-2 focus:ring-indigo-500"
                            />
                            <div className="col-span-2 flex items-center gap-3">
                              <input 
                                type="range" min="0" max="10"
                                value={willingness}
                                onChange={e => setStaffPrefs(prev => ({
                                  ...prev,
                                  [editingStaff!]: {
                                    ...(prev[editingStaff!] || DEFAULT_PREF),
                                    willingness: { ...(prev[editingStaff!]?.willingness || DEFAULT_PREF.willingness), [s]: parseInt(e.target.value) || 0 }
                                  }
                                }))}
                                className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                              />
                              <span className="w-6 text-center font-black text-xs text-emerald-600">{willingness}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-black text-rose-400 uppercase tracking-widest ml-1 flex items-center gap-1.5"><Ban className="w-3.5 h-3.5" /> 指定休假日期</label>
                      </div>
                      <div className="grid grid-cols-7 gap-1.5 p-4 bg-slate-50 rounded-[32px] border border-slate-200">
                         {Array.from({length: daysInMonth}, (_, i) => {
                            const d = i + 1;
                            const isOff = staffPrefs[editingStaff!]?.mustOffDays.includes(d);
                            return (
                              <button key={d} onClick={() => {
                                 setStaffPrefs(prev => {
                                   const curr = prev[editingStaff!] || DEFAULT_PREF;
                                   const nextOff = isOff ? curr.mustOffDays.filter(x => x !== d) : [...curr.mustOffDays, d].sort((a,b)=>a-b);
                                   return { ...prev, [editingStaff!]: { ...curr, mustOffDays: nextOff } };
                                 });
                              }} className={`aspect-square rounded-xl flex flex-col items-center justify-center border transition-all ${isOff ? 'bg-red-600 text-white border-red-700 shadow-inner' : 'bg-white text-slate-400 hover:border-slate-300'}`}>
                                <span className="text-[10px] font-black">{d}</span>
                                <span className="text-[7px] font-bold opacity-60">{getDayOfWeek(d)}</span>
                              </button>
                            );
                         })}
                      </div>
                    </div>
                 </div>
                 <button onClick={() => setEditingStaff(null)} className="w-full py-5 bg-slate-900 text-white rounded-[28px] font-black text-lg shadow-xl active:scale-95 transition-all">確認並套用規則</button>
              </div>
           </div>
        </div>
      )}

      {showScanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => !isScanning && setShowScanner(false)}></div>
           <div className="bg-white w-full max-w-lg rounded-[48px] shadow-2xl relative z-10 overflow-hidden animate-in zoom-in duration-300">
              <div className="p-10 space-y-8">
                 <div className="flex justify-between items-center">
                   <h2 className="text-3xl font-black text-slate-800">提取歷史名單</h2>
                   {!isScanning && <button onClick={() => setShowScanner(false)} className="p-3 hover:bg-slate-100 rounded-2xl"><X className="w-6 h-6"/></button>}
                 </div>
                 {isScanning ? (
                    <div className="py-20 text-center space-y-6">
                       <Loader2 className="w-16 h-16 animate-spin text-orange-600 mx-auto" />
                       <p className="font-black text-slate-800 tracking-widest">正在掃描班表快取中的所有人員...</p>
                    </div>
                 ) : (
                    <div className="space-y-6">
                      <div className="bg-slate-50 p-6 rounded-[32px] border max-h-[400px] overflow-y-auto custom-scrollbar space-y-2">
                        {foundNames.length > 0 ? foundNames.map(item => (
                          <button key={item.name} onClick={() => setSelectedToImport(prev => prev.includes(item.name) ? prev.filter(x => x !== item.name) : [...prev, item.name])} className={`flex items-center justify-between w-full p-4 rounded-2xl border transition-all ${selectedToImport.includes(item.name) ? 'bg-orange-600 text-white border-orange-700' : 'bg-white border-slate-100 shadow-sm'}`}>
                            <div className="text-left">
                               <div className="font-black text-sm">{item.name}</div>
                               <div className={`text-[9px] font-bold ${selectedToImport.includes(item.name) ? 'text-white/60' : 'text-slate-400'}`}>{item.source}</div>
                            </div>
                            {selectedToImport.includes(item.name) && <CheckCircle2 className="w-5 h-5" />}
                          </button>
                        )) : (
                          <div className="py-10 text-center text-slate-400 font-bold">未發現新的歷史名單，請先至「班表中心」同步資料。</div>
                        )}
                      </div>
                      <button disabled={selectedToImport.length === 0} onClick={() => { setStaffList(prev => Array.from(new Set([...prev, ...selectedToImport])).sort()); setShowScanner(false); }} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black shadow-xl active:scale-95 transition-transform disabled:opacity-50">將選中人員加入排班清單 ({selectedToImport.length})</button>
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}
    </div>
  );
};

export default RosterSchedulerView;
