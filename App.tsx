import React, { useState, useEffect } from 'react';
import { Search, Link as LinkIcon, Plus, Trash2, Phone, Calendar as CalendarIcon, Menu, ChefHat, Users, Inbox, RefreshCw, Loader2, X, Save, CloudCheck, CloudOff, Globe, FileSpreadsheet, AlertTriangle, Send } from 'lucide-react';
import Sidebar from './components/Sidebar';
import AnalysisCard from './components/AnalysisCard';
import { AppView, Reservation, DataSource } from './types';
import { mapReservationsCSV, fetchCsvFromUrl } from './services/dataProcessor';

const STORAGE_KEY_RESERVATIONS = 'bakery_reservations';
const STORAGE_KEY_SOURCES = 'bakery_sources';

function App() {
  const [currentView, setCurrentView] = useState<AppView>(AppView.RESERVATIONS);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSyncingToCloud, setIsSyncingToCloud] = useState(false);
  
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
    time: '12:00',
    pax: 2,
    type: '內用',
    customerName: '',
    phone: '',
    table: ''
  });

  const [newUrl, setNewUrl] = useState('');
  const [newWriteUrl, setNewWriteUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [loadingSource, setLoadingSource] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RESERVATIONS, JSON.stringify(reservations));
  }, [reservations]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SOURCES, JSON.stringify(dataSources));
  }, [dataSources]);

  // 更強健的同步函數：確保內容正確封裝
  const syncToGoogleSheet = async (res: Reservation) => {
    const primarySource = dataSources.find(s => s.writeUrl);
    if (!primarySource?.writeUrl) return 'pending';

    try {
      // GAS 對於 POST 請求的內容非常挑剔，使用 text/plain 並確保 JSON 字串完整
      await fetch(primarySource.writeUrl, {
        method: 'POST',
        mode: 'no-cors', // 必須使用 no-cors 避免瀏覽器攔截
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(res)
      });
      return 'synced';
    } catch (e) {
      console.error("Cloud Sync Error", e);
      return 'failed';
    }
  };

  const handleSaveReservation = async () => {
    if (!form.customerName || !form.date) {
      alert('請填寫姓名與日期');
      return;
    }

    setIsSyncingToCloud(true);
    const newRes: Reservation = {
      ...(form as Reservation),
      id: `local-${Date.now()}`,
      isLocal: true,
      syncStatus: 'pending'
    };

    const status = await syncToGoogleSheet(newRes);
    newRes.syncStatus = status as any;

    setReservations([newRes, ...reservations]);
    setIsSyncingToCloud(false);
    setIsModalOpen(false);
    
    // 重置表單
    setForm({
      date: new Date().toISOString().split('T')[0],
      time: '12:00',
      pax: 2,
      type: '內用',
      customerName: '',
      phone: '',
      table: ''
    });
  };

  const handleRetrySync = async (res: Reservation) => {
    const status = await syncToGoogleSheet(res);
    setReservations(prev => prev.map(r => 
      r.id === res.id ? { ...r, syncStatus: status as any } : r
    ));
    if (status === 'synced') alert('雲端同步成功！');
    else alert('同步依然失敗，請確認 Apps Script 部署連結是否正確。');
  };

  const batchRetrySync = async () => {
    const pendingItems = reservations.filter(r => r.isLocal && r.syncStatus !== 'synced');
    if (pendingItems.length === 0) {
      alert('沒有需要同步的項目');
      return;
    }
    
    setSyncingAll(true);
    let successCount = 0;
    for (const item of pendingItems) {
       const status = await syncToGoogleSheet(item);
       if (status === 'synced') {
         successCount++;
         setReservations(prev => prev.map(r => r.id === item.id ? {...r, syncStatus: 'synced'} : r));
       }
    }
    setSyncingAll(false);
    alert(`批量同步結束：成功 ${successCount} 筆`);
  };

  const handleAddSource = async () => {
    if (!newUrl) {
      setErrorMsg('請輸入 Google Sheet CSV 連結');
      return;
    }
    setLoadingSource(true);
    setErrorMsg('');

    try {
      const csvText = await fetchCsvFromUrl(newUrl);
      const parsedData = mapReservationsCSV(csvText);
      
      setDataSources([...dataSources, {
        id: Date.now().toString(),
        name: newName || `訂位表 ${dataSources.length + 1}`,
        url: newUrl,
        writeUrl: newWriteUrl,
        type: 'RESERVATIONS',
        lastUpdated: new Date().toLocaleString(),
        status: 'ACTIVE'
      }]);
      setNewUrl('');
      setNewWriteUrl('');
      setNewName('');
      setLoadingSource(false);
      setCurrentView(AppView.RESERVATIONS);
    } catch (e: any) {
      setErrorMsg('連結失敗，請檢查網址並確保已發佈為 CSV。');
      setLoadingSource(false);
    }
  };

  const handleSyncAll = async () => {
    if (dataSources.length === 0) return;
    setSyncingAll(true);
    let allRemote: Reservation[] = [];
    const localItems = reservations.filter(p => p.isLocal);
    
    try {
        for (const source of dataSources) {
            const csvText = await fetchCsvFromUrl(source.url);
            const parsed = mapReservationsCSV(csvText);
            allRemote = [...allRemote, ...parsed];
        }
        setReservations([...localItems, ...allRemote]);
        setDataSources(prev => prev.map(s => ({...s, lastUpdated: new Date().toLocaleString()})));
    } catch (e) {
        alert("從雲端載入失敗。");
    } finally {
        setSyncingAll(false);
    }
  };

  const removeSource = (id: string) => {
    if (confirm('確定移除連線？')) {
        setDataSources(dataSources.filter(ds => ds.id !== id));
    }
  };

  const formatDateDisplay = (dateStr: string) => {
    const date = new Date(dateStr);
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `${date.getMonth() + 1}/${date.getDate()} (週${days[date.getDay()]})`;
  };

  const renderContent = () => {
    if (currentView === AppView.RESERVATIONS) {
      const filteredRes = reservations.filter(res => 
         res.customerName.includes(searchTerm) || res.date.includes(searchTerm) || (res.phone && res.phone.includes(searchTerm))
      );
      
      const groupedRes = filteredRes.reduce((groups: any, res) => {
         const date = res.date;
         if (!groups[date]) groups[date] = [];
         groups[date].push(res);
         return groups;
      }, {});
      const sortedResDates = Object.keys(groupedRes).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

      return (
         <div className="space-y-6 animate-fade-in pb-24 relative">
            <div className="flex justify-between items-end px-2">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 tracking-tight">訂位列表</h1>
                    <p className="text-slate-400 text-xs mt-1">即時同步至 Google Sheet</p>
                </div>
                <button 
                    onClick={handleSyncAll}
                    disabled={syncingAll}
                    className="p-2.5 bg-white border border-slate-200 rounded-2xl text-slate-600 hover:bg-slate-50 shadow-sm flex items-center gap-2 text-sm font-bold transition-all active:scale-95"
                >
                    {syncingAll ? <Loader2 className="w-4 h-4 animate-spin text-orange-600" /> : <RefreshCw className="w-4 h-4 text-orange-600" />}
                    更新清單
                </button>
            </div>

            <AnalysisCard type="RESERVATIONS" data={filteredRes} />
            
            <div className="sticky top-0 bg-slate-50/80 backdrop-blur-md pt-2 pb-4 z-20 px-1">
                 <div className="relative w-full">
                    <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input 
                        type="text" 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="搜尋顧客、電話、日期..." 
                        className="w-full pl-12 pr-4 py-4 border-none rounded-2xl shadow-sm focus:ring-2 focus:ring-orange-500 bg-white placeholder:text-slate-300 font-medium" 
                    />
                 </div>
            </div>

            <div className="space-y-10 px-1">
                {sortedResDates.length === 0 && (
                    <div className="text-center py-20 bg-white rounded-3xl border border-slate-100 shadow-sm">
                        <Inbox className="w-16 h-16 mx-auto mb-4 text-slate-100" />
                        <p className="text-slate-300 font-bold">目前沒有任何訂位</p>
                    </div>
                )}
                {sortedResDates.map(date => (
                    <div key={date}>
                        <div className="flex items-center gap-2 mb-4 sticky top-24 bg-slate-50/50 backdrop-blur-sm py-2 z-10">
                            <CalendarIcon className="w-5 h-5 text-orange-600" />
                            <h2 className="text-xl font-black text-slate-800">{formatDateDisplay(date)}</h2>
                            <div className="h-px flex-1 bg-slate-200 ml-2"></div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                            {groupedRes[date].map((res: Reservation) => (
                                <div key={res.id} className={`group p-6 rounded-3xl shadow-sm border relative overflow-hidden transition-all hover:shadow-xl hover:-translate-y-1 ${res.isLocal ? 'border-orange-100 bg-white' : 'bg-amber-50/50 border-amber-100'}`}>
                                    <div className="absolute top-3 right-3">
                                        {res.isLocal && (
                                            res.syncStatus === 'synced' ? 
                                            <div className="flex items-center gap-1 text-[10px] font-black bg-green-500 text-white px-3 py-1 rounded-full shadow-sm"><CloudCheck className="w-3 h-3" /> 已雲端同步</div> :
                                            <button onClick={() => handleRetrySync(res)} className="flex items-center gap-1 text-[10px] font-black bg-rose-500 text-white px-3 py-1 rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all"><CloudOff className="w-3 h-3" /> 點此重試同步</button>
                                        )}
                                    </div>
                                    <div className="flex justify-between items-start mb-4 mt-2">
                                        <div className="flex gap-2 items-center">
                                            <div className="bg-slate-900 text-white px-3 py-1.5 rounded-xl text-sm font-black shadow-lg shadow-slate-200">{res.time}</div>
                                            <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500">{res.type}</span>
                                        </div>
                                    </div>
                                    <div className="flex justify-between items-end mb-4">
                                        <div>
                                            <h3 className="font-black text-2xl text-slate-800 mb-1">{res.customerName}</h3>
                                            <div className="flex items-center gap-2 text-sm text-slate-400 font-bold">
                                                <Phone className="w-3.5 h-3.5" />
                                                {res.phone || '未留電話'}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end">
                                            <div className="flex items-center gap-1 text-orange-600 font-black text-lg">
                                                <Users className="w-5 h-5" />
                                                <span>{res.pax}</span>
                                            </div>
                                            {res.table && <span className="text-[10px] font-bold text-slate-400">桌號: {res.table}</span>}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <button 
                onClick={() => setIsModalOpen(true)}
                className="fixed bottom-8 right-8 w-16 h-16 bg-orange-600 text-white rounded-3xl shadow-2xl shadow-orange-200 flex items-center justify-center hover:bg-orange-700 hover:rotate-90 hover:scale-110 active:scale-95 transition-all z-40"
            >
                <Plus className="w-10 h-10" />
            </button>
         </div>
      );
    }

    return (
      <div className="space-y-8 max-w-4xl mx-auto animate-fade-in pb-20">
         <div className="p-10 bg-indigo-600 rounded-[40px] text-white shadow-2xl relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-indigo-400 rounded-full blur-2xl"></div>
            <h1 className="text-4xl font-black relative z-10 tracking-tight">雲端控制中心</h1>
            <p className="text-indigo-100 mt-2 text-base relative z-10 font-medium">雙向橋接您的 App 與 Google 試算表。</p>
            
            <button 
              onClick={batchRetrySync}
              disabled={syncingAll}
              className="mt-6 flex items-center gap-2 bg-white text-indigo-600 px-6 py-3 rounded-2xl font-black text-sm shadow-xl hover:bg-indigo-50 transition-all active:scale-95 disabled:opacity-50"
            >
              {syncingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              批量同步失敗項目
            </button>
         </div>

         <div className="bg-white rounded-[40px] shadow-xl border border-slate-50 overflow-hidden">
            <div className="px-10 py-8 border-b border-slate-50 flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center">
                    <Globe className="w-6 h-6 text-indigo-600" />
                </div>
                <h3 className="font-black text-slate-800 text-xl">連結新的試算表</h3>
            </div>
            <div className="p-10 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <label className="block text-xs font-black text-slate-400 mb-3 uppercase tracking-widest">檔案標籤</label>
                        <input type="text" value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="例如：總店訂位總表" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 transition-all font-bold" />
                    </div>
                    <div>
                        <label className="block text-xs font-black text-slate-400 mb-3 uppercase tracking-widest">讀取連結 (CSV)</label>
                        <input type="text" value={newUrl} onChange={(e)=>setNewUrl(e.target.value)} placeholder="貼上 CSV 發佈連結" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 transition-all font-bold" />
                    </div>
                </div>
                <div className="p-8 bg-orange-50/50 rounded-[32px] border border-orange-100">
                    <label className="block text-xs font-black text-orange-800 mb-3 flex items-center gap-2 uppercase tracking-widest">
                        Apps Script 寫入連結 (API)
                        <span className="bg-orange-600 text-white px-2 py-0.5 rounded text-[8px]">必填</span>
                    </label>
                    <input type="text" value={newWriteUrl} onChange={(e)=>setNewWriteUrl(e.target.value)} placeholder="https://script.google.com/macros/s/..." className="w-full px-5 py-4 bg-white border-none rounded-2xl focus:ring-2 focus:ring-orange-600 transition-all font-bold" />
                    <div className="mt-4 flex items-start gap-3 p-4 bg-white/50 rounded-2xl border border-orange-100/50">
                        <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0" />
                        <div className="text-xs text-orange-800 leading-relaxed font-medium">
                            <b>重要：</b> 請在 GAS 部署時，將「誰可以存取」設為<b>「任何人 (Anyone)」</b>。如果剛更新完代碼，請務必重新部署<b>新版本</b>，否則會出現 `postData` 錯誤。
                        </div>
                    </div>
                </div>
                <button onClick={handleAddSource} disabled={loadingSource} className="w-full bg-indigo-600 text-white py-5 rounded-3xl font-black text-lg shadow-2xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-50">
                    {loadingSource ? '正在驗證連線...' : '立即建立同步'}
                </button>
                {errorMsg && <div className="mt-2 text-sm text-rose-600 text-center font-bold bg-rose-50 p-3 rounded-2xl">{errorMsg}</div>}
            </div>
         </div>

         <div className="space-y-4 px-2">
            <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                <div className="w-2 h-6 bg-indigo-600 rounded-full"></div>
                目前的連線
            </h3>
            {dataSources.length === 0 && <p className="text-slate-300 text-center py-10 font-bold">尚未建立任何雲端連線</p>}
            {dataSources.map(source => (
                <div key={source.id} className="bg-white p-6 rounded-[32px] border border-slate-100 flex justify-between items-center shadow-sm hover:shadow-lg transition-all">
                    <div className="flex items-center gap-5">
                        <div className="p-4 rounded-2xl bg-indigo-50 text-indigo-600">
                           <FileSpreadsheet className="w-7 h-7" />
                        </div>
                        <div>
                            <h4 className="font-black text-lg text-slate-800">{source.name}</h4>
                            <div className="flex gap-2 mt-1">
                                <span className="text-[10px] font-black px-3 py-1 bg-green-500 text-white rounded-full">讀取中</span>
                                {source.writeUrl && <span className="text-[10px] font-black px-3 py-1 bg-orange-500 text-white rounded-full">同步寫入中</span>}
                            </div>
                        </div>
                    </div>
                    <button onClick={() => removeSource(source.id)} className="p-3 text-slate-200 hover:text-rose-600 transition-colors hover:bg-rose-50 rounded-2xl"><Trash2 className="w-6 h-6" /></button>
                </div>
            ))}
         </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col md:flex-row">
      {/* Mobile Top Bar */}
      <div className="md:hidden bg-white border-b border-slate-100 p-5 flex items-center justify-between sticky top-0 z-30 shadow-sm safe-area-top">
         <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200">
                <ChefHat className="text-white w-6 h-6" />
            </div>
            <span className="font-black text-xl tracking-tight">BakeryOS</span>
         </div>
         <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-slate-800 bg-slate-50 rounded-xl"><Menu className="w-6 h-6" /></button>
      </div>

      <Sidebar currentView={currentView} onChangeView={setCurrentView} isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />
      
      <main className="flex-1 md:ml-64 p-5 md:p-12 h-[calc(100vh-65px)] md:h-screen overflow-y-auto custom-scrollbar">
         <div className="max-w-4xl mx-auto">{renderContent()}</div>
      </main>

      {/* Manual Add Modal */}
      {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-500" onClick={() => !isSyncingToCloud && setIsModalOpen(false)}></div>
              <div className="bg-white w-full max-w-xl rounded-[40px] shadow-2xl relative z-10 overflow-hidden animate-in fade-in zoom-in duration-300">
                  <div className="bg-orange-600 p-10 text-white flex justify-between items-center relative">
                      <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
                      <div className="flex items-center gap-4 relative z-10">
                          <Plus className="w-8 h-8 font-black" />
                          <h2 className="text-3xl font-black tracking-tight">新增訂位</h2>
                      </div>
                      <button onClick={() => setIsModalOpen(false)} disabled={isSyncingToCloud} className="p-2 hover:bg-white/20 rounded-2xl transition-colors relative z-10"><X className="w-8 h-8" /></button>
                  </div>
                  <div className="p-10 space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                          <div><label className="block text-xs font-black text-slate-400 mb-3 uppercase tracking-widest">日期</label><input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" /></div>
                          <div><label className="block text-xs font-black text-slate-400 mb-3 uppercase tracking-widest">時間</label><input type="time" value={form.time} onChange={e => setForm({...form, time: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                          <div><label className="block text-xs font-black text-slate-400 mb-3 uppercase tracking-widest">顧客姓名</label><input type="text" value={form.customerName} onChange={e => setForm({...form, customerName: e.target.value})} placeholder="例如：林先生" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" /></div>
                          <div><label className="block text-xs font-black text-slate-400 mb-3 uppercase tracking-widest">人數</label><input type="number" value={form.pax} onChange={e => setForm({...form, pax: parseInt(e.target.value)})} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" /></div>
                      </div>
                      <div><label className="block text-xs font-black text-slate-400 mb-3 uppercase tracking-widest">聯絡電話</label><input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="09xx-xxx-xxx" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" /></div>
                      <div className="grid grid-cols-2 gap-6">
                          <div><label className="block text-xs font-black text-slate-400 mb-3 uppercase tracking-widest">類型</label><select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500"><option>內用</option><option>外帶</option><option>包場</option></select></div>
                          <div><label className="block text-xs font-black text-slate-400 mb-3 uppercase tracking-widest">預排桌號</label><input type="text" value={form.table} onChange={e => setForm({...form, table: e.target.value})} placeholder="例如：A1" className="w-full px-5 py-4 bg-slate-50 border-none rounded-2xl font-bold focus:ring-2 focus:ring-orange-500" /></div>
                      </div>
                      <button 
                          onClick={handleSaveReservation} 
                          disabled={isSyncingToCloud}
                          className="w-full bg-slate-900 text-white py-5 rounded-[24px] font-black text-lg flex items-center justify-center gap-3 hover:bg-black transition-all shadow-2xl active:scale-95 disabled:opacity-50 mt-4"
                      >
                          {isSyncingToCloud ? <Loader2 className="w-6 h-6 animate-spin text-orange-500" /> : <Save className="w-6 h-6" />}
                          {isSyncingToCloud ? '正在同步至 Google Sheet...' : '確認新增並同步雲端'}
                      </button>
                      {dataSources.every(s => !s.writeUrl) && (
                          <div className="flex items-center gap-2 p-4 bg-rose-50 rounded-2xl text-rose-600 text-xs font-bold">
                              <AlertTriangle className="w-4 h-4" />
                              尚未設定 API，資料將僅保存在本地設備。
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

export default App;