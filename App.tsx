
import React, { useState, useEffect, useMemo } from 'react';
import { Search, Link as LinkIcon, Plus, Trash2, Phone, Calendar as CalendarIcon, Menu, ChefHat, Users, Inbox, RefreshCw, Loader2, X, Save, Globe, FileSpreadsheet, Database, ClipboardList, CheckCircle2, AlertCircle, Info, UserCheck, MessageSquare, Clock, ShieldAlert, CheckCircle, Ban, CalendarDays, Pencil, ExternalLink, MapPin, Unlink } from 'lucide-react';
import Sidebar from './components/Sidebar';
import AnalysisCard from './components/AnalysisCard';
import { AppView, Reservation, DataSource } from './types';
import { mapReservationsCSVAsync, fetchCsvStreaming } from './services/dataProcessor';

const STORAGE_KEY_RESERVATIONS = 'bakery_reservations';
const STORAGE_KEY_SOURCES = 'bakery_sources';

const TABLE_OPTIONS = ['綠1', '綠2', '綠3', '綠4', '綠5', '白1', '白2a', '白2b', '白3', '白4a', '白4b', '白5'];
const CREATOR_OPTIONS = ['沈家杭', 'TAKA'];
const TYPE_OPTIONS = ['內用', '外帶', '包場'];

