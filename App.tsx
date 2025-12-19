import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Search, Link as LinkIcon, Plus, Trash2, Phone, Calendar as CalendarIcon, Menu, ChefHat, Users, Inbox, RefreshCw, Loader2 } from 'lucide-react';
import Sidebar from './components/Sidebar';
import AnalysisCard from './components/AnalysisCard';
import { AppView, Reservation, DataSource } from './types';
import { mapReservationsCSV, fetchCsvFromUrl } from './services/dataProcessor';

const STORAGE_KEY_RESERVATIONS = 'bakery_reservations';
const STORAGE_KEY_SOURCES = 'bakery_sources';

function App() {
  const [currentView, setCurrentView] = useState<AppView>(AppView.RESERVATIONS);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Data State with LocalStorage loading
  const [reservations, setReservations] = useState<Reservation[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_RESERVATIONS);
    return saved ? JSON.parse(saved) : [];
  });
  
  const [dataSources, setDataSources] = useState<DataSource[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_SOURCES);
    return saved ? JSON.parse(saved) : [];
  });
  
  // UI State
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [loadingSource, setLoadingSource] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // Persist to LocalStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(reservations));
  }, [reservations]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SOURCES, JSON.stringify(dataSources));
  }, [dataSources]);

  const handleAddSource = async () => {
    if (!newUrl) {
      setErrorMsg('請輸入 Google Sheet 網址');
      return;
    }
    setLoadingSource(true);
    setErrorMsg('');

    try {
      const csvText = await fetchCsvFromUrl(newUrl);
      const parsedData = mapReservationsCSV(csvText);
      
      if (parsedData.length > 0) {
        setReservations(prev => {
           const existingIds = new Set(prev.map(p => `${p.date}-${p.customerName}-${p.time}`));
           const uniqueNew = parsedData.filter(p => !existingIds.has(`${p.date}-${p.customerName}-${p.time}`));
           return [...prev, ...uniqueNew];
        });
      } else {
        throw new Error('無法解析資料，請檢查欄位格式');
      }

      const newSource: DataSource = {
        id: Date.now().toString(),
        name: newName || `Sheet ${dataSources.length + 1}`,
        url: newUrl,
        type: 'RESERVATIONS',
        lastUpdated: new Date().toLocaleString(),
        status: 'ACTIVE'
      };

      setDataSources([...dataSources, newSource]);
      setNewUrl('');
      setNewName('');
      setLoadingSource(false);
      setCurrentView(AppView.RESERVATIONS);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || '連線失敗，請檢查權限');
      setLoadingSource(false);
    }
  };

  const handleSyncAll = async () => {
    if (dataSources.length === 0) return;
    setSyncingAll(true);
    let allNewReservations: Reservation[] = [];
    
    try {
        for (const source of dataSources) {
            const csvText = await fetchCsvFromUrl(source.url);
            const parsed = mapReservationsCSV(csvText);
            allNewReservations = [...allNewReservations, ...parsed];
        }
        setReservations(allNewReservations);
        setDataSources(prev => prev.map(s => ({...s, lastUpdated: new Date().toLocaleString()})));
    } catch (e) {
        console.error("Sync failed", e);
        alert("同步失敗，請確認網路連線與檔案權限");
    } finally {
        setSyncingAll(false);
    }
  };

  const removeSource = (id: string) => {
    if (confirm('確定要移除此檔案連線嗎？快取資料也將被刪除。')) {
        const remainingSources = dataSources.filter(ds => ds.id !== id);
        setDataSources(remainingSources);
        if (remainingSources.length === 0) setReservations([]);
    }
  };

  const formatDateDisplay = (dateStr: string) => {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `${month}/${day} (週${days[date.getDay()]})`;
  };

  const renderContent = () => {
    if (currentView === AppView.RESERVATIONS) {
      const filteredRes = reservations.filter(res => 
         res.customerName.includes(searchTerm) || res.date.includes(searchTerm) || (res.phone && res.phone.includes(searchTerm))
      );
      
      if (reservations.length === 0) {
          return (
            <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                    <Inbox className="w-10 h-10 text-slate-300" />
                </div>
                <h2 className="text-xl font-bold text-slate-800">尚未連結任何訂位資料</h2>
                <p className="text-slate-500 mt-2 mb-8 max-w-xs">目前資料為空。請先前往「設定」頁面連結您的 Google Sheet。</p>
                <button 
                    onClick={() => setCurrentView(AppView.INTEGRATION)}
                    className="bg-orange-600 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-orange-700 transition-all flex items-center gap-2"
                >
                    <LinkIcon className="w-5 h-5" />
                    去連結 Google Sheet
                </button>
            </div>
          );
      }

      const groupedRes = filteredRes.reduce((groups: any, res) => {
         const date = res.date;
         if (!groups[date]) groups[date] = [];
         groups[date].push(res);
         return groups;
      }, {});
      const sortedResDates = Object.keys(groupedRes).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

      return (
         <div className="space-y-6 animate-fade-in pb-20">
            <div className="flex justify-between items-end">
                <div className="flex flex-col gap-1">
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800">訂位管理</h1>
                    <p className="text-slate-500 text-sm">已連結 {dataSources.length} 個 Google Sheet 檔案</p>
                </div>
                <button 
                    onClick={handleSyncAll}
                    disabled={syncingAll}
                    className="p-2.5 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 transition-all shadow-sm flex items-center gap-2 text-sm font-medium"
                >
                    {syncingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 text-orange-600" />}
                    {syncingAll ? '同步中' : '立即更新'}
                </button>
            </div>

            <AnalysisCard type="RESERVATIONS" data={filteredRes} />
            
            <div className="sticky top-0 bg-slate-50 pt-2 pb-4 z-20">
                 <div className="relative w-full">
                    <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                        type="text" 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="搜尋顧客、電話或日期..." 
                        className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white" 
                    />
                 </div>
            </div>

            <div className="space-y-8">
                {sortedResDates.map(date => (
                    <div key={date}>
                        <div className="flex items-center gap-2 mb-3 sticky top-20 bg-slate-50/90 backdrop-blur-sm p-2 rounded-lg z-10 w-fit">
                            <CalendarIcon className="w-5 h-5 text-orange-600" />
                            <h2 className="text-lg font-bold text-slate-800">{formatDateDisplay(date)}</h2>
                            <span className="text-xs text-slate-500 font-bold px-2 py-0.5 bg-slate-200 rounded-full">
                                {groupedRes[date].length} 組
                            </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {groupedRes[date].map((res: Reservation) => (
                                <div key={res.id} className={`p-5 rounded-xl shadow-sm border ${res.type.includes('外帶') ? 'bg-sky-50 border-sky-200' : res.type.includes('包場') ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
                                    <div className="flex justify-between items-start mb-3">
                                        <div className="flex gap-2 items-center">
                                            <div className="bg-white/80 text-slate-800 px-2.5 py-1 rounded-md text-sm font-bold shadow-sm">{res.time}</div>
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/50">{res.type}</span>
                                        </div>
                                        {res.table && <span className="text-xs font-bold text-slate-500 bg-white/50 px-2 py-1 rounded-lg">桌號: {res.table}</span>}
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <h3 className="font-bold text-xl text-slate-800">{res.customerName}</h3>
                                        <div className="flex items-center gap-1.5 text-slate-600 text-sm font-medium bg-white/40 px-2 py-1 rounded-full">
                                            <Users className="w-4 h-4" /> <span>{res.pax}位</span>
                                        </div>
                                    </div>
                                    <div className="mt-4 pt-3 border-t border-slate-900/5 flex flex-col gap-2">
                                        {res.phone && <div className="flex items-center gap-2 text-sm text-slate-600"><Phone className="w-3.5 h-3.5" /> {res.phone}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
         </div>
      );
    }

    // Integration View
    return (
      <div className="space-y-6 max-w-4xl mx-auto animate-fade-in pb-20">
         <div className="text-center py-6">
            <h1 className="text-xl md:text-2xl font-bold text-slate-800">資料來源設定</h1>
            <p className="text-sm md:text-base text-slate-500 mt-2">連結後系統會自動儲存，即使關閉網頁資料也不會消失</p>
         </div>

         <div className="bg-white rounded-xl shadow-md border border-indigo-100 overflow-hidden">
            <div className="bg-indigo-50 px-4 md:px-6 py-4 border-b border-indigo-100 flex items-center gap-3">
                <Plus className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-indigo-900">新增檔案連線</h3>
            </div>
            <div className="p-4 md:p-6">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    <div className="md:col-span-12 lg:col-span-4">
                        <label className="block text-xs font-bold text-slate-500 mb-1">自訂名稱</label>
                        <input 
                            type="text" 
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="例如: 2024訂位表" 
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                        />
                    </div>
                    <div className="md:col-span-12 lg:col-span-8">
                        <label className="block text-xs font-bold text-slate-500 mb-1">Google Sheet 網址</label>
                        <div className="flex gap-2">
                            <input 
                                type="text" 
                                value={newUrl}
                                onChange={(e) => setNewUrl(e.target.value)}
                                placeholder="貼上網址..." 
                                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                            />
                            <button 
                                onClick={handleAddSource}
                                disabled={loadingSource}
                                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50 whitespace-nowrap"
                            >
                                {loadingSource ? '連線中' : '永久連結'}
                            </button>
                        </div>
                    </div>
                </div>
                {errorMsg && <div className="mt-3 text-xs text-red-600">{errorMsg}</div>}
            </div>
         </div>

         <div className="space-y-4">
            <h3 className="font-bold text-slate-800 ml-1">已保存的連線 ({dataSources.length})</h3>
            {dataSources.map((source) => (
                <div key={source.id} className="bg-white p-4 rounded-xl border border-slate-200 flex justify-between items-center shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg bg-orange-100 text-orange-600">
                            <CalendarIcon className="w-5 h-5" />
                        </div>
                        <div>
                            <h4 className="font-bold text-slate-800 text-sm">{source.name}</h4>
                            <p className="text-xs text-slate-400 mt-0.5">上次同步: {source.lastUpdated}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="text-xs text-green-600 font-bold px-2 py-1 bg-green-50 rounded-full border border-green-100">已連線</span>
                        <button onClick={() => removeSource(source.id)} className="text-slate-400 hover:text-red-600 transition">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            ))}
         </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col md:flex-row">
      <div className="md:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-30 shadow-sm safe-area-top">
         <div className="flex items-center gap-2 font-bold text-slate-800">
            <div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center">
                <ChefHat className="text-white w-5 h-5" />
            </div>
            <span>BakeryOS</span>
         </div>
         <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-slate-600">
            <Menu className="w-6 h-6" />
         </button>
      </div>

      <Sidebar 
        currentView={currentView} 
        onChangeView={setCurrentView} 
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />
      
      <main className="flex-1 md:ml-64 p-4 md:p-8 h-[calc(100vh-65px)] md:h-screen overflow-y-auto">
         <div className="max-w-4xl mx-auto">
             {renderContent()}
         </div>
      </main>
    </div>
  );
}

export default App;