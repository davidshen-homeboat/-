
import React, { useState, useEffect, useMemo } from 'react';
import { Search, Link as LinkIcon, Plus, Trash2, Phone, Calendar as CalendarIcon, Menu, ChefHat, Users, Inbox, RefreshCw, Loader2, X, Save, Globe, FileSpreadsheet, Database, ClipboardList, CheckCircle2, AlertCircle, Info, UserCheck, MessageSquare, Clock, ShieldAlert, CheckCircle, Ban, CalendarDays, Pencil, ExternalLink, MapPin, Unlink, Tag, Layers } from 'lucide-react';
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(reservations.slice(0, 1000)));
  }, [reservations]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SOURCES, JSON.stringify(dataSources));
  }, [dataSources]);

  const getSignature = (res: Reservation | Partial<Reservation>) => {
    return [
      res.date || '',
      res.type || '',
      (res.time || '').substring(0, 5),
      res.pax || 0,
      (res.customerName || '').trim(),
      (res.phone || '').trim(),
      res.table || '',
      (res.notes || '').trim()
    ].join('|');
  };

  const timeToMinutes = (timeStr: string) => {
    if (!timeStr) return 0;
    const [hrs, mins] = timeStr.split(':').map(Number);
    return hrs * 60 + (mins || 0);
  };

  const { occupiedTableDetails } = useMemo(() => {
    if (!isModalOpen || !form.date || !form.time) return { occupiedTableDetails: new Map<string, {name: string, time: string}>() };
    const startMins = timeToMinutes(form.time);
    const endMins = startMins + 90;
    const details = new Map<string, {name: string, time: string}>();
    reservations.forEach(res => {
      if (editingReservation && res.id === editingReservation.id) return; 
      if (res.date !== form.date) return;
      const resStart = timeToMinutes(res.time);
      const resEnd = resStart + 90;
      if ((startMins < resEnd) && (endMins > resStart)) {
        (res.table || '').split(', ').filter(Boolean).forEach(t => details.set(t, { name: res.customerName, time: res.time }));
      }
    });
    return { occupiedTableDetails: details };
  }, [isModalOpen, form.date, form.time, reservations, editingReservation]);

  const syncToGoogleSheet = async (payload: any, sourceId?: string) => {
    const targetSource = dataSources.find(s => s.id === sourceId);
    if (!targetSource?.writeUrl) return false;
    try {
      await fetch(targetSource.writeUrl.trim(), {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      return true;
    } catch (e) { return false; }
  };

  const handleSyncAll = async (isSilent = false) => {
    if (dataSources.length === 0) return;
    if (!isSilent) setSyncingAll(true);
    try {
        let allRemote: Reservation[] = [];
        for (const source of dataSources) {
            try {
              const csvText = await fetchCsvStreaming(source.url, () => {});
              const remoteData = await mapReservationsCSVAsync(csvText, source.id, () => {});
              allRemote = [...allRemote, ...remoteData];
            } catch (err) { console.error(err); }
        }

        setReservations(prev => {
          const processedRemote = allRemote.filter(r => !syncBlacklist.includes(getSignature(r)));
          const localOnly = prev.filter(p => p.isLocal && !processedRemote.some(r => r.customerName === p.customerName && r.date === p.date && r.time === p.time));
          return [...localOnly, ...processedRemote];
        });
        setDataSources(prev => prev.map(s => ({...s, lastUpdated: new Date().toLocaleString(), status: 'ACTIVE'})));
    } finally { if (!isSilent) setSyncingAll(false); }
  };

  const handleSaveReservation = async () => {
    if (!form.customerName || !form.date || selectedTables.length === 0) return alert('請完整填寫姓名、日期並選擇桌號');

    setIsSyncingToCloud(true);
    const tableString = selectedTables.sort().join(', ');
    const targetSourceId = editingReservation?.sourceId || dataSources[0]?.id;

    const resPayload: Reservation = { 
      id: editingReservation ? editingReservation.id : `local-${Date.now()}`,
      customerName: (form.customerName || '').trim(),
      date: form.date || '',
      time: form.time || '12:00',
      pax: Number(form.pax) || 1,
      type: form.type || '內用',
      phone: (form.phone || '').trim(),
      table: tableString,
      notes: (form.notes || '').trim(),
      creator: form.creator || CREATOR_OPTIONS[0],
      isLocal: true,
      syncStatus: 'pending',
      sourceId: targetSourceId
    };

    let oldFields = null;
    if (editingReservation) {
      oldFields = {
        oldDate: editingReservation.date,
        oldType: editingReservation.type,
        oldTime: editingReservation.time.substring(0, 5),
        oldPax: editingReservation.pax,
        oldName: editingReservation.customerName,
        oldPhone: editingReservation.phone,
        oldTable: editingReservation.table,
        oldNotes: editingReservation.notes
      };
      setReservations(prev => prev.map(r => r.id === editingReservation.id ? resPayload : r));
    } else {
      setReservations(prev => [resPayload, ...prev]);
    }

    const success = await syncToGoogleSheet({
      action: editingReservation ? 'update' : 'create',
      ...oldFields,
      ...resPayload
    }, targetSourceId);
    
    if (success) {
      setReservations(prev => prev.map(r => r.id === resPayload.id ? { ...r, syncStatus: 'synced' } : r));
      setTimeout(() => handleSyncAll(true), 3000);
    }
    setIsSyncingToCloud(false);
    setIsModalOpen(false);
    setEditingReservation(null);
  };

  const handleDeleteReservation = async (res: Reservation) => {
    if (!confirm(`確定要將此訂位從 Google Sheet 徹底移除嗎？`)) return;
    
    const signature = getSignature(res);
    setSyncBlacklist(prev => [...prev, signature]);
    setReservations(prev => prev.filter(r => r.id !== res.id));
    
    setIsSyncingToCloud(true);
    
    // 嚴格送出 8 個比對欄位
    const success = await syncToGoogleSheet({ 
      action: 'delete', 
      date: res.date,
      type: res.type,
      time: res.time.substring(0,5),
      pax: res.pax,
      customerName: res.customerName,
      phone: res.phone,
      table: res.table,
      notes: res.notes
    }, res.sourceId);
    
    setIsSyncingToCloud(false);

    if (success) {
      setTimeout(() => handleSyncAll(true), 4000);
      setTimeout(() => setSyncBlacklist(prev => prev.filter(sig => sig !== signature)), 600000);
    } else {
      alert("同步刪除失敗，請檢查 Apps Script 設定。");
    }
  };

  const handleOpenEdit = (res: Reservation) => {
    setEditingReservation(res);
    setForm({ ...res });
    setSelectedTables((res.table || '').split(', ').filter(Boolean));
    setIsModalOpen(true);
  };

  const handleAddSource = () => {
    if (!newUrl || !newWriteUrl) return alert("請填寫完整的連結資訊");
    setLoadingSource(true);
    const sId = `ds-${Date.now()}`;
    fetchCsvStreaming(newUrl, () => {}).then(csv => mapReservationsCSVAsync(csv, sId, () => {})).then(data => {
        const newSource: DataSource = { 
          id: sId, name: newName || `來源 ${dataSources.length + 1}`, url: newUrl, writeUrl: newWriteUrl, 
          type: 'RESERVATIONS', lastUpdated: new Date().toLocaleString(), status: 'ACTIVE', diningDuration: newDuration 
        };
        setDataSources(prev => [...prev, newSource]);
        setReservations(prev => [...data, ...prev]);
        setNewUrl(''); setNewWriteUrl(''); setNewName('');
        alert(`成功連結來源：${newSource.name}`);
    }).catch(() => alert("連線失敗，請檢查連結權限"))
    .finally(() => setLoadingSource(false));
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
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div className="space-y-3">
                  <h1 className="text-3xl font-black text-slate-800 tracking-tight">訂位中心</h1>
                  <div className="flex flex-wrap gap-2">
                    {dataSources.map(ds => (
                      <a key={ds.id} href={ds.url.includes('/export') ? ds.url.split('/export')[0] : ds.url} target="_blank" className="flex items-center gap-2 text-emerald-700 font-bold text-[10px] bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200 hover:bg-emerald-100 shadow-sm">
                        <FileSpreadsheet className="w-3 h-3" /> {ds.name} <ExternalLink className="w-2 h-2" />
                      </a>
                    ))}
                    {dataSources.length === 0 && <span className="text-xs font-bold text-rose-500 flex items-center gap-1 animate-pulse"><AlertCircle className="w-3 h-3" /> 請在「連線管理」設定資料來源</span>}
                  </div>
                </div>
                <button onClick={() => handleSyncAll()} disabled={syncingAll} className="p-3 bg-white border rounded-2xl text-xs font-black shadow-sm flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 min-w-[140px]">
                  {syncingAll ? <Loader2 className="w-4 h-4 animate-spin text-orange-600" /> : <RefreshCw className="w-4 h-4 text-orange-600" />}
                  同步全部數據
                </button>
              </div>

              <AnalysisCard type="RESERVATIONS" data={filteredReservations.slice(0, 100)} />

              <div className="sticky top-0 bg-slate-50/80 backdrop-blur-md pt-2 pb-4 z-20">
                <div className="relative">
                  <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                  <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="搜尋顧客、電話、或桌號..." className="w-full pl-12 pr-4 py-4 border-none rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 bg-white font-medium" />
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
                      {groupedRes[date].map((res: Reservation) => {
                        const source = dataSources.find(s => s.id === res.sourceId);
                        return (
                          <div key={res.id} className={`p-6 rounded-[32px] shadow-sm border relative transition-all group ${res.type === '包場' ? 'bg-rose-50 border-rose-200 text-rose-900' : res.type === '外帶' ? 'bg-sky-50 border-sky-200 text-sky-900' : 'bg-[#FAF7F2] border-[#E5DACE] text-[#5C4D3C]'}`}>
                            <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => handleOpenEdit(res)} className="p-2 hover:bg-white/50 rounded-lg"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => handleDeleteReservation(res)} className="p-2 hover:bg-rose-100/50 text-rose-400 hover:text-rose-600 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                            </div>
                            <div className="flex justify-between items-center mb-4">
                              <span className="font-black px-3 py-1.5 rounded-xl text-xs bg-white/60 shadow-sm">{res.time}</span>
                              <span className="text-[9px] font-black uppercase tracking-widest bg-black/5 px-2 py-1 rounded-md flex items-center gap-1">
                                <Tag className="w-2 h-2" /> {source?.name || '本地'}
                              </span>
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
                                {res.table || '未配置'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => { setEditingReservation(null); setForm({ date: new Date().toISOString().split('T')[0], time: '12:00', pax: 2, type: '內用', customerName: '', phone: '', table: '', notes: '', creator: CREATOR_OPTIONS[0] }); setSelectedTables([]); setIsModalOpen(true); }} className="fixed bottom-8 right-8 w-16 h-16 bg-orange-600 text-white rounded-3xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 z-40 transition-transform"><Plus className="w-10 h-10" /></button>
            </div>
          ) : (
             <div className="space-y-8">
               <div className="p-10 bg-slate-900 rounded-[40px] text-white shadow-2xl relative overflow-hidden">
                  <h1 className="text-4xl font-black relative z-10">資料連線管理</h1>
                  <p className="text-slate-400 mt-2 relative z-10 font-bold">在此連結多個 Google 試算表（銷售、叫貨、訂位、日報）。</p>
                  <div className="absolute bottom-0 right-0 p-6 opacity-20"><Layers className="w-32 h-32" /></div>
               </div>

               <div className="grid grid-cols-1 gap-4">
                 {dataSources.map(ds => (
                   <div key={ds.id} className="bg-white rounded-[32px] shadow-sm border p-6 flex items-center justify-between group hover:border-emerald-300 transition-all">
                      <div className="flex items-center gap-4">
                         <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600"><Database className="w-6 h-6" /></div>
                         <div>
                            <h3 className="font-black text-slate-800 text-lg">{ds.name}</h3>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">同步正常 | {ds.lastUpdated}</p>
                         </div>
                      </div>
                      <button onClick={() => { if(confirm('斷開連線後將清除本地緩存，確定嗎？')) { setDataSources(prev => prev.filter(s => s.id !== ds.id)); setReservations(prev => prev.filter(r => r.sourceId !== ds.id)); } }} className="p-4 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-2xl transition-all"><Unlink className="w-6 h-6" /></button>
                   </div>
                 ))}
               </div>

               <div className="bg-white rounded-[40px] shadow-xl border p-8 space-y-6">
                  <h3 className="font-black text-slate-800 text-xl flex items-center gap-2"><Globe className="text-orange-600" /> 連結新分店/業務 Sheet</h3>
                  <div className="space-y-4">
                    <input type="text" value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="名稱 (例: 忠孝店)" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                    <input type="text" value={newUrl} onChange={(e)=>setNewUrl(e.target.value)} placeholder="CSV 匯出連結" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                    <input type="text" value={newWriteUrl} onChange={(e)=>setNewWriteUrl(e.target.value)} placeholder="Apps Script Web App 連結" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" />
                  </div>
                  <button onClick={handleAddSource} disabled={loadingSource} className="w-full bg-slate-900 text-white py-5 rounded-3xl font-black text-lg transition-all active:scale-95 disabled:opacity-50">
                    {loadingSource ? <Loader2 className="animate-spin inline mr-2" /> : '確認連線'}
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
                    <h2 className="text-xl font-black">{editingReservation ? '修改訂位' : '快速填寫'}</h2>
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
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">類型</label>
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
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase ml-1">姓名</label><input type="text" value={form.customerName} onChange={e => setForm({...form, customerName: e.target.value})} placeholder="顧客稱呼" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none" /></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-slate-400 uppercase ml-1">人數</label><input type="number" value={form.pax} onChange={e => setForm({...form, pax: parseInt(e.target.value) || 1})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none" /></div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">電話</label>
                        <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="手機號碼" className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none focus:ring-2 focus:ring-orange-500" />
                      </div>
                      
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-black text-slate-400 uppercase ml-1">桌位 (多選)</label>
                          <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md">目前時段：{form.time}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          {TABLE_OPTIONS.map(t => {
                            const isOccupied = occupiedTableDetails.has(t);
                            const isSelected = selectedTables.includes(t);
                            return (
                              <button key={t} onClick={() => !isOccupied && setSelectedTables(prev => prev.includes(t) ? prev.filter(x=>x!==t) : [...prev, t])} disabled={isOccupied} className={`py-4 rounded-xl border flex flex-col items-center justify-center transition-all ${
                                isSelected ? 'bg-indigo-600 text-white border-indigo-600 shadow-md transform scale-105' : 
                                isOccupied ? 'bg-slate-100 text-slate-300 border-slate-50 cursor-not-allowed opacity-60' : 
                                'bg-slate-50 text-slate-500 border-slate-100 hover:border-slate-300'
                              }`}>
                                <span className="text-xs font-black">{t}</span>
                                {isOccupied && <span className="text-[7px] font-bold mt-1 uppercase">BUSY</span>}
                              </button>
                            );
                          })}
                        </div>
                        
                        {occupiedTableDetails.size > 0 && (
                          <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100">
                             <p className="text-[10px] font-black text-slate-500 uppercase mb-4 flex items-center gap-2"><Clock className="w-3 h-3 text-rose-500" /> 該時段已佔用桌位</p>
                             <div className="space-y-2">
                               {Array.from(occupiedTableDetails.entries()).map(([table, detail]) => (
                                 <div key={table} className="flex justify-between items-center bg-white px-4 py-2.5 rounded-2xl shadow-sm border border-slate-50">
                                    <div className="flex items-center gap-2">
                                       <span className="font-black text-xs text-slate-700">{table}</span>
                                       <div className="h-3 w-px bg-slate-200"></div>
                                       <span className="text-[11px] font-bold text-slate-400">{detail.time}</span>
                                    </div>
                                    <span className="text-[11px] font-black text-rose-500">{detail.name}</span>
                                 </div>
                               ))}
                             </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase ml-1">備註</label>
                        <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} className="w-full px-4 py-3 bg-slate-50 rounded-xl font-bold border-none min-h-[100px] focus:ring-2 focus:ring-orange-500" placeholder="備註特殊需求..."></textarea>
                      </div>

                      <button onClick={handleSaveReservation} disabled={isSyncingToCloud} className="w-full bg-slate-900 text-white py-5 rounded-[28px] font-black text-lg flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50 transition-all shadow-xl">
                        {isSyncingToCloud ? <Loader2 className="w-6 h-6 animate-spin text-orange-500" /> : <Save className="w-6 h-6" />}
                        {isSyncingToCloud ? '雲端同步中...' : '儲存並同步試算表'}
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

export default App;
