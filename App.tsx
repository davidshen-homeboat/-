
import React, { useState, useEffect, useMemo } from 'react';
import { Search, Link as LinkIcon, Plus, Trash2, Phone, Calendar as CalendarIcon, Menu, ChefHat, Users, Inbox, RefreshCw, Loader2, X, Save, Globe, FileSpreadsheet, Database, ClipboardList, CheckCircle2, AlertCircle, Info, UserCheck, MessageSquare, Clock, ShieldAlert, CheckCircle, Ban, CalendarDays, Pencil, ExternalLink, MapPin, Unlink, Tag, Layers, Check, Monitor, ArrowRight, WifiOff } from 'lucide-react';
import Sidebar from './components/Sidebar';
import AnalysisCard from './components/AnalysisCard';
import { AppView, Reservation, DataSource } from './types';
import { mapReservationsCSVAsync, fetchCsvStreaming } from './services/dataProcessor';

// 簽章版本，若結構變動則更新此值以清空舊黑名單
const SIG_VERSION = 'v3'; 
const STORAGE_KEY_RESERVATIONS = 'bakery_reservations';
const STORAGE_KEY_SOURCES = 'bakery_sources';
const STORAGE_KEY_BLACKLIST = `bakery_sync_blacklist_${SIG_VERSION}`;

const TABLE_OPTIONS = ['綠1', '綠2', '綠3', '綠4', '綠5', '白1', '白2a', '白2b', '白3', '白4a', '白4b', '白5'];
const CREATOR_OPTIONS = ['沈家杭', 'TAKA'];
const TYPE_OPTIONS = ['內用', '外帶', '包場'];
const DURATION_OPTIONS = [30, 60, 90, 120, 150, 180, 240];

