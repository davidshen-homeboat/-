
import React, { useState, useEffect, useMemo } from 'react';
import { Search, Link as LinkIcon, Plus, Trash2, Phone, Calendar as CalendarIcon, Menu, ChefHat, Users, Inbox, RefreshCw, Loader2, X, Save, Globe, FileSpreadsheet, Database, ClipboardList, CheckCircle2, AlertCircle, Info, UserCheck, MessageSquare, Clock, ShieldAlert, CheckCircle, Ban, CalendarDays, Pencil } from 'lucide-react';
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
  
  // 緩衝區：存儲剛修改過的資料，直到雲端確認更新完成
  const [localModifiedBuffer, setLocalModifiedBuffer] = useState<Map<string, Reservation>>(new Map());
  const [syncBlacklist, setSyncBlacklist] = useState<{name: string, date: string, time: string}[]>([]);
  
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

  const { slotConflicts, occupiedTables } = useMemo(() => {
    if (!isModalOpen || !form.date || !form.time) return { slotConflicts: [], occupiedTables: new Set<string>() };
    const currentSource = editingReservation ? dataSources.find(s => s.id === editingReservation.sourceId) : dataSources[0];
    const duration = currentSource?.diningDuration || 90;
    const startMins = timeToMinutes(form.time);
    const endMins = startMins + duration;

    const conflicts = reservations.filter(res => {
      if (res.id === editingReservation?.id) return false; 
      if (res.date !== form.date) return false;
      const resStart = timeToMinutes(res.time);
      const resSource = dataSources.find(s => s.id === res.sourceId);
      const resDuration = resSource?.diningDuration || 90;
      const resEnd = resStart + resDuration;
      return (startMins < resEnd) && (endMins > resStart);
    });

    const occupied = new Set<string>();
    conflicts.forEach(c => {
      const tables = (c.table || '').split(', ').filter(Boolean);
      tables.forEach(t => occupied.add(t));
    });

    return { slotConflicts: conflicts, occupiedTables: occupied };
  }, [isModalOpen, form.date, form.time, reservations, dataSources, editingReservation]);

  const syncToGoogleSheet = async (payload: any) => {
    const primarySource = dataSources.find(s => s.writeUrl && s.writeUrl.includes('/exec'));
    if (!primarySource?.writeUrl) return false;
    try {
      const cleanUrl = primarySource.writeUrl.trim();
      await fetch(cleanUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      return true;
    } catch (e) {
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
          // 核心邏輯：過濾並處理緩衝區資料
          const newProcessedRemote = allRemote.filter(r => {
            // 1. 黑名單檢查 (已刪除的資料)
            const isBlacklisted = syncBlacklist.some(d => d.name === r.customerName.trim() && d.date === r.date && r.time.substring(0,5) === d.time);
            if (isBlacklisted) return false;

            // 2. 緩衝區檢查 (剛修改的資料)
            // 識別碼使用：姓名 + 日期 + 時間
            const key = `${r.customerName.trim()}_${r.date}_${r.time.substring(0,5)}`;
            const buffered = localModifiedBuffer.get(key);
            
            if (buffered) {
              // 如果雲端資料跟緩衝區的人數/桌號/備註還不一致，說明雲端還沒更新，排除這筆雲端資料
              const isConsistent = 
                buffered.pax === r.pax && 
                buffered.table === r.table && 
                buffered.notes === r.notes &&
                buffered.type === r.type &&
                buffered.phone === r.phone;
              
              if (!isConsistent) return false; // 排除不一致的雲端「舊」資料
            }
            return true;
          });

          // 獲取目前本地獨有的資料 (包含正在緩衝的)
          const currentLocalOnly = prev.filter(p => p.isLocal);
          
          // 合併：本地資料 + 處理後的雲端資料
          const merged = [...currentLocalOnly];
          newProcessedRemote.forEach(remote => {
            const exists = merged.some(m => 
              m.customerName.trim() === remote.customerName.trim() && 
              m.date === remote.date && 
              m.time.substring(0,5) === remote.time.substring(0,5)
            );
            if (!exists) merged.push(remote);
          });

          return merged;
        });
        
        setDataSources(prev => prev.map(s => ({...s, lastUpdated: new Date().toLocaleString()})));
    } catch (e) { 
        if (!isSilent) alert(`連線失敗 (400 或網路錯誤)`); 
    } finally { 
        if (!isSilent) { setSyncingAll(false); setSyncProgress(0); }
    }
  };

  const handleOpenEdit = (res: Reservation) => {
    setEditingReservation(res);
    setForm({
      customerName: res.customerName,
      date: res.date,
      time: res.time,
      pax: res.pax,
      type: res.type || TYPE_OPTIONS[0],
      phone: res.phone,
      notes: res.notes,
      creator: res.creator || CREATOR_OPTIONS[0]
    });
    setSelectedTables((res.table || '').split(', ').filter(Boolean));
    setIsModalOpen(true);
  };

  const handleSaveReservation = async () => {
    if (!form.customerName || !form.date) return alert('請填寫姓名與日期');
    if (selectedTables.length === 0) return alert('請選擇桌號');

    setIsSyncingToCloud(true);
    const tableString = selectedTables.sort().join(', ');
    const now = Date.now();
    
    // 建立新資料物件
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
      oldInfo = { 
        name: editingReservation.customerName.trim(), 
        date: editingReservation.date, 
        time: editingReservation.time.substring(0, 5) 
      };
      
      // 更新緩衝區：讓 App 知道這筆資料處於「更新中」狀態
      const bufferKey = `${resPayload.customerName.trim()}_${resPayload.date}_${resPayload.time.substring(0,5)}`;
      setLocalModifiedBuffer(prev => new Map(prev).set(bufferKey, resPayload));
      
      // 本地狀態立即反應
      setReservations(prev => prev.map(r => r.id === editingReservation.id ? resPayload : r));
    } else {
      setReservations(prev => [resPayload, ...prev]);
    }

    // 發送覆蓋指令：包含舊識別資訊與新數據
    const success = await syncToGoogleSheet({
      action: editingReservation ? 'update' : 'create',
      oldName: oldInfo?.name,
      oldDate: oldInfo?.date,
      oldTime: oldInfo?.time,
      ...resPayload
    });
    
    if (success) {
      setReservations(prev => prev.map(r => r.id === resPayload.id ? { ...r, syncStatus: 'synced', isLocal: true } : r));
      // 成功後立即觸發一次同步確認
      setTimeout(() => handleSyncAll(true), 3000);
      
      // 5分鐘後自動清除緩衝，這是一個安全網
      if (editingReservation) {
        const bufferKey = `${resPayload.customerName.trim()}_${resPayload.date}_${resPayload.time.substring(0,5)}`;
        setTimeout(() => {
          setLocalModifiedBuffer(prev => {
            const next = new Map(prev);
            next.delete(bufferKey);
            return next;
          });
        }, 300000);
      }
    }
    
    setIsSyncingToCloud(false);
    setIsModalOpen(false);
    setEditingReservation(null);
    setSelectedTables([]);
  };

  const handleDeleteReservation = async (res: Reservation) => {
    const primarySource = dataSources.find(s => s.writeUrl && s.writeUrl.includes('/exec'));
    if (!primarySource) return alert("請先設定 Apps Script 寫入網址。");
    if (!confirm(`確定要徹底刪除「${res.customerName}」嗎？`)) return;
    
    const deleteInfo = { name: res.customerName.trim(), date: res.date, time: res.time.substring(0,5) };
    setSyncBlacklist(prev => [...prev, deleteInfo]);
    setReservations(prev => prev.filter(r => r.id !== res.id));
    
    setIsSyncingToCloud(true);
    const success = await syncToGoogleSheet({ action: 'delete', oldName: deleteInfo.name, oldDate: deleteInfo.date, oldTime: deleteInfo.time });
    setIsSyncingToCloud(false);

    if (success) {
      setTimeout(() => handleSyncAll(true), 4000);
      setTimeout(() => setSyncBlacklist(prev => prev.filter(d => d !== deleteInfo)), 600000);
    }
  };

  const handleTableToggle = (table: string) => {
    if (occupiedTables.has(table)) return;
    setSelectedTables(prev => prev.includes(table) ? prev.filter(t => t !== table) : [...prev, table]);
  };

  const filteredReservations = useMemo(() => {
    const s = searchTerm.toLowerCase();
    return reservations.filter(r => {
      // 搜尋過濾
      return (r.customerName && r.customerName.toLowerCase().includes(s)) || (r.phone && r.phone.includes(s));
    });
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
      <div className="md:hidden bg-white border-b border-slate-100 px-6 py-4 flex justify-between items-center sticky top-0 z-30 shadow-sm">
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
                <div>
                  <h1 className="text-2xl font-black text-slate-800 tracking-tight">訂位管理戰情室</h1>
                  <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Google Sheet 即時連線中</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleSyncAll()} disabled={syncingAll} className="p-3 bg-white border rounded-2xl text-xs font-black shadow-sm flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50">
                    {syncingAll ? <Loader2 className="w-4 h-4 animate-spin text-orange-600" /> : <RefreshCw className="w-4 h-4 text-orange-600" />}
                    重新載入
                  </button>
                </div>
              </div>

              <AnalysisCard type="RESERVATIONS" data={filteredReservations.slice(0, 100)} />

              <div className="sticky top-0 bg-slate-50/80 backdrop-blur-md pt-2 pb-4 z-20">
                <div className="relative">
                  <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="搜尋顧客、電話..." className="w-full pl-12 pr-4 py-4 border-none rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 bg-white" />
                </div>
              </div>

              <div className="space-y-10">
                {sortedDates.length === 0 && !syncingAll && (
                  <div className="py-20 text-center flex flex-col items-center gap-4 text-slate-300">
                    <Inbox className="w-16 h-16" />
                    <p className="font-bold">目前無訂位紀錄</p>
                  </div>
                )}
                {sortedDates.map(date => (
                  <div key={date}>
                    <div className="flex items-center gap-2 mb-4">
                      <h2 className="text-lg font-black text-slate-800">{new Date(date).toLocaleDateString('zh-TW', {month: 'numeric', day: 'numeric', weekday: 'short'})}</h2>
                      <div className="h-px flex-1 bg-slate-200"></div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {groupedRes[date].map((res: Reservation) => {
                        const cardStyle = 
                          res.type === '包場' ? 'bg-rose-50 border-rose-200 hover:border-rose-300' :
                          res.type === '外帶' ? 'bg-sky-50 border-sky-200 hover:border-sky-300' :
                          'bg-[#FAF7F2] border-[#E5DACE] hover:border-[#DBC9B8]';

                        const textColor = 
                          res.type === '包場' ? 'text-rose-900' :
                          res.type === '外帶' ? 'text-sky-900' :
                          'text-[#5C4D3C]';

                        const subTextColor = 
                          res.type === '包場' ? 'text-rose-500' :
                          res.type === '外帶' ? 'text-sky-500' :
                          'text-[#8A7661]';

                        return (
                          <div key={res.id} className={`p-6 rounded-[32px] shadow-sm border relative transition-all group ${cardStyle}`}>
                            <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleOpenEdit(res)} className={`p-2 hover:bg-white/50 rounded-lg ${subTextColor}`}><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => handleDeleteReservation(res)} className={`p-2 hover:bg-rose-100/50 text-rose-400 hover:text-rose-600 rounded-lg`}><Trash2 className="w-4 h-4" /></button>
                            </div>
                            <div className="flex justify-between items-center mb-4">
                              <div className="flex items-center gap-2">
                                <span className={`font-black px-3 py-1.5 rounded-xl text-xs bg-white/60 ${textColor}`}>{res.time}</span>
                                {res.syncStatus === 'pending' && <Loader2 className="w-3 h-3 animate-spin text-orange-500" />}
                              </div>
                              <span className={`text-[10px] font-black uppercase tracking-widest ${subTextColor}`}>
                                {res.type}
                              </span>
                            </div>
                            <h3 className={`font-black text-xl mb-1 ${textColor}`}>{res.customerName}</h3>
                            <div className={`flex items-center gap-1.5 text-xs font-bold mb-4 ${subTextColor}`}><Phone className="w-3 h-3" /> {res.phone || '無電話'}</div>
                            
                            {res.notes && (
                              <div className={`mb-4 p-3 rounded-2xl bg-black/5 flex items-start gap-2 text-sm font-medium ${textColor}`}>
                                <MessageSquare className={`w-4 h-4 mt-0.5 flex-shrink-0 ${subTextColor}`} />
                                <span className="line-clamp-3">{res.notes}</span>
                              </div>
                            )}

                            <div className="pt-4 border-t border-black/5 flex justify-between items-center">
                              <div className={`flex items-center gap-2 font-black text-base ${textColor}`}>
                                <Users className={`w-5 h-5 ${subTextColor}`} /> 
                                {res.pax}位 <span className="text-sm font-bold opacity-60">/</span> {res.creator || '未註記'}
                              </div>
                              <div className={`text-base font-black px-4 py-2 rounded-2xl bg-white shadow-sm border border-black/5 ${textColor}`}>
                                {res.table || '未排'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
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
                  <p className="text-slate-400 mt-2 relative z-10 font-bold">設定 Google 試算表 CSV 下載與 Apps Script 網址。</p>
               </div>
               {/* 略過設定部分，維持原樣 */}
               <div className="bg-white rounded-[40px] shadow-xl border p-8 space-y-6">
                  <h3 className="font-black text-slate-800 text-xl flex items-center gap-2"><Globe className="text-orange-600" /> 連線設定</h3>
                  <div className="space-y-4">
                    <input type="text" value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="來源名稱 (例: 忠孝店)" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" />
                    <input type="text" value={newUrl} onChange={(e)=>setNewUrl(e.target.value)} placeholder="Google Sheet CSV 下載網址" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" />
                    <input type="text" value={newWriteUrl} onChange={(e)=>setNewWriteUrl(e.target.value)} placeholder="Apps Script 寫入網址 (/exec)" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" />
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase ml-1">預設用餐時間 (分鐘)</label>
                      <input type="number" value={newDuration} onChange={(e)=>setNewDuration(parseInt(e.target.value) || 90)} placeholder="90" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" />
                    </div>
                  </div>
                  <button onClick={() => {
                      setLoadingSource(true);
                      const sId = Date.now().toString();
                      fetchCsvStreaming(newUrl, () => {}).then(csv => mapReservationsCSVAsync(csv, sId)).then(data => {
                          setDataSources([...dataSources, { 
                            id: sId, 
                            name: newName || '新店鋪', 
                            url: newUrl, 
                            writeUrl: newWriteUrl, 
                            type: 'RESERVATIONS', 
                            lastUpdated: new Date().toLocaleString(), 
                            status: 'ACTIVE', 
                            diningDuration: newDuration 
                          }]);
                          setReservations(prev => [...data, ...prev]);
                          setCurrentView(AppView.RESERVATIONS);
                      }).finally(() => setLoadingSource(false));
                  }} disabled={loadingSource} className="w-full bg-orange-600 text-white py-5 rounded-3xl font-black text-lg transition-all active:scale-95 disabled:opacity-50 shadow-xl shadow-orange-500/20">
                    {loadingSource ? '驗證連線中...' : '儲存連線設定'}
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
                    <h2 className="text-xl font-black">{editingReservation ? '編輯訂位' : '填寫新訂位'}</h2>
                    <button onClick={() => !isSyncingToCloud && setIsModalOpen(false)}><X className="w-7 h-7" /></button>
                  </div>
                  <div className="p-8 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
                      {/* 表單內容維持原樣，但 Save 按鈕會觸發新的 handleSaveReservation */}
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
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase ml-1">日期</label><input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" /></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase ml-1">時間</label><input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" /></div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">顧客姓名</label>
                          <input type="text" value={form.customerName} onChange={e => setForm({...form, customerName: e.target.value})} placeholder="請輸入姓名" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">訂位人數 (pax)</label>
                          <input type="number" value={form.pax} onChange={e => setForm({...form, pax: parseInt(e.target.value) || 1})} placeholder="人數" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">電話</label>
                        <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="請輸入電話" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" />
                      </div>
                      
                      <div className="space-y-4">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">桌號分配 (點擊選取)</label>
                        <div className="grid grid-cols-4 gap-2">
                          {TABLE_OPTIONS.map(t => {
                            const isOccupied = occupiedTables.has(t);
                            const isSelected = selectedTables.includes(t);
                            return (
                              <button key={t} onClick={() => handleTableToggle(t)} disabled={isOccupied} className={`py-3 rounded-xl border text-[11px] font-black transition-all ${
                                isSelected ? 'bg-indigo-600 text-white border-indigo-600' : 
                                isOccupied ? 'bg-rose-50 text-rose-200 border-rose-100 cursor-not-allowed' : 
                                'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-300'
                              }`}>{t}</button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">備註</label>
                        <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500 min-h-[80px]"></textarea>
                      </div>

                      <button onClick={handleSaveReservation} disabled={isSyncingToCloud} className="w-full bg-slate-900 text-white py-5 rounded-[28px] font-black text-lg flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50 transition-all shadow-xl">
                        {isSyncingToCloud ? <Loader2 className="w-6 h-6 animate-spin text-orange-500" /> : <Save className="w-6 h-6" />}
                        {isSyncingToCloud ? '正在同步至 Google Sheet...' : '儲存並同步修改'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

export default App;