function App() {
  const [currentView, setCurrentView] = useState<AppView>(AppView.RESERVATIONS);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSyncingToCloud, setIsSyncingToCloud] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  
  // 核心緩衝機制：防止雲端同步覆蓋掉剛改好的本地數據
  const [localModifiedBuffer, setLocalModifiedBuffer] = useState<Map<string, Reservation>>(new Map());
  // 黑名單存儲：name_date_time 格式
  const [syncBlacklist, setSyncBlacklist] = useState<string[]>([]); 
  
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
    time: '12:00', pax: 2, type: '內用', customerName: '', phone: '', table: '', notes: '', creator: CREATOR_OPTIONS[0]
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

  // 取得當前有效的 Sheet 連結與顯示資訊
  const activeSource = useMemo(() => dataSources[0], [dataSources]);
  const sheetEditUrl = useMemo(() => {
    if (!activeSource?.url) return '#';
    if (activeSource.url.includes('/export')) return activeSource.url.split('/export')[0];
    if (activeSource.url.includes('/pub')) return activeSource.url.split('/pub')[0];
    return activeSource.url;
  }, [activeSource]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(reservations.slice(0, 500)));
  }, [reservations]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SOURCES, JSON.stringify(dataSources));
  }, [dataSources]);

  const timeToMinutes = (timeStr: string) => {
    if (!timeStr) return 0;
    const [hrs, mins] = timeStr.split(':').map(Number);
    return hrs * 60 + (mins || 0);
  };

  // 進階桌位狀態分析：提供詳細的佔用者姓名與時間
  const { occupiedTableDetails } = useMemo(() => {
    if (!isModalOpen || !form.date || !form.time) return { occupiedTableDetails: new Map<string, {name: string, time: string}>() };
    const currentSource = activeSource;
    const duration = currentSource?.diningDuration || 90;
    const startMins = timeToMinutes(form.time);
    const endMins = startMins + duration;

    const details = new Map<string, {name: string, time: string}>();
    reservations.forEach(res => {
      if (res.id === editingReservation?.id) return; 
      if (res.date !== form.date) return;
      const resStart = timeToMinutes(res.time);
      const resDuration = activeSource?.diningDuration || 90;
      const resEnd = resStart + resDuration;

      const isConflict = (startMins < resEnd) && (endMins > resStart);
      if (isConflict) {
        const tables = (res.table || '').split(', ').filter(Boolean);
        tables.forEach(t => details.set(t, { name: res.customerName, time: res.time }));
      }
    });

    return { occupiedTableDetails: details };
  }, [isModalOpen, form.date, form.time, reservations, activeSource, editingReservation]);

  const syncToGoogleSheet = async (payload: any) => {
    if (!activeSource?.writeUrl) return false;
    try {
      await fetch(activeSource.writeUrl.trim(), {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      return true;
    } catch (e) {
      console.error("Sync Error:", e);
      return false;
    }
  };

  const handleSyncAll = async (isSilent = false) => {
    if (dataSources.length === 0) return;
    if (!isSilent) { setSyncingAll(true); setSyncProgress(1); }
    try {
        let allRemote: Reservation[] = [];
        for (const source of dataSources) {
            const csvText = await fetchCsvStreaming(source.url, () => {});
            const remoteData = await mapReservationsCSVAsync(csvText, source.id, (p) => {
                if (!isSilent) setSyncProgress(p);
            });
            allRemote = [...allRemote, ...remoteData];
        }

        setReservations(prev => {
          const processedRemote = allRemote.filter(r => {
            // 1. 檢查黑名單 (已刪除) - 格式: name_date_time
            const signature = `${r.customerName.trim()}_${r.date}_${r.time.substring(0,5)}`;
            if (syncBlacklist.includes(signature)) return false;

            // 2. 檢查修改緩衝區
            const buffered = localModifiedBuffer.get(signature);
            if (buffered) {
              const isConsistent = buffered.pax === r.pax && buffered.table === r.table && buffered.notes === r.notes;
              if (!isConsistent) return false; 
            }
            return true;
          });

          const localOnly = prev.filter(p => p.isLocal && !processedRemote.some(r => r.customerName === p.customerName && r.date === p.date && r.time === p.time));
          return [...localOnly, ...processedRemote];
        });
        
        setDataSources(prev => prev.map(s => ({...s, lastUpdated: new Date().toLocaleString()})));
    } catch (e) { 
        if (!isSilent) console.error("Sync Failed", e);
    } finally { 
        if (!isSilent) { setSyncingAll(false); setSyncProgress(0); }
    }
  };

  const handleSaveReservation = async () => {
    if (!form.customerName || !form.date) return alert('請填寫姓名與日期');
    if (selectedTables.length === 0) return alert('請選擇桌號');

    setIsSyncingToCloud(true);
    const tableString = selectedTables.sort().join(', ');
    const now = Date.now();
    
    const resPayload: Reservation = { 
      id: editingReservation ? editingReservation.id : `local-${now}`,
      customerName: (form.customerName || '').trim(),
      date: form.date || '',
      time: form.time || '12:00',
      pax: Number(form.pax) || 1,
      type: form.type || '內用',
      phone: form.phone || '',
      table: tableString,
      notes: form.notes || '',
      creator: form.creator || CREATOR_OPTIONS[0],
      isLocal: true,
      syncStatus: 'pending',
      sourceId: activeSource?.id
    };

    let oldInfo = null;
    const signature = `${resPayload.customerName.trim()}_${resPayload.date}_${resPayload.time.substring(0,5)}`;

    if (editingReservation) {
      oldInfo = { 
        name: editingReservation.customerName.trim(), 
        date: editingReservation.date, 
        time: editingReservation.time.substring(0, 5) 
      };
      setLocalModifiedBuffer(prev => new Map(prev).set(signature, resPayload));
      setReservations(prev => prev.map(r => r.id === editingReservation.id ? resPayload : r));
    } else {
      setReservations(prev => [resPayload, ...prev]);
    }

    const success = await syncToGoogleSheet({
      action: editingReservation ? 'update' : 'create',
      oldName: oldInfo?.name,
      oldDate: oldInfo?.date,
      oldTime: oldInfo?.time,
      ...resPayload
    });
    
    if (success) {
      setReservations(prev => prev.map(r => r.id === resPayload.id ? { ...r, syncStatus: 'synced' } : r));
      setTimeout(() => handleSyncAll(true), 3000);
    }
    
    setIsSyncingToCloud(false);
    setIsModalOpen(false);
    setEditingReservation(null);
    setSelectedTables([]);
  };

  const handleDeleteReservation = async (res: Reservation) => {
    if (!confirm(`確定要徹底刪除「${res.customerName}」嗎？\n此動作將會同步刪除試算表內容。`)) return;
    
    const signature = `${res.customerName.trim()}_${res.date}_${res.time.substring(0,5)}`;
    
    // 進入黑名單防止重新抓取
    setSyncBlacklist(prev => [...prev, signature]);
    setReservations(prev => prev.filter(r => r.id !== res.id));
    
    setIsSyncingToCloud(true);
    const success = await syncToGoogleSheet({ 
      action: 'delete', 
      oldName: res.customerName.trim(), 
      oldDate: res.date, 
      oldTime: res.time.substring(0,5),
      phone: res.phone
    });
    setIsSyncingToCloud(false);

    if (success) {
      // 給予緩衝時間，等 Sheet 完成
      setTimeout(() => handleSyncAll(true), 4000);
      // 15 分鐘後解除黑名單
      setTimeout(() => setSyncBlacklist(prev => prev.filter(sig => sig !== signature)), 900000);
    } else {
      alert("Sheet 同步刪除失敗，請檢查 Apps Script 是否正常運行。");
    }
  };

  const handleOpenEdit = (res: Reservation) => {
    setEditingReservation(res);
    setForm({
      date: res.date,
      time: res.time,
      pax: res.pax,
      type: res.type,
      customerName: res.customerName,
      phone: res.phone,
      table: res.table,
      notes: res.notes,
      creator: res.creator
    });
    setSelectedTables((res.table || '').split(', ').filter(Boolean));
    setIsModalOpen(true);
  };

  const handleRemoveDataSource = () => {
    if (!confirm('確定要斷開與此 Google Sheet 的連線嗎？這將會清除目前的同步資料。')) return;
    setDataSources([]);
    setReservations([]);
    localStorage.removeItem(STORAGE_KEY_RESERVATIONS);
    localStorage.removeItem(STORAGE_KEY_SOURCES);
  };

  const handleTableToggle = (table: string) => {
    if (occupiedTableDetails.has(table)) return;
    setSelectedTables(prev => prev.includes(table) ? prev.filter(t => t !== table) : [...prev, table]);
  };

  const filteredReservations = useMemo(() => {
    const s = searchTerm.toLowerCase();
    return reservations.filter(r => (r.customerName && r.customerName.toLowerCase().includes(s)) || (r.phone && r.phone.includes(s)));
  }, [reservations, searchTerm]);

  const groupedRes = useMemo(() => {
    return filteredReservations.reduce((acc: any, res) => {
      acc[res.date] = acc[res.date] || [];
      acc[res.date].push(res);
      return acc;
    }, {});
  }, [filteredReservations]);

  const sortedDates = useMemo(() => Object.keys(groupedRes).sort((a, b) => new Date(a).getTime() - new Date(b).getTime()), [groupedRes]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row overflow-x-hidden">
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b px-6 py-4 flex justify-between items-center sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-2">
          <ChefHat className="w-6 h-6 text-orange-600" />
          <span className="font-black text-lg">BakeryOS</span>
        </div>
        <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 bg-slate-50 rounded-xl"><Menu className="w-6 h-6 text-slate-600" /></button>
      </div>

      <Sidebar currentView={currentView} onChangeView={setCurrentView} isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />
      
      <main className="flex-1 md:ml-64 p-5 md:p-12 h-screen overflow-y-auto custom-scrollbar">
        <div className="max-w-4xl mx-auto">
          {currentView === AppView.RESERVATIONS ? (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-3">
                  <h1 className="text-3xl font-black text-slate-800 tracking-tight">訂位管理戰情室</h1>
                  {activeSource && (
                    <div className="flex flex-wrap items-center gap-2">
                      <a href={sheetEditUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-white font-bold text-xs bg-emerald-600 hover:bg-emerald-700 px-4 py-2 rounded-2xl shadow-sm transition-all group border border-emerald-500/20">
                        <FileSpreadsheet className="w-4 h-4" />
                        已連線：{activeSource.name}
                        <ExternalLink className="w-3 h-3 opacity-70 group-hover:opacity-100" />
                      </a>
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-2">
                        最後同步：{activeSource.lastUpdated}
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={() => handleSyncAll()} disabled={syncingAll} className="p-3 bg-white border rounded-2xl text-xs font-black shadow-sm flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50 min-w-[120px]">
                  {syncingAll ? <Loader2 className="w-4 h-4 animate-spin text-orange-600" /> : <RefreshCw className="w-4 h-4 text-orange-600" />}
                  重新整理
                </button>
              </div>

              <AnalysisCard type="RESERVATIONS" data={filteredReservations.slice(0, 100)} />

              <div className="sticky top-0 bg-slate-50/80 backdrop-blur-md pt-2 pb-4 z-20">
                <div className="relative">
                  <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="搜尋顧客姓名或電話..." className="w-full pl-12 pr-4 py-4 border-none rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 bg-white font-medium" />
                </div>
              </div>

              <div className="space-y-10">
                {sortedDates.length === 0 && !syncingAll && (
                  <div className="py-20 text-center flex flex-col items-center gap-4 text-slate-300">
                    <Inbox className="w-16 h-16" />
                    <p className="font-bold">目前無訂位紀錄，請確認資料來源設定。</p>
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
                        <div key={res.id} className={`p-6 rounded-[32px] shadow-sm border relative transition-all group ${res.type === '包場' ? 'bg-rose-50 border-rose-200 text-rose-900' : res.type === '外帶' ? 'bg-sky-50 border-sky-200 text-sky-900' : 'bg-[#FAF7F2] border-[#E5DACE] text-[#5C4D3C]'}`}>
                          <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleOpenEdit(res)} className="p-2 hover:bg-white/50 rounded-lg"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => handleDeleteReservation(res)} className="p-2 hover:bg-rose-100/50 text-rose-400 hover:text-rose-600 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                          </div>
                          <div className="flex justify-between items-center mb-4">
                            <span className="font-black px-3 py-1.5 rounded-xl text-xs bg-white/60 shadow-sm">{res.time}</span>
                            <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{res.type}</span>
                          </div>
                          <h3 className="font-black text-xl mb-1">{res.customerName}</h3>
                          <div className="flex items-center gap-1.5 text-xs font-bold mb-4 opacity-70"><Phone className="w-3 h-3" /> {res.phone || '無電話'}</div>
                          
                          {res.notes && (
                            <div className="mb-4 p-3 rounded-2xl bg-black/5 flex items-start gap-2 text-sm font-medium">
                              <MessageSquare className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-50" />
                              <span className="line-clamp-3">{res.notes}</span>
                            </div>
                          )}

                          <div className="pt-4 border-t border-black/5 flex justify-between items-center">
                            <div className="flex items-center gap-2 font-black text-base">
                              <Users className="w-5 h-5 opacity-40" /> 
                              {res.pax}位 <span className="text-sm font-bold opacity-30">/</span> {res.creator || '系統'}
                            </div>
                            <div className="text-base font-black px-4 py-2 rounded-2xl bg-white shadow-sm border border-black/5">
                              {res.table || '未排'}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => { setEditingReservation(null); setForm({ ...form, customerName: '', phone: '', notes: '', table: '', pax: 2 }); setSelectedTables([]); setIsModalOpen(true); }} className="fixed bottom-8 right-8 w-16 h-16 bg-orange-600 text-white rounded-3xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 z-40 transition-transform shadow-orange-500/40"><Plus className="w-10 h-10" /></button>
            </div>
          ) : (
             <div className="space-y-8 max-w-4xl mx-auto">
               <div className="p-10 bg-slate-900 rounded-[40px] text-white shadow-2xl relative overflow-hidden">
                  <h1 className="text-4xl font-black relative z-10">資料來源設定</h1>
                  <p className="text-slate-400 mt-2 relative z-10 font-bold">設定 Google 試算表 CSV 匯出連結與 Apps Script。</p>
                  <div className="absolute bottom-0 right-0 p-6 opacity-20"><FileSpreadsheet className="w-32 h-32" /></div>
               </div>

               {activeSource && (
                 <div className="bg-white rounded-[40px] shadow-xl border p-8 flex flex-col md:flex-row items-center justify-between gap-6 border-emerald-100">
                    <div className="flex items-center gap-5">
                       <div className="w-16 h-16 bg-emerald-50 rounded-[24px] flex items-center justify-center text-emerald-600">
                          <CheckCircle2 className="w-10 h-10" />
                       </div>
                       <div>
                          <h3 className="text-xl font-black text-slate-800">當前已連線至：{activeSource.name}</h3>
                          <p className="text-slate-400 text-sm font-medium">您可以隨時斷開連線以重新配置其他試算表。</p>
                       </div>
                    </div>
                    <button onClick={handleRemoveDataSource} className="w-full md:w-auto px-8 py-4 bg-rose-50 text-rose-600 rounded-3xl font-black flex items-center justify-center gap-2 hover:bg-rose-100 transition-all border border-rose-100">
                       <Unlink className="w-5 h-5" /> 移除連線功能
                    </button>
                 </div>
               )}

               {!activeSource && (
                 <div className="bg-white rounded-[40px] shadow-xl border p-8 space-y-6">
                    <h3 className="font-black text-slate-800 text-xl flex items-center gap-2"><Globe className="text-orange-600" /> 連線新試算表</h3>
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">試算表名稱</label>
                        <input type="text" value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="例: 忠孝店、本月訂位" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">CSV 下載網址 (需公開為 CSV 或匯出連結)</label>
                        <input type="text" value={newUrl} onChange={(e)=>setNewUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">Apps Script 寫入網址 (需包含 /exec)</label>
                        <input type="text" value={newWriteUrl} onChange={(e)=>setNewWriteUrl(e.target.value)} placeholder="https://script.google.com/macros/s/.../exec" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">預設用餐時間 (分鐘)</label>
                        <input type="number" value={newDuration} onChange={(e)=>setNewDuration(parseInt(e.target.value) || 90)} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                      </div>
                    </div>
                    <button onClick={() => {
                        if (!newUrl || !newWriteUrl) return alert("請填寫完整的 CSV 與 寫入網址");
                        setLoadingSource(true);
                        const sId = Date.now().toString();
                        fetchCsvStreaming(newUrl, () => {}).then(csv => mapReservationsCSVAsync(csv, sId)).then(data => {
                            setDataSources([{ id: sId, name: newName || '預設店鋪', url: newUrl, writeUrl: newWriteUrl, type: 'RESERVATIONS', lastUpdated: new Date().toLocaleString(), status: 'ACTIVE', diningDuration: newDuration }]);
                            setReservations(data);
                            setCurrentView(AppView.RESERVATIONS);
                        }).catch(err => alert("連線失敗，請檢查網址權限與格式"))
                        .finally(() => setLoadingSource(false));
                    }} disabled={loadingSource} className="w-full bg-orange-600 text-white py-5 rounded-3xl font-black text-lg transition-all active:scale-95 disabled:opacity-50 shadow-xl shadow-orange-500/20">
                      {loadingSource ? <Loader2 className="animate-spin inline mr-2" /> : '建立雲端同步連結'}
                    </button>
                 </div>
               )}
            </div>
          )}
        </div>
      </main>

      {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl" onClick={() => !isSyncingToCloud && setIsModalOpen(false)}></div>
              <div className="bg-white w-full max-w-2xl rounded-[40px] shadow-2xl relative z-10 overflow-hidden animate-in zoom-in duration-200 border border-white/20">
                  <div className="bg-orange-600 p-6 text-white flex justify-between items-center">
                    <h2 className="text-xl font-black">{editingReservation ? '編輯訂位細節' : '快速新增預約'}</h2>
                    <button onClick={() => !isSyncingToCloud && setIsModalOpen(false)} className="hover:rotate-90 transition-transform"><X className="w-7 h-7" /></button>
                  </div>
                  <div className="p-8 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">填單管理員</label>
                          <select value={form.creator} onChange={e => setForm({...form, creator: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500 cursor-pointer">
                            {CREATOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">訂單類型</label>
                          <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500 cursor-pointer">
                            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                           <label className="text-[10px] font-black text-slate-400 uppercase ml-1">預約日期</label>
                           <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" />
                        </div>
                        <div className="space-y-1">
                           <label className="text-[10px] font-black text-slate-400 uppercase ml-1">預約時段</label>
                           <input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">顧客姓名</label>
                          <input type="text" value={form.customerName} onChange={e => setForm({...form, customerName: e.target.value})} placeholder="顧客稱呼" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">預計人數</label>
                          <input type="number" value={form.pax} onChange={e => setForm({...form, pax: parseInt(e.target.value) || 1})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">聯絡方式 (選填)</label>
                        <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="手機號碼" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" />
                      </div>
                      
                      <div className="space-y-4 pt-2">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">配置桌號</label>
                          <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md">當前：{form.time}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {TABLE_OPTIONS.map(t => {
                            const isOccupied = occupiedTableDetails.has(t);
                            const isSelected = selectedTables.includes(t);
                            return (
                              <button key={t} onClick={() => handleTableToggle(t)} disabled={isOccupied} className={`py-4 rounded-xl border flex flex-col items-center justify-center transition-all ${
                                isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md transform scale-105 z-10' : 
                                isOccupied ? 'bg-slate-100 text-slate-300 border-slate-50 cursor-not-allowed opacity-60' : 
                                'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-300 hover:bg-white'
                              }`}>
                                <span className="text-xs font-black">{t}</span>
                                {isOccupied && <span className="text-[7px] font-bold mt-1">BUSY</span>}
                              </button>
                            );
                          })}
                        </div>
                        
                        {occupiedTableDetails.size > 0 && (
                          <div className="bg-slate-50 rounded-[28px] p-6 border border-slate-100">
                             <p className="text-[10px] font-black text-slate-500 uppercase mb-4 flex items-center gap-2"><Clock className="w-3 h-3 text-rose-500" /> 桌位佔用明細 (衝突預警)</p>
                             <div className="space-y-3">
                               {Array.from(occupiedTableDetails.entries()).map(([table, detail]) => (
                                 <div key={table} className="flex justify-between items-center bg-white px-4 py-3 rounded-2xl shadow-sm border border-slate-100 group hover:border-rose-200 transition-colors">
                                    <div className="flex items-center gap-3">
                                       <span className="w-10 h-10 flex items-center justify-center bg-rose-50 text-rose-600 rounded-xl text-[11px] font-black">{table}</span>
                                       <div>
                                          <p className="text-[10px] font-black text-slate-400 uppercase">預定人</p>
                                          <p className="font-black text-slate-800 text-xs">{detail.name}</p>
                                       </div>
                                    </div>
                                    <div className="text-right">
                                       <p className="text-[10px] font-black text-slate-400 uppercase">預約時間</p>
                                       <span className="text-[11px] font-black text-rose-500">{detail.time}</span>
                                    </div>
                                 </div>
                               ))}
                             </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">特別需求備註</label>
                        <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none min-h-[100px] focus:ring-2 focus:ring-orange-500" placeholder="例如：慶生、輪椅、過敏需求..."></textarea>
                      </div>

                      <button onClick={handleSaveReservation} disabled={isSyncingToCloud} className="w-full bg-slate-900 text-white py-5 rounded-[28px] font-black text-lg flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50 transition-all shadow-xl shadow-slate-900/20">
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
