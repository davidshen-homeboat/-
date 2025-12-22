
import React, { useState, useEffect, useMemo } from 'react';
import { Search, Link as LinkIcon, Plus, Trash2, Phone, Calendar as CalendarIcon, Menu, ChefHat, Users, Inbox, RefreshCw, Loader2, X, Save, Globe, FileSpreadsheet, Database, ClipboardList, CheckCircle2, AlertCircle, Info, UserCheck, MessageSquare, Clock, ShieldAlert, CheckCircle, Ban, CalendarDays, Pencil, ExternalLink, MapPin } from 'lucide-react';
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
  const [syncBlacklist, setSyncBlacklist] = useState<string[]>([]); // 存儲已刪除的 ID
  
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

  // 取得當前有效的 Sheet 連結
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

  // 進階桌位狀態分析
  const { occupiedTableDetails } = useMemo(() => {
    if (!isModalOpen || !form.date || !form.time) return { occupiedTableDetails: new Map<string, {name: string, time: string}>() };
    const currentSource = editingReservation ? dataSources.find(s => s.id === editingReservation.sourceId) : dataSources[0];
    const duration = currentSource?.diningDuration || 90;
    const startMins = timeToMinutes(form.time);
    const endMins = startMins + duration;

    const details = new Map<string, {name: string, time: string}>();
    reservations.forEach(res => {
      if (res.id === editingReservation?.id) return; 
      if (res.date !== form.date) return;
      const resStart = timeToMinutes(res.time);
      const resSource = dataSources.find(s => s.id === res.sourceId);
      const resDuration = resSource?.diningDuration || 90;
      const resEnd = resStart + resDuration;

      const isConflict = (startMins < resEnd) && (endMins > resStart);
      if (isConflict) {
        const tables = (res.table || '').split(', ').filter(Boolean);
        tables.forEach(t => details.set(t, { name: res.customerName, time: res.time }));
      }
    });

    return { occupiedTableDetails: details };
  }, [isModalOpen, form.date, form.time, reservations, dataSources, editingReservation]);

  const syncToGoogleSheet = async (payload: any) => {
    const primarySource = dataSources.find(s => s.writeUrl && s.writeUrl.includes('/exec'));
    if (!primarySource?.writeUrl) return false;
    try {
      await fetch(primarySource.writeUrl.trim(), {
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
            // 1. 檢查黑名單 (已刪除)
            if (syncBlacklist.includes(r.id)) return false;

            // 2. 檢查修改緩衝區
            const key = `${r.customerName.trim()}_${r.date}_${r.time.substring(0,5)}`;
            const buffered = localModifiedBuffer.get(key);
            if (buffered) {
              const isConsistent = buffered.pax === r.pax && buffered.table === r.table && buffered.notes === r.notes;
              if (!isConsistent) return false; // 排除還沒更新成功的舊雲端資料
            }
            return true;
          });

          // 保留本地獨有的資料，並合併處理過的雲端資料
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
      sourceId: editingReservation?.sourceId || dataSources[0]?.id
    };

    let oldInfo = null;
    if (editingReservation) {
      oldInfo = { name: editingReservation.customerName.trim(), date: editingReservation.date, time: editingReservation.time.substring(0, 5) };
      const bufferKey = `${resPayload.customerName.trim()}_${resPayload.date}_${resPayload.time.substring(0,5)}`;
      setLocalModifiedBuffer(prev => new Map(prev).set(bufferKey, resPayload));
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
    if (!confirm(`確定要徹底刪除「${res.customerName}」嗎？\n此動作將同步刪除 Google Sheet 內容。`)) return;
    
    // 進入黑名單防止重新抓取
    setSyncBlacklist(prev => [...prev, res.id]);
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
      setTimeout(() => handleSyncAll(true), 4000);
      // 10 分鐘後解除黑名單
      setTimeout(() => setSyncBlacklist(prev => prev.filter(id => id !== res.id)), 600000);
    }
  };

  // 修正 handleOpenEdit 缺失的問題
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
    const tables = (res.table || '').split(', ').filter(Boolean);
    setSelectedTables(tables);
    setIsModalOpen(true);
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
              <div className="flex justify-between items-end">
                <div className="space-y-2">
                  <h1 className="text-2xl font-black text-slate-800 tracking-tight">訂位管理戰情室</h1>
                  {activeSource ? (
                    <a href={sheetEditUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-orange-600 hover:text-orange-700 font-bold text-xs bg-orange-50 px-3 py-1.5 rounded-xl border border-orange-100 w-fit transition-colors group">
                      <FileSpreadsheet className="w-4 h-4" />
                      已連結：{activeSource.name}
                      <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  ) : (
                    <div className="text-[10px] text-slate-400 font-black flex items-center gap-1"><AlertCircle className="w-3 h-3" /> 尚未設定資料來源</div>
                  )}
                </div>
                <button onClick={() => handleSyncAll()} disabled={syncingAll} className="p-3 bg-white border rounded-2xl text-xs font-black shadow-sm flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50">
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
                            <span className="font-black px-3 py-1.5 rounded-xl text-xs bg-white/60">{res.time}</span>
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
              <button onClick={() => { setEditingReservation(null); setForm({ ...form, customerName: '', phone: '', notes: '', table: '', pax: 2 }); setSelectedTables([]); setIsModalOpen(true); }} className="fixed bottom-8 right-8 w-16 h-16 bg-orange-600 text-white rounded-3xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 z-40 transition-transform"><Plus className="w-10 h-10" /></button>
            </div>
          ) : (
             <div className="space-y-8 max-w-4xl mx-auto">
               <div className="p-10 bg-slate-900 rounded-[40px] text-white shadow-2xl relative overflow-hidden">
                  <h1 className="text-4xl font-black relative z-10">資料來源設定</h1>
                  <p className="text-slate-400 mt-2 relative z-10 font-bold">設定 Google 試算表同步連結。</p>
               </div>
               <div className="bg-white rounded-[40px] shadow-xl border p-8 space-y-6">
                  <h3 className="font-black text-slate-800 text-xl flex items-center gap-2"><Globe className="text-orange-600" /> 連線設定</h3>
                  <div className="space-y-4">
                    <input type="text" value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="來源名稱 (例: 忠孝店)" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                    <input type="text" value={newUrl} onChange={(e)=>setNewUrl(e.target.value)} placeholder="Google Sheet CSV 下載網址" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                    <input type="text" value={newWriteUrl} onChange={(e)=>setNewWriteUrl(e.target.value)} placeholder="Apps Script 寫入網址 (/exec)" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">預設用餐時間 (分鐘)</label>
                      <input type="number" value={newDuration} onChange={(e)=>setNewDuration(parseInt(e.target.value) || 90)} placeholder="90" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                    </div>
                  </div>
                  <button onClick={() => {
                      setLoadingSource(true);
                      const sId = Date.now().toString();
                      fetchCsvStreaming(newUrl, () => {}).then(csv => mapReservationsCSVAsync(csv, sId)).then(data => {
                          setDataSources([{ id: sId, name: newName || '預設店鋪', url: newUrl, writeUrl: newWriteUrl, type: 'RESERVATIONS', lastUpdated: new Date().toLocaleString(), status: 'ACTIVE', diningDuration: newDuration }]);
                          setReservations(data);
                          setCurrentView(AppView.RESERVATIONS);
                      }).finally(() => setLoadingSource(false));
                  }} disabled={loadingSource} className="w-full bg-orange-600 text-white py-5 rounded-3xl font-black text-lg transition-all active:scale-95 disabled:opacity-50 shadow-xl">
                    {loadingSource ? <Loader2 className="animate-spin" /> : '儲存並同步資料'}
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
                    <h2 className="text-xl font-black">{editingReservation ? '編輯訂位資訊' : '填寫新預約'}</h2>
                    <button onClick={() => !isSyncingToCloud && setIsModalOpen(false)}><X className="w-7 h-7" /></button>
                  </div>
                  <div className="p-8 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">填單人</label>
                          <select value={form.creator} onChange={e => setForm({...form, creator: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500">
                            {CREATOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">預約類型</label>
                          <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500">
                            {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase ml-1">日期</label><input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none" /></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase ml-1">時間</label><input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none" /></div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">顧客姓名</label>
                          <input type="text" value={form.customerName} onChange={e => setForm({...form, customerName: e.target.value})} placeholder="顧客大名" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">訂位人數</label>
                          <input type="number" value={form.pax} onChange={e => setForm({...form, pax: parseInt(e.target.value) || 1})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none" />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">聯絡電話</label>
                        <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="聯絡電話" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none" />
                      </div>
                      
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">桌號分配 (點擊選取)</label>
                          <span className="text-[10px] font-bold text-orange-600">當前時段：{form.time}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {TABLE_OPTIONS.map(t => {
                            const isOccupied = occupiedTableDetails.has(t);
                            const isSelected = selectedTables.includes(t);
                            return (
                              <button key={t} onClick={() => handleTableToggle(t)} disabled={isOccupied} className={`py-3 rounded-xl border flex flex-col items-center justify-center transition-all ${
                                isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 
                                isOccupied ? 'bg-slate-100 text-slate-300 border-slate-50 cursor-not-allowed' : 
                                'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-300'
                              }`}>
                                <span className="text-[11px] font-black">{t}</span>
                                {isOccupied && <span className="text-[7px] font-bold">已預約</span>}
                              </button>
                            );
                          })}
                        </div>
                        
                        {occupiedTableDetails.size > 0 && (
                          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                             <p className="text-[10px] font-black text-slate-400 uppercase mb-3 flex items-center gap-1.5"><ShieldAlert className="w-3 h-3" /> 當前時段桌位狀態</p>
                             <div className="space-y-2">
                               {Array.from(occupiedTableDetails.entries()).map(([table, detail]) => (
                                 <div key={table} className="flex justify-between items-center bg-white px-3 py-2 rounded-xl shadow-sm border border-slate-50">
                                    <span className="font-black text-[11px] text-slate-700">{table}</span>
                                    <div className="flex items-center gap-3">
                                      <span className="text-[10px] font-bold text-slate-400">{detail.time}</span>
                                      <span className="text-[10px] font-black text-rose-500">{detail.name}</span>
                                    </div>
                                 </div>
                               ))}
                             </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">備註</label>
                        <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none min-h-[80px]"></textarea>
                      </div>

                      <button onClick={handleSaveReservation} disabled={isSyncingToCloud} className="w-full bg-slate-900 text-white py-5 rounded-[28px] font-black text-lg flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50 transition-all shadow-xl">
                        {isSyncingToCloud ? <Loader2 className="w-6 h-6 animate-spin text-orange-500" /> : <Save className="w-6 h-6" />}
                        {isSyncingToCloud ? '正在同步至 Google Sheet...' : '確認並儲存修改'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

export default App;
