
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Link as LinkIcon, Plus, Trash2, Phone, Calendar as CalendarIcon, Menu, ChefHat, Users, Inbox, RefreshCw, Loader2, X, Save, Globe, FileSpreadsheet, Database, ClipboardList, CheckCircle2, AlertCircle, Info, UserCheck, MessageSquare } from 'lucide-react';
import Sidebar from './components/Sidebar';
import AnalysisCard from './components/AnalysisCard';
import { AppView, Reservation, DataSource } from './types';
import { mapReservationsCSVAsync, fetchCsvStreaming } from './services/dataProcessor';

const STORAGE_KEY_RESERVATIONS = 'bakery_reservations';
const STORAGE_KEY_SOURCES = 'bakery_sources';

const TABLE_OPTIONS = ['綠1', '綠2', '綠3', '綠4', '綠5', '白1', '白2', '白3', '白4', '白5'];
const CREATOR_OPTIONS = ['沈家杭', 'TAKA'];
const TYPE_OPTIONS = ['內用', '外帶', '包場'];

function App() {
  const [currentView, setCurrentView] = useState<AppView>(AppView.RESERVATIONS);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSyncingToCloud, setIsSyncingToCloud] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatusText, setSyncStatusText] = useState('');
  
  // 本地已刪除清單，防止 Google 快取延遲導致資料「飄回」
  const [deletedBlacklist, setDeletedBlacklist] = useState<{name: string, date: string, time: string}[]>([]);
  
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

  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [newWriteUrl, setNewWriteUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [loadingSource, setLoadingSource] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(reservations.slice(0, 500)));
  }, [reservations]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SOURCES, JSON.stringify(dataSources));
  }, [dataSources]);

  const syncToGoogleSheet = async (payload: any) => {
    const primarySource = dataSources.find(s => s.writeUrl && s.writeUrl.includes('/exec'));
    if (!primarySource?.writeUrl) return false;
    
    try {
      await fetch(primarySource.writeUrl.trim(), {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
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
    if (!isSilent) {
      setSyncingAll(true);
      setSyncProgress(1);
    }
    try {
        let allRemote: Reservation[] = [];
        for (const source of dataSources) {
            const csvText = await fetchCsvStreaming(source.url, (phase, p) => {
                if (!isSilent) setSyncProgress(p);
            });
            const remoteData = await mapReservationsCSVAsync(csvText, source.id, (p) => {
                if (!isSilent) setSyncProgress(p);
            });
            allRemote = [...allRemote, ...remoteData];
        }

        setReservations(prev => {
          const filteredRemote = allRemote.filter(r => 
            !deletedBlacklist.some(d => 
              d.name === r.customerName.trim() && 
              d.date === r.date && 
              d.time.substring(0,5) === r.time.substring(0,5)
            )
          );

          const localOnly = prev.filter(p => p.isLocal && !filteredRemote.some(r => 
            r.customerName.trim() === p.customerName.trim() && 
            r.date === p.date && 
            r.time.substring(0,5) === p.time.substring(0,5)
          ));
          
          return [...localOnly, ...filteredRemote];
        });

        setDataSources(prev => prev.map(s => ({...s, lastUpdated: new Date().toLocaleString()})));
    } catch (e) { 
        if (!isSilent) alert("同步失敗。"); 
    } finally { 
        if (!isSilent) {
          setSyncingAll(false); 
          setSyncProgress(0);
        }
    }
  };

  const handleSaveReservation = async () => {
    if (!form.customerName || !form.date) return alert('請填寫姓名與日期');
    
    setIsSyncingToCloud(true);
    const tableString = selectedTables.sort().join(', ');
    const newRes: Reservation = { 
      id: `local-${Date.now()}`,
      customerName: (form.customerName || '').trim(),
      date: form.date || '',
      time: form.time || '12:00',
      pax: form.pax || 1,
      type: form.type || '內用',
      phone: form.phone || '',
      table: tableString,
      notes: form.notes || '',
      creator: form.creator || '',
      isLocal: true, 
      syncStatus: 'pending' 
    };

    setReservations(prev => [newRes, ...prev]);
    const success = await syncToGoogleSheet(newRes);
    
    if (success) {
      setReservations(prev => prev.map(r => r.id === newRes.id ? { ...r, syncStatus: 'synced' } : r));
      setTimeout(() => handleSyncAll(true), 5000);
    }
    
    setIsSyncingToCloud(false);
    setIsModalOpen(false);
    setForm({ date: new Date().toISOString().split('T')[0], time: '12:00', pax: 2, type: '內用', customerName: '', phone: '', table: '', notes: '', creator: CREATOR_OPTIONS[0] });
    setSelectedTables([]);
  };

  const handleDeleteReservation = async (res: Reservation) => {
    const primarySource = dataSources.find(s => s.writeUrl && s.writeUrl.includes('/exec'));
    if (!primarySource) return alert("請先設定 Apps Script 寫入網址。");
    if (!confirm(`確定要刪除「${res.customerName}」的訂位嗎？`)) return;
    
    const customerName = res.customerName.trim();
    const date = res.date;
    const time = res.time;

    setDeletedBlacklist(prev => [...prev, { name: customerName, date, time }]);
    const originalList = [...reservations];
    setReservations(prev => prev.filter(r => r.id !== res.id));
    
    const success = await syncToGoogleSheet({
      action: 'delete',
      customerName,
      date,
      time
    });

    if (success) {
      setTimeout(() => handleSyncAll(true), 5000);
      setTimeout(() => {
        setDeletedBlacklist(prev => prev.filter(d => 
          !(d.name === customerName && d.date === date && d.time === time)
        ));
      }, 30000);
    } else {
      alert("同步刪除失敗。");
      setReservations(originalList);
      setDeletedBlacklist(prev => prev.filter(d => 
        !(d.name === customerName && d.date === date && d.time === time)
      ));
    }
  };

  const handleTableToggle = (table: string) => {
    setSelectedTables(prev => 
      prev.includes(table) ? prev.filter(t => t !== table) : [...prev, table]
    );
  };

  const getTypeStyle = (type: string) => {
    switch(type) {
      case '內用': return 'bg-[#efebe9] text-[#5d4037] border-[#d7ccc8]'; 
      case '外帶': return 'bg-[#e3f2fd] text-[#1976d2] border-[#bbdefb]'; 
      case '包場': return 'bg-[#ffebee] text-[#d32f2f] border-[#ffcdd2]'; 
      default: return 'bg-slate-100 text-slate-500 border-slate-200';
    }
  };

  const filteredReservations = useMemo(() => {
    const s = searchTerm.toLowerCase();
    return reservations.filter(r => 
      (r.customerName && r.customerName.toLowerCase().includes(s)) || 
      (r.date && r.date.includes(s)) || 
      (r.phone && r.phone.includes(s)) ||
      (r.creator && r.creator.toLowerCase().includes(s)) ||
      (r.notes && r.notes.toLowerCase().includes(s))
    );
  }, [reservations, searchTerm]);

  const groupedRes = useMemo(() => {
    return filteredReservations.reduce((acc: any, res) => {
      acc[res.date] = acc[res.date] || [];
      acc[res.date].push(res);
      return acc;
    }, {});
  }, [filteredReservations]);

  const sortedDates = useMemo(() => Object.keys(groupedRes).sort((a, b) => new Date(a).getTime() - new Date(b).getTime()), [groupedRes]);

  const renderContent = () => {
    if (currentView === AppView.RESERVATIONS) {
      return (
         <div className="space-y-6 animate-fade-in pb-24 relative">
            <div className="flex justify-between items-end px-2 pt-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-800">訂位管理戰情室</h1>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">A-日期 / C-類型 / D-時間 / F-姓名 / H-填單人 / I-桌號 / K-備註</p>
                </div>
                <button onClick={() => handleSyncAll(false)} disabled={syncingAll} className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-600 shadow-sm flex items-center gap-2 text-xs font-black active:scale-95">
                    {syncingAll ? <Loader2 className="w-4 h-4 animate-spin text-orange-600" /> : <RefreshCw className="w-4 h-4 text-orange-600" />}
                    更新數據
                </button>
            </div>
            
            <AnalysisCard type="RESERVATIONS" data={filteredReservations.slice(0, 100)} />
            
            <div className="sticky top-0 bg-slate-50/80 backdrop-blur-md pt-2 pb-4 z-20 px-1">
                 <div className="relative w-full">
                    <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="搜尋顧客、填單人、備註..." className="w-full pl-12 pr-4 py-4 border-none rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 bg-white" />
                 </div>
            </div>

            <div className="space-y-10 px-1">
                {sortedDates.map(date => (
                    <div key={date}>
                        <div className="flex items-center gap-2 mb-4">
                            <h2 className="text-lg font-black text-slate-800">{new Date(date).toLocaleDateString('zh-TW', {month: 'numeric', day: 'numeric', weekday: 'short'})}</h2>
                            <div className="h-px flex-1 bg-slate-200"></div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                            {groupedRes[date].map((res: Reservation) => (
                                <div key={res.id} className="p-6 rounded-[32px] shadow-sm border border-slate-100 bg-white relative transition-all group hover:border-orange-200 flex flex-col h-full">
                                    <div className="absolute top-4 right-4 flex gap-2 items-center">
                                        <button onClick={() => handleDeleteReservation(res)} className="p-3 text-slate-200 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all md:opacity-0 md:group-hover:opacity-100 opacity-100"><Trash2 className="w-5 h-5" /></button>
                                        {res.isLocal && <div className={`w-2.5 h-2.5 rounded-full ${res.syncStatus === 'synced' ? 'bg-green-500' : 'bg-rose-500 animate-pulse'}`}></div>}
                                    </div>
                                    <div className="flex justify-between items-center mb-4">
                                        <span className="font-black text-slate-900 bg-slate-50 px-3 py-1.5 rounded-xl text-xs">{res.time}</span>
                                        <span className={`text-[10px] font-black px-3 py-1 rounded-lg border ${getTypeStyle(res.type)}`}>{res.type}</span>
                                    </div>
                                    <h3 className="font-black text-xl text-slate-800 mb-1">{res.customerName}</h3>
                                    <div className="flex items-center gap-1.5 text-xs text-slate-400 font-bold mb-4">
                                        <Phone className="w-3 h-3" /> {res.phone || '無電話紀錄'}
                                    </div>
                                    
                                    {res.notes && (
                                      <div className="mb-4 p-3 bg-amber-50 rounded-2xl text-[11px] font-bold text-amber-700 border border-amber-100/50 flex gap-2">
                                        <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                        <span>{res.notes}</span>
                                      </div>
                                    )}

                                    <div className="mt-auto pt-4 border-t border-slate-50">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-1.5 text-slate-600 font-black text-xs">
                                                <Users className="w-4 h-4 text-orange-500" /> <span>{res.pax}位</span>
                                            </div>
                                            <div className="text-xs font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-xl">{res.table || '未排桌'}</div>
                                        </div>
                                        {res.creator && <div className="mt-3 flex items-center gap-1 text-[10px] font-black text-slate-300 uppercase tracking-tighter"><UserCheck className="w-3 h-3" /> 填單: {res.creator}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            <button onClick={() => setIsModalOpen(true)} className="fixed bottom-8 right-8 w-16 h-16 bg-orange-600 text-white rounded-3xl shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-40 border-4 border-white/20"><Plus className="w-10 h-10" /></button>
         </div>
      );
    }

    return (
      <div className="space-y-8 max-w-4xl mx-auto animate-fade-in pb-20 px-2">
         <div className="p-10 bg-slate-900 rounded-[40px] text-white shadow-2xl">
            <h1 className="text-4xl font-black">資料來源設定</h1>
            <p className="text-slate-400 mt-2">設定 Google 試算表 CSV 下載與 Apps Script 寫入網址。</p>
         </div>
         <div className="bg-white rounded-[40px] shadow-xl border border-slate-100 p-8 space-y-6">
            <h3 className="font-black text-slate-800 text-xl flex items-center gap-3"><Globe className="text-orange-600" /> 建立新連線</h3>
            <div className="space-y-4">
                <input type="text" value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="來源名稱" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" />
                <input type="text" value={newUrl} onChange={(e)=>setNewUrl(e.target.value)} placeholder="CSV 讀取網址" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" />
                <input type="text" value={newWriteUrl} onChange={(e)=>setNewWriteUrl(e.target.value)} placeholder="Apps Script 網址 (/exec)" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" />
            </div>
            <button onClick={() => {
                if (!newUrl) return setErrorMsg('請輸入 CSV 連結');
                setLoadingSource(true); setErrorMsg('');
                const sourceId = Date.now().toString();
                fetchCsvStreaming(newUrl, (phase, p) => setSyncProgress(p))
                .then(csvText => mapReservationsCSVAsync(csvText, sourceId, setSyncProgress))
                .then(testData => {
                    setDataSources([...dataSources, { id: sourceId, name: newName || `試算表`, url: newUrl, writeUrl: newWriteUrl, type: 'RESERVATIONS', lastUpdated: new Date().toLocaleString(), status: 'ACTIVE' }]);
                    setReservations(prev => [...testData, ...prev]);
                    setNewUrl(''); setNewWriteUrl(''); setNewName('');
                    setCurrentView(AppView.RESERVATIONS);
                }).catch(e => setErrorMsg("連線失敗: " + e.message)).finally(() => setLoadingSource(false));
            }} disabled={loadingSource} className="w-full bg-orange-600 text-white py-5 rounded-3xl font-black text-lg shadow-xl active:scale-95 transition-all">{loadingSource ? '驗證中...' : '確認並儲存連線'}</button>
            {errorMsg && <p className="text-rose-600 text-center font-bold bg-rose-50 p-4 rounded-2xl">{errorMsg}</p>}
         </div>
         <div className="space-y-4 px-2">
            <h3 className="font-black text-slate-800 text-lg">目前連線</h3>
            {dataSources.map(source => (
                <div key={source.id} className="bg-white p-6 rounded-[32px] border border-slate-100 flex justify-between items-center shadow-sm">
                    <div className="flex items-center gap-4">
                        <FileSpreadsheet className="w-8 h-8 text-indigo-500" />
                        <div><h4 className="font-black text-slate-800">{source.name}</h4><p className="text-[10px] text-slate-400">最後同步: {source.lastUpdated}</p></div>
                    </div>
                    <button onClick={() => {
                        if (!confirm('確定要移除？')) return;
                        setDataSources(prev => prev.filter(s => s.id !== source.id));
                        setReservations(prev => prev.filter(r => r.sourceId !== source.id));
                    }} className="p-3 text-slate-300 hover:text-rose-600"><Trash2 className="w-6 h-6" /></button>
                </div>
            ))}
         </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row overflow-x-hidden">
      <div className="md:hidden bg-white border-b border-slate-100 px-6 py-4 flex justify-between items-center sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-2">
          <ChefHat className="w-6 h-6 text-orange-600" />
          <span className="font-black text-lg tracking-tight">BakeryOS</span>
        </div>
        <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 bg-slate-50 rounded-xl text-slate-600"><Menu className="w-6 h-6" /></button>
      </div>

      <Sidebar currentView={currentView} onChangeView={setCurrentView} isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />
      <main className="flex-1 md:ml-64 p-5 md:p-12 h-screen overflow-y-auto custom-scrollbar"><div className="max-w-4xl mx-auto">{renderContent()}</div></main>

      {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl" onClick={() => !isSyncingToCloud && setIsModalOpen(false)}></div>
              <div className="bg-white w-full max-w-xl rounded-[40px] shadow-2xl relative z-10 overflow-hidden animate-in zoom-in">
                  <div className="bg-orange-600 p-8 text-white flex justify-between items-center">
                    <h2 className="text-2xl font-black">填寫新訂位</h2>
                    <button onClick={() => !isSyncingToCloud && setIsModalOpen(false)}><X className="w-8 h-8" /></button>
                  </div>
                  <div className="p-10 space-y-6 max-h-[85vh] overflow-y-auto custom-scrollbar">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 ml-1 uppercase">填單人 (H)</label><select value={form.creator} onChange={e => setForm({...form, creator: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold">{CREATOR_OPTIONS.map(c => <option key={c}>{c}</option>)}</select></div>
                        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 ml-1 uppercase">類型 (C)</label><select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold">{TYPE_OPTIONS.map(t => <option key={t}>{t}</option>)}</select></div>
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 ml-1 uppercase">日期 (A)</label><input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" /></div>
                        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 ml-1 uppercase">時間 (D)</label><input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 ml-1 uppercase">姓名 (F)</label><input type="text" value={form.customerName} onChange={e => setForm({...form, customerName: e.target.value})} placeholder="姓名" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" /></div>
                        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 ml-1 uppercase">電話 (G)</label><input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="09XX..." className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" /></div>
                      </div>
                      <div className="grid grid-cols-1 gap-6">
                        <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 ml-1 uppercase">人數 (E)</label><input type="number" value={form.pax} onChange={e => setForm({...form, pax: parseInt(e.target.value) || 0})} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold" /></div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 ml-1 uppercase">備註事項 (K)</label>
                        <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="特殊需求、慶生、兒童椅..." className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold min-h-[100px] resize-none"></textarea>
                      </div>
                      <div className="space-y-2"><label className="text-[10px] font-black text-slate-400 ml-1 uppercase">分配桌號 (I)</label><div className="grid grid-cols-5 gap-2">{TABLE_OPTIONS.map(table => (<button key={table} onClick={() => handleTableToggle(table)} className={`py-3 rounded-xl text-xs font-black transition-all border ${selectedTables.includes(table) ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105' : 'bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100'}`}>{table}</button>))}</div></div>
                      <button onClick={handleSaveReservation} disabled={isSyncingToCloud} className="w-full bg-slate-900 text-white py-5 rounded-[24px] font-black text-lg flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50 shadow-xl">{isSyncingToCloud ? <Loader2 className="w-6 h-6 animate-spin text-orange-500" /> : <Save className="w-6 h-6" />}{isSyncingToCloud ? '同步雲端中...' : '確認並儲存訂位'}</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

export default App;
