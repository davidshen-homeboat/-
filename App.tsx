import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Search, Link as LinkIcon, Plus, Trash2, Phone, Calendar as CalendarIcon, Menu, ChefHat, Users } from 'lucide-react';
import Sidebar from './components/Sidebar';
import AnalysisCard from './components/AnalysisCard';
import { MOCK_RESERVATIONS } from './constants';
import { AppView, Reservation, DataSource } from './types';
import { mapReservationsCSV, fetchCsvFromUrl } from './services/dataProcessor';

function App() {
  const [currentView, setCurrentView] = useState<AppView>(AppView.RESERVATIONS);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Data State
  const [reservations, setReservations] = useState<Reservation[]>(MOCK_RESERVATIONS);
  
  // Integration State
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [loadingSource, setLoadingSource] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  const handleAddSource = async () => {
    if (!newUrl) {
      setErrorMsg('請輸入 Google Sheet 網址');
      return;
    }
    setLoadingSource(true);
    setErrorMsg('');

    const sourceId = Date.now().toString();

    try {
      const csvText = await fetchCsvFromUrl(newUrl);
      
      const parsedData = mapReservationsCSV(csvText);
      if (parsedData.length > 0) {
        setReservations(prev => [...prev, ...parsedData]);
      } else {
        throw new Error('無法解析資料，請檢查欄位格式');
      }

      const newSource: DataSource = {
        id: sourceId,
        name: newName || `Sheet ${dataSources.length + 1}`,
        url: newUrl,
        type: 'RESERVATIONS',
        lastUpdated: new Date().toLocaleTimeString(),
        status: 'ACTIVE'
      };

      setDataSources([...dataSources, newSource]);
      setNewUrl('');
      setNewName('');
      setLoadingSource(false);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || '連線失敗，請確認連結權限');
      setLoadingSource(false);
    }
  };

  const removeSource = (id: string) => {
    const source = dataSources.find(ds => ds.id === id);
    if (!source) return;

    setDataSources(prev => prev.filter(ds => ds.id !== id));
    // If no custom sources remain, reset to mock data
    // This is a simplification; in a real app we'd filter out specific IDs
    const hasRemaining = dataSources.some(ds => ds.id !== id);
    if (!hasRemaining) {
        setReservations(MOCK_RESERVATIONS);
    }
  };

  // Helpers
  const formatDateDisplay = (dateStr: string) => {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    return `${month}/${day} (週${days[date.getDay()]})`;
  };

  const renderContent = () => {
    switch (currentView) {
      case AppView.RESERVATIONS:
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
             <div className="space-y-6 animate-fade-in pb-20">
                <div className="flex flex-col gap-2">
                    <h1 className="text-xl md:text-2xl font-bold text-slate-800">訂位紀錄</h1>
                    <p className="text-slate-500 text-sm">管理餐廳內用、包場與外帶預約</p>
                </div>
                <AnalysisCard type="RESERVATIONS" data={filteredRes} />
                
                <div className="sticky top-0 bg-slate-50 pt-2 pb-4 z-20">
                     <div className="relative w-full">
                        <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input 
                            type="text" 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="搜尋日期、姓名或電話..." 
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
                                            {res.notes && <div className="text-sm text-slate-600 italic bg-white/30 p-2 rounded-lg">{res.notes}</div>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
             </div>
          );

      case AppView.INTEGRATION:
        return (
          <div className="space-y-6 max-w-4xl mx-auto animate-fade-in pb-20">
             <div className="text-center py-6">
                <h1 className="text-xl md:text-2xl font-bold text-slate-800">資料源管理</h1>
                <p className="text-sm md:text-base text-slate-500 mt-2">連結 Google Sheet 以同步訂位資料</p>
             </div>

             <div className="bg-white rounded-xl shadow-md border border-indigo-100 overflow-hidden">
                <div className="bg-indigo-50 px-4 md:px-6 py-4 border-b border-indigo-100 flex items-center gap-3">
                    <div className="bg-white p-1.5 rounded-md shadow-sm">
                        <Plus className="w-5 h-5 text-indigo-600" />
                    </div>
                    <h3 className="font-bold text-indigo-900">新增訂位表單</h3>
                </div>
                <div className="p-4 md:p-6">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                        <div className="md:col-span-12 lg:col-span-4">
                            <label className="block text-xs font-bold text-slate-500 mb-1">名稱</label>
                            <input 
                                type="text" 
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="例如: 12月訂位表" 
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                        <div className="md:col-span-12 lg:col-span-8">
                            <label className="block text-xs font-bold text-slate-500 mb-1">Google Sheet 網址</label>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={newUrl}
                                    onChange={(e) => setNewUrl(e.target.value)}
                                    placeholder="https://docs.google.com/..." 
                                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <button 
                                    onClick={handleAddSource}
                                    disabled={loadingSource}
                                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50 whitespace-nowrap"
                                >
                                    {loadingSource ? '連線中...' : '連結'}
                                </button>
                            </div>
                        </div>
                    </div>
                    {errorMsg && (
                        <div className="mt-3 text-xs text-red-600 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> {errorMsg}
                        </div>
                    )}
                    <div className="mt-4 p-3 bg-slate-50 rounded-lg text-xs text-slate-500">
                        <p className="font-bold mb-1">CSV 欄位格式說明：</p>
                        <p>A欄:日期, C欄:類型(內用/外帶), D欄:時間, E欄:人數, F欄:姓名, G欄:電話, H欄: 備註, I欄: 桌號</p>
                    </div>
                </div>
             </div>

             <div className="space-y-4">
                <h3 className="font-bold text-slate-800 ml-1">已連結的檔案 ({dataSources.length})</h3>
                {dataSources.length === 0 ? (
                    <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                        <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                        <p className="text-slate-500 text-sm">尚未連結任何檔案，目前顯示範例數據。</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        {dataSources.map((source) => (
                            <div key={source.id} className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center shadow-sm gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="p-2 rounded-lg bg-orange-100 text-orange-600">
                                        <CalendarIcon className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm md:text-base">{source.name}</h4>
                                        <div className="flex flex-wrap items-center gap-2 md:gap-3 text-xs text-slate-500 mt-0.5">
                                            <span className="px-2 py-0.5 bg-slate-100 rounded border border-slate-200 whitespace-nowrap">訂位資料</span>
                                            <span className="whitespace-nowrap">更新: {source.lastUpdated}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                                    <span className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full border border-green-100 whitespace-nowrap">
                                        <CheckCircle2 className="w-3 h-3" /> 連線正常
                                    </span>
                                    <button 
                                        onClick={() => removeSource(source.id)}
                                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                                        title="移除此連結"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
             </div>
          </div>
        );

      default:
        return <div className="p-10">Error</div>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-30 shadow-sm safe-area-top">
         <div className="flex items-center gap-2 font-bold text-slate-800">
            <div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center">
                <ChefHat className="text-white w-5 h-5" />
            </div>
            <span>BakeryOS</span>
         </div>
         <button 
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg active:scale-95 transition"
         >
            <Menu className="w-6 h-6" />
         </button>
      </div>

      <Sidebar 
        currentView={currentView} 
        onChangeView={setCurrentView} 
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
      />
      
      {/* Content Area */}
      <main className="flex-1 md:ml-64 p-4 md:p-8 overflow-y-auto h-[calc(100vh-65px)] md:h-screen transition-all scroll-smooth">
         <div className="max-w-4xl mx-auto">
             {renderContent()}
         </div>
      </main>
    </div>
  );
}

export default App;