function App() {
  const [currentView, setCurrentView] = useState<AppView>(AppView.RESERVATIONS);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSyncingToCloud, setIsSyncingToCloud] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  
  const [syncBlacklist, setSyncBlacklist] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_BLACKLIST);
    return saved ? JSON.parse(saved) : {};
  });
  
  const [reservations, setReservations] = useState<Reservation[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_RESERVATIONS);
    return saved ? JSON.parse(saved) : [];
  });
  const [dataSources, setDataSources] = useState<DataSource[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SOURCES);
    return saved ? JSON.parse(saved) : [];
  });
  
  const [form, setForm] = useState<Partial<Reservation>>({
    date: new Date().toISOString().split('T')[0],
    time: '12:00', pax: 2, type: '內用', customerName: '', phone: '', table: '', notes: '', creator: CREATOR_OPTIONS[0], duration: 90
  });

  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  
  const [newUrl, setNewUrl] = useState('');
  const [newWriteUrl, setNewWriteUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newDuration, setNewDuration] = useState(90);
  
  const [loadingSource, setLoadingSource] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // 自動化邏輯：包場時自動設定時長與桌位
  useEffect(() => {
    if (isModalOpen && form.type === '包場') {
      setForm(prev => ({ ...prev, duration: 240 }));
      setSelectedTables([...TABLE_OPTIONS]);
    }
  }, [form.type, isModalOpen]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setSyncBlacklist(prev => {
        const next = { ...prev };
        let changed = false;
        Object.keys(next).forEach(key => {
          if (now - next[key] > 900000) { // 15分鐘後過期
            delete next[key];
            changed = true;
          }
        });
        if (changed) localStorage.setItem(STORAGE_KEY_BLACKLIST, JSON.stringify(next));
        return changed ? next : prev;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(reservations.slice(0, 1000)));
  }, [reservations]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SOURCES, JSON.stringify(dataSources));
  }, [dataSources]);

  // 修改：加入 table 到簽章，確保修改桌號也會視為不同記錄
  const getSignature = (res: any) => {
    if (!res) return "";
    return [
      (res.date || '').toString().replace(/[\/\-\.]/g, '').trim(),
      (res.customerName || '').toString().trim(),
      (res.phone || '').toString().replace(/[\s\-]/g, '').trim(),
      (res.time || '12:00').toString().replace(/:/g, '').substring(0, 4),
      (res.pax || '1').toString().trim(),
      (res.table || '').toString().trim() // 加入桌號判斷
    ].join('|').toLowerCase();
  };

  const syncToGoogleSheet = async (payload: any, sourceId?: string) => {
    const targetSource = dataSources.find(s => s.id === sourceId);
    if (!targetSource?.writeUrl) return false;
    try {
      const safePayload = JSON.parse(JSON.stringify(payload, (key, value) => 
        (typeof value === 'number') ? value.toString() : value
      ));
      await fetch(targetSource.writeUrl.trim(), {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(safePayload)
      });
      return true;
    } catch (e) {
      console.error("Cloud Error", e);
      return false;
    }
  };

  const handleSyncAll = async (isSilent = false) => {
    if (dataSources.length === 0) return;
    if (!isSilent) setSyncingAll(true);
    setSyncError(null);
    try {
        let allRemote: Reservation[] = [];
        for (const source of dataSources) {
            try {
              const csvText = await fetchCsvStreaming(source.url, () => {});
              const remoteData = await mapReservationsCSVAsync(csvText, source.id, () => {});
              allRemote = [...allRemote, ...remoteData];
            } catch (err) { 
              console.error(err); 
              setSyncError(`無法讀取 ${source.name}，請檢查網路。`);
            }
        }

        setReservations(prev => {
          // 1. 過濾掉黑名單中的雲端資料
          const processedRemote = allRemote.filter(r => !syncBlacklist[getSignature(r)]);
          
          // 2. 保留本地尚未同步成功或正在同步中的資料
          // 如果雲端已經有了（匹配姓名、日期、時間、桌號），則不顯示本地暂存
          const localOnly = prev.filter(p => p.isLocal && !processedRemote.some(r => 
            r.customerName === p.customerName && 
            r.date === p.date && 
            r.time === p.time &&
            r.table === p.table
          ));
          
          return [...localOnly, ...processedRemote];
        });
        
        setDataSources(prev => prev.map(s => ({...s, lastUpdated: new Date().toLocaleString(), status: 'ACTIVE'})));
    } finally { if (!isSilent) setSyncingAll(false); }
  };

  const handleSaveReservation = async () => {
    if (!form.customerName || !form.date || selectedTables.length === 0) return alert('請確認姓名與桌號');
    setIsSyncingToCloud(true);
    const tableString = selectedTables.sort().join(', ');
    const targetSourceId = editingReservation?.sourceId || dataSources[0]?.id;

    const resPayload: Reservation = { 
      id: editingReservation ? editingReservation.id : `local-${Date.now()}`,
      customerName: (form.customerName || '').trim(),
      date: form.date || '',
      time: (form.time || '12:00').substring(0, 5),
      pax: Number(form.pax) || 1,
      type: form.type || '內用',
      phone: (form.phone || '').trim(),
      table: tableString,
      notes: (form.notes || '').trim(),
      creator: form.creator || CREATOR_OPTIONS[0],
      duration: form.duration || 90,
      isLocal: true,
      syncStatus: 'pending',
      sourceId: targetSourceId
    };

    let syncPayload: any = { action: editingReservation ? 'update' : 'create', ...resPayload };

    if (editingReservation) {
      // 修改前，將舊狀態加入黑名單
      const oldSig = getSignature(editingReservation);
      const newBlacklist = { ...syncBlacklist, [oldSig]: Date.now() };
      setSyncBlacklist(newBlacklist);
      localStorage.setItem(STORAGE_KEY_BLACKLIST, JSON.stringify(newBlacklist));
      
      syncPayload = { ...syncPayload, oldDate: editingReservation.date, oldType: editingReservation.type, oldTime: editingReservation.time.substring(0, 5), oldPax: editingReservation.pax.toString(), oldName: editingReservation.customerName, oldPhone: editingReservation.phone, oldTable: editingReservation.table, oldNotes: editingReservation.notes };
      setReservations(prev => prev.map(r => r.id === editingReservation.id ? resPayload : r));
    } else {
      setReservations(prev => [resPayload, ...prev]);
    }

    const success = await syncToGoogleSheet(syncPayload, targetSourceId);
    if (success) {
      setReservations(prev => prev.map(r => r.id === resPayload.id ? { ...r, syncStatus: 'synced' } : r));
      // 延時同步以等待雲端 CSV 更新
      setTimeout(() => handleSyncAll(true), 15000);
    } else {
      alert("雲端同步失敗，僅儲存於本地。");
    }
    setIsSyncingToCloud(false);
    setIsModalOpen(false);
    setEditingReservation(null);
  };

  const handleDeleteReservation = async (res: Reservation) => {
    if (!confirm(`確定要刪除「${res.customerName}」嗎？`)) return;
    const sig = getSignature(res);
    const newBlacklist = { ...syncBlacklist, [sig]: Date.now() };
    setSyncBlacklist(newBlacklist);
    localStorage.setItem(STORAGE_KEY_BLACKLIST, JSON.stringify(newBlacklist));
    setReservations(prev => prev.filter(r => r.id !== res.id));
    setIsSyncingToCloud(true);
    const success = await syncToGoogleSheet({ action: 'delete', oldDate: res.date, oldType: res.type, oldTime: res.time.substring(0, 5), oldPax: res.pax.toString(), oldName: res.customerName, oldPhone: res.phone, oldTable: res.table, oldNotes: res.notes }, res.sourceId);
    setIsSyncingToCloud(false);
    if (success) setTimeout(() => handleSyncAll(true), 15000);
  };

  const handleOpenEdit = (res: Reservation) => {
    setEditingReservation(res);
    setForm({ ...res, duration: res.duration || 90 });
    setSelectedTables((res.table || '').split(', ').filter(Boolean));
    setIsModalOpen(true);
  };

  const handleAddSource = () => {
    if (!newUrl || !newWriteUrl) return alert("資訊不齊全");
    setLoadingSource(true);
    const sId = `ds-${Date.now()}`;
    fetchCsvStreaming(newUrl, () => {}).then(csv => mapReservationsCSVAsync(csv, sId, () => {})).then(data => {
        setDataSources(prev => [...prev, { id: sId, name: newName || `分店 ${dataSources.length + 1}`, url: newUrl, writeUrl: newWriteUrl, type: 'RESERVATIONS', lastUpdated: new Date().toLocaleString(), status: 'ACTIVE', diningDuration: newDuration }]);
        setReservations(prev => [...data, ...prev]);
        setNewUrl(''); setNewWriteUrl(''); setNewName('');
    }).catch(() => alert("連線失敗")).finally(() => setLoadingSource(false));
  };

  const timeToMinutes = (timeStr: string) => {
    if (!timeStr) return 0;
    const [hrs, mins] = timeStr.split(':').map(Number);
    return hrs * 60 + (mins || 0);
  };

  const minutesToTime = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  };

  // 即時桌況摘要 (現在時刻)
  const currentOccupancy = useMemo(() => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const nowMins = now.getHours() * 60 + now.getMinutes();
    const details = new Map<string, {name: string, time: string}>();

    reservations.forEach(res => {
      if (res.date !== today) return;
      const resStart = timeToMinutes(res.time);
      const resEnd = resStart + (res.duration || 90);
      if (nowMins >= resStart && nowMins < resEnd) {
        (res.table || '').split(', ').filter(Boolean).forEach(t => details.set(t, { name: res.customerName, time: res.time }));
      }
    });
    return details;
  }, [reservations]);

  // Modal 內的時段桌況計算
  const { occupiedTableDetails, selectedTimeSlotLabel } = useMemo(() => {
    if (!isModalOpen || !form.date || !form.time) return { occupiedTableDetails: new Map<string, any>(), selectedTimeSlotLabel: '' };
    
    const startMins = timeToMinutes(form.time);
    const endMins = startMins + (form.duration || 90);
    const details = new Map<string, {name: string, time: string, end: string}>();
    
    reservations.forEach(res => {
      if (editingReservation && res.id === editingReservation.id) return; 
      if (res.date !== form.date) return;
      
      const resStart = timeToMinutes(res.time);
      const resDuration = res.duration || 90;
      const resEnd = resStart + resDuration;
      
      if ((startMins < resEnd) && (endMins > resStart)) {
        const endTimeStr = minutesToTime(resEnd);
        (res.table || '').split(', ').filter(Boolean).forEach(t => {
          details.set(t, { name: res.customerName, time: res.time, end: endTimeStr });
        });
      }
    });

    const slotLabel = `${form.date} ${form.time} ~ ${minutesToTime(endMins)}`;
    return { occupiedTableDetails: details, selectedTimeSlotLabel: slotLabel };
  }, [isModalOpen, form.date, form.time, form.duration, reservations, editingReservation]);

  const filteredReservations = useMemo(() => {
    const s = searchTerm.toLowerCase();
    return reservations.filter(r => 
      (r.customerName && r.customerName.toLowerCase().includes(s)) || 
      (r.phone && r.phone.includes(s)) || 
      (r.table && r.table.includes(s))
    );
  }, [reservations, searchTerm]);

  const groupedRes = useMemo(() => {
    const sorted = [...filteredReservations].sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      return a.time.localeCompare(b.time);
    });

    return sorted.reduce((acc: any, res) => {
      acc[res.date] = acc[res.date] || [];
      acc[res.date].push(res);
      return acc;
    }, {});
  }, [filteredReservations]);

  const sortedDates = useMemo(() => 
    Object.keys(groupedRes).sort((a, b) => a.localeCompare(b)), 
    [groupedRes]
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row overflow-x-hidden">
      <div className="md:hidden bg-white border-b px-6 py-4 flex justify-between items-center sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-2">
          <ChefHat className="w-6 h-6 text-orange-600" />
          <span className="font-black text-lg">BakeryOS</span>
        </div>
        <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 bg-slate-50 rounded-xl"><Menu className="w-6 h-6 text-slate-600" /></button>
      </div>

      <Sidebar currentView={currentView} onChangeView={setCurrentView} isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />
      
      <main className="flex-1 md:ml-64 p-5 md:p-12 h-screen overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto pb-24">
          {currentView === AppView.RESERVATIONS ? (
            <div className="space-y-6">
              {/* 狀態列 */}
              {syncError && (
                <div className="bg-rose-600 text-white px-6 py-3 rounded-2xl flex items-center justify-between shadow-lg animate-bounce">
                  <div className="flex items-center gap-3">
                    <WifiOff className="w-5 h-5" />
                    <span className="font-black text-sm">{syncError}</span>
                  </div>
                  <button onClick={() => handleSyncAll()} className="p-1 hover:bg-white/20 rounded-lg"><RefreshCw className="w-4 h-4" /></button>
                </div>
              )}

              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-3">
                  <h1 className="text-3xl font-black text-slate-800 tracking-tight">訂位看板</h1>
                  <div className="flex flex-wrap gap-2">
                    {dataSources.map(ds => (
                      <span key={ds.id} className="text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full border border-emerald-200 shadow-sm">
                        {ds.name} • 已連線
                      </span>
                    ))}
                  </div>
                </div>
                <button onClick={() => handleSyncAll()} disabled={syncingAll} className="p-3 bg-white border rounded-2xl text-xs font-black shadow-sm flex items-center gap-2 active:scale-95 disabled:opacity-50 hover:bg-slate-50 transition-all">
                  {syncingAll ? <Loader2 className="animate-spin w-4 h-4 text-orange-500" /> : <RefreshCw className="text-orange-600 w-4 h-4" />}
                  {syncingAll ? '雲端同步中...' : '手動重新整理'}
                </button>
              </div>

              {/* 頂部：即時桌況摘要 */}
              <div className="bg-white rounded-[32px] border border-slate-200 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-5 h-5 text-indigo-500" />
                    <h3 className="text-sm font-black text-slate-800">
                      即時桌況摘要 <span className="text-slate-400 font-bold ml-1">({new Date().toLocaleTimeString('zh-TW', {hour:'2-digit', minute:'2-digit'})})</span>
                    </h3>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div><span className="text-[10px] font-bold text-slate-500">空閒</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-rose-500"></div><span className="text-[10px] font-bold text-slate-500">使用中</span></div>
                  </div>
                </div>
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2">
                  {TABLE_OPTIONS.map(t => {
                    const occ = currentOccupancy.get(t);
                    return (
                      <div key={t} className={`p-2 rounded-xl text-center border transition-all ${occ ? 'bg-rose-50 border-rose-200 text-rose-600' : 'bg-emerald-50 border-emerald-200 text-emerald-600'}`}>
                        <div className="text-[10px] font-black">{t}</div>
                        <div className="text-[8px] font-bold mt-0.5 truncate">{occ ? occ.name : 'FREE'}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <AnalysisCard type="RESERVATIONS" data={filteredReservations.slice(0, 100)} />

              <div className="sticky top-0 bg-slate-50/80 backdrop-blur-md pt-2 pb-4 z-20">
                <div className="relative">
                  <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="搜尋姓名、電話、桌號..." className="w-full pl-12 pr-4 py-4 border-none rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 bg-white font-medium" />
                </div>
              </div>

              <div className="space-y-10">
                {sortedDates.length === 0 && !syncingAll && (
                  <div className="py-20 text-center text-slate-400">
                    <Inbox className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p className="font-black text-lg">尚無訂位資料</p>
                    <p className="text-sm font-bold opacity-60">點擊右下角按鈕新增一筆。</p>
                  </div>
                )}
                {sortedDates.map(date => (
                  <div key={date}>
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-lg font-black text-slate-800">{new Date(date).toLocaleDateString('zh-TW', {month: 'numeric', day: 'numeric', weekday: 'short'})}</h2>
                      <div className="h-px flex-1 bg-slate-200"></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {groupedRes[date].map((res: Reservation) => (
                        <div key={res.id} className={`p-6 rounded-[32px] shadow-sm border relative group transition-all hover:shadow-md ${res.type === '包場' ? 'bg-rose-50 border-rose-200 text-rose-900 shadow-rose-100' : res.type === '外帶' ? 'bg-sky-50 border-sky-200 text-sky-900 shadow-sky-100' : 'bg-white border-slate-100 text-slate-800'}`}>
                          <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleOpenEdit(res)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors"><Pencil className="w-4 h-4 text-slate-600" /></button>
                            <button onClick={() => handleDeleteReservation(res)} className="p-2 hover:bg-rose-200 text-rose-500 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                          </div>
                          <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center gap-2">
                                <span className={`font-black px-3 py-1.5 rounded-xl text-xs shadow-sm ${res.type === '包場' ? 'bg-rose-200' : 'bg-slate-100'}`}>{res.time}</span>
                                {res.syncStatus === 'pending' && <Loader2 className="w-3 h-3 animate-spin text-orange-500" />}
                            </div>
                            <span className="text-[9px] font-black uppercase tracking-widest bg-black/5 px-2 py-1 rounded-md">
                              {res.type}
                            </span>
                          </div>
                          <h3 className="font-black text-xl mb-1 flex items-center gap-2">
                            {res.customerName}
                            {res.type === '包場' && <ShieldAlert className="w-4 h-4 text-rose-500" />}
                          </h3>
                          <div className="flex items-center gap-1.5 text-xs font-bold mb-4 opacity-70"><Phone className="w-3 h-3" /> {res.phone || '無電話紀錄'}</div>
                          
                          {res.notes && (
                            <div className="mb-4 p-3 rounded-2xl bg-black/5 text-sm font-medium leading-relaxed italic border-l-4 border-orange-400">
                              「{res.notes}」
                            </div>
                          )}

                          <div className="pt-4 border-t border-black/5 flex justify-between items-center">
                            <div className="flex items-center gap-2 font-black text-base"><Users className="w-5 h-5 opacity-40" /> {res.pax} 位 ({res.duration || 90}m)</div>
                            <div className={`text-base font-black px-4 py-2 rounded-2xl shadow-lg ${res.type === '包場' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>{res.table || '待排'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => { setEditingReservation(null); setForm({ date: new Date().toISOString().split('T')[0], time: '12:00', pax: 2, type: '內用', customerName: '', phone: '', table: '', notes: '', creator: CREATOR_OPTIONS[0], duration: 90 }); setSelectedTables([]); setIsModalOpen(true); }} className="fixed bottom-8 right-8 w-16 h-16 bg-orange-600 text-white rounded-3xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 z-40 transition-transform shadow-orange-200"><Plus className="w-10 h-10" /></button>
            </div>
          ) : (
             <div className="space-y-8">
               <div className="p-10 bg-slate-900 rounded-[40px] text-white shadow-2xl relative overflow-hidden">
                  <h1 className="text-4xl font-black relative z-10">資料同步中心</h1>
                  <p className="text-slate-400 mt-2 relative z-10 font-bold">在此連結 Google 試算表，實現雲端數據串接。</p>
                  <div className="absolute bottom-0 right-0 p-6 opacity-20"><Layers className="w-32 h-32" /></div>
               </div>
               <div className="grid grid-cols-1 gap-4">
                 {dataSources.map(ds => (
                   <div key={ds.id} className="bg-white rounded-[32px] shadow-sm border p-6 flex items-center justify-between group">
                      <div className="flex items-center gap-4">
                         <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600"><Database className="w-6 h-6" /></div>
                         <div><h3 className="font-black text-slate-800 text-lg">{ds.name}</h3><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{ds.lastUpdated}</p></div>
                      </div>
                      <button onClick={() => setDataSources(prev => prev.filter(s => s.id !== ds.id))} className="p-4 text-slate-300 hover:text-rose-500 rounded-2xl transition-all"><Unlink className="w-6 h-6" /></button>
                   </div>
                 ))}
               </div>
               <div className="bg-white rounded-[40px] shadow-xl border p-8 space-y-6">
                  <h3 className="font-black text-slate-800 text-xl flex items-center gap-2"><Globe className="text-orange-600" /> 連結新資料源</h3>
                  <div className="space-y-4">
                    <input type="text" value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="名稱 (例: 分店1)" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                    <input type="text" value={newUrl} onChange={(e)=>setNewUrl(e.target.value)} placeholder="CSV 匯出連結" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                    <input type="text" value={newWriteUrl} onChange={(e)=>setNewWriteUrl(e.target.value)} placeholder="Apps Script API 連結" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                  </div>
                  <button onClick={handleAddSource} disabled={loadingSource} className="w-full bg-slate-900 text-white py-5 rounded-3xl font-black text-lg transition-all active:scale-95 disabled:opacity-50">
                    {loadingSource ? <Loader2 className="animate-spin inline mr-2" /> : '立即連結'}
                  </button>
               </div>
            </div>
          )}
        </div>
      </main>

      {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl" onClick={() => !isSyncingToCloud && setIsModalOpen(false)}></div>
              <div className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl relative z-10 overflow-hidden animate-in zoom-in duration-200">
                  <div className="bg-orange-600 p-6 text-white flex justify-between items-center">
                    <h2 className="text-xl font-black">{editingReservation ? '修改訂位內容' : '快速新增訂位'}</h2>
                    <button onClick={() => !isSyncingToCloud && setIsModalOpen(false)} className="p-2 hover:bg-orange-700 rounded-xl transition-colors"><X className="w-7 h-7" /></button>
                  </div>
                  <div className="p-8 space-y-6 max-h-[85vh] overflow-y-auto custom-scrollbar">
                      <div className="grid grid-cols-2 gap-4">
                        <select value={form.creator} onChange={e => setForm({...form, creator: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500">{CREATOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}</select>
                        <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500">{TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}</select>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="col-span-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase mb-1 block">日期</label>
                          <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none text-sm" />
                        </div>
                        <div className="col-span-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase mb-1 block">時間</label>
                          <input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none text-sm" />
                        </div>
                        <div className="col-span-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase mb-1 block">時長 (分)</label>
                          <select value={form.duration} onChange={e => setForm({...form, duration: parseInt(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none text-sm focus:ring-2 focus:ring-orange-500">
                            {DURATION_OPTIONS.map(d => <option key={d} value={d}>{d} 分鐘</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <input type="text" value={form.customerName} onChange={e => setForm({...form, customerName: e.target.value})} placeholder="顧客姓名" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none" />
                        <input type="number" value={form.pax} onChange={e => setForm({...form, pax: parseInt(e.target.value) || 1})} placeholder="人數" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none" />
                      </div>
                      <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="聯絡電話" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" />
                      
                      {/* Modal 內時段桌況預覽 */}
                      <div className="space-y-4 pt-4 border-t border-slate-100">
                        <div className="flex flex-col gap-2">
                          <div className="flex justify-between items-center">
                            <label className="text-sm font-black text-slate-800 flex items-center gap-2">
                              <Monitor className="w-4 h-4 text-orange-500" /> 所選時段桌況預覽
                            </label>
                            <div className="flex gap-2">
                              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div><span className="text-[9px] font-bold text-slate-400">可訂</span></div>
                              <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-rose-500"></div><span className="text-[9px] font-bold text-slate-400">已佔</span></div>
                            </div>
                          </div>
                          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs">
                              <CalendarDays className="w-3.5 h-3.5" />
                              {selectedTimeSlotLabel}
                            </div>
                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">系統自動計算衝突中</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {TABLE_OPTIONS.map(t => {
                            const occData = occupiedTableDetails.get(t);
                            const isOccupied = !!occData;
                            const isSelected = selectedTables.includes(t);
                            return (
                              <button key={t} onClick={() => !isOccupied && setSelectedTables(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t])} disabled={isOccupied} className={`py-4 rounded-2xl border flex flex-col items-center justify-center transition-all relative ${
                                isSelected ? 'bg-indigo-600 text-white border-indigo-700 shadow-lg scale-105 z-10' : 
                                isOccupied ? 'bg-rose-50 text-rose-800 border-rose-200 cursor-not-allowed opacity-90' : 
                                'bg-emerald-50 text-emerald-800 border-emerald-200 hover:border-emerald-400 hover:scale-[1.02]'
                              }`}>
                                <span className={`text-xs font-black ${isSelected ? 'text-white' : ''}`}>{t}</span>
                                {isOccupied && (
                                  <>
                                    <span className="text-[8px] font-black mt-1 uppercase text-rose-500 bg-white/80 px-1 rounded-sm max-w-[90%] truncate">{occData.name}</span>
                                    <span className="text-[8px] font-bold mt-0.5 opacity-60">~{occData.end}</span>
                                  </>
                                )}
                                {isSelected && <Check className="w-3 h-3 absolute top-2 right-2 text-indigo-300" />}
                                {!isOccupied && !isSelected && <span className="text-[8px] font-bold mt-1 opacity-40">FREE</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none min-h-[100px] focus:ring-2 focus:ring-orange-500" placeholder="備註特殊需求..."></textarea>
                      <button onClick={handleSaveReservation} disabled={isSyncingToCloud} className="w-full bg-slate-900 text-white py-5 rounded-[28px] font-black text-lg flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50 transition-all shadow-xl">
                        {isSyncingToCloud ? <Loader2 className="w-6 h-6 animate-spin text-orange-500" /> : <Save className="w-6 h-6" />}
                        {isSyncingToCloud ? '正在同步雲端數據...' : '確認儲存並同步'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

export default App;
