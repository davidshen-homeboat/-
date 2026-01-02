
import React, { useMemo } from 'react';
import { CalendarDays, Store, Info, AlertCircle, Clock, UserCheck, Database } from 'lucide-react';
import { RosterData } from '../types';

const STORAGE_KEY_ROSTER_MAP = 'bakery_roster_map_v1';

const WeeklyRosterView: React.FC = () => {
  const rosterMap: Record<string, RosterData> = useMemo(() => {
    const saved = localStorage.getItem(STORAGE_KEY_ROSTER_MAP);
    return saved ? JSON.parse(saved) : {};
  }, []);

  const weekData = useMemo(() => {
    if (Object.keys(rosterMap).length === 0) return null;

    const today = new Date();
    const currentDay = today.getDay();
    const diffToMonday = (currentDay === 0 ? -6 : 1) - currentDay;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMonday);
    
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      
      const dayNum = date.getDate();
      const monthNum = date.getMonth() + 1;
      const yearNum = date.getFullYear();
      
      const lookupKey = `${yearNum}-${monthNum}`;

      const targetRoster = rosterMap[lookupKey];
      const dateStr = date.toLocaleDateString('zh-TW', { weekday: 'short', month: 'numeric', day: 'numeric' });

      let staffAtWork: any[] = [];
      if (targetRoster) {
        staffAtWork = targetRoster.staffs.map(staff => {
          const shift = staff.shifts.find(s => s.date === dayNum);
          if (!shift) return null;
          const sVal = (shift.shift || '').toUpperCase();
          const isRest = sVal === 'OFF' || sVal === '休' || sVal === 'X' || sVal === '';
          return isRest ? null : { ...staff, shift: shift.shift };
        }).filter(Boolean);
      }

      days.push({
        fullDate: date,
        dateStr,
        dayNum,
        isToday: date.toDateString() === today.toDateString(),
        hasData: !!targetRoster,
        staffAtWork,
        targetMonthLabel: `${yearNum} 年 ${monthNum} 月`
      });
    }
    return days;
  }, [rosterMap]);

  const getShiftColor = (shift: string) => {
    const s = shift?.toUpperCase();
    switch (s) {
      case 'A': return 'bg-rose-100 text-rose-800 border-rose-200';
      case 'B': return 'bg-sky-100 text-sky-800 border-sky-200';
      case 'C': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default: return 'bg-slate-50 text-slate-500 border-slate-100';
    }
  };

  if (Object.keys(rosterMap).length === 0) {
    return (
      <div className="bg-white rounded-[40px] p-24 flex flex-col items-center justify-center border text-center">
        <Database className="w-12 h-12 text-slate-300 mb-6" />
        <h3 className="text-2xl font-black text-slate-800">尚未同步班表資料</h3>
        <p className="text-slate-400 font-bold mt-3 max-w-sm mx-auto">請先至「班表中心」點擊各分頁進行同步。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">本週值班人員</h1>
          <p className="text-slate-500 font-bold text-sm">系統將自動根據每一天日期匹配對應班表</p>
        </div>
        <div className="bg-white border rounded-2xl px-4 py-2 flex items-center gap-2 shadow-sm">
          <UserCheck className="w-4 h-4 text-orange-600" />
          <span className="text-xs font-black text-slate-700">精準日期對齊</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {weekData?.map((day, idx) => (
          <div key={idx} className={`rounded-[32px] border transition-all ${day.isToday ? 'bg-white border-orange-500 shadow-2xl scale-[1.02] ring-4 ring-orange-50' : 'bg-white border-slate-200 shadow-sm'}`}>
            <div className={`p-6 border-b flex justify-between items-center ${day.isToday ? 'bg-orange-500 text-white rounded-t-[28px]' : 'bg-slate-50/50 rounded-t-[32px]'}`}>
               <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-2xl flex flex-col items-center justify-center font-black ${day.isToday ? 'bg-white text-orange-600' : 'bg-slate-900 text-white'}`}>
                    <span className="text-[10px] uppercase opacity-60 mb-0.5">{day.fullDate.toLocaleDateString('zh-TW', {weekday: 'short'})}</span>
                    <span className="text-lg leading-none">{day.dayNum}</span>
                  </div>
                  <div>
                    <h3 className={`text-xl font-black ${day.isToday ? 'text-white' : 'text-slate-800'}`}>{day.dateStr}</h3>
                    <p className={`text-[10px] font-bold tracking-widest ${day.isToday ? 'text-white/70' : 'text-slate-400'}`}>
                      {day.hasData ? `${day.staffAtWork.length} 位上班 (${day.targetMonthLabel})` : `尚未同步 ${day.targetMonthLabel} 班表`}
                    </p>
                  </div>
               </div>
            </div>
            <div className="p-6">
              {day.hasData ? (
                day.staffAtWork.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {day.staffAtWork.map((staff: any, sIdx: number) => (
                      <div key={sIdx} className="flex items-center gap-4 p-4 bg-slate-50/50 rounded-2xl border border-slate-100 group">
                        <div className={`w-12 h-12 rounded-xl border flex items-center justify-center font-black text-lg shadow-sm ${getShiftColor(staff.shift)}`}>{staff.shift}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[9px] font-black text-orange-600 uppercase tracking-wider mb-0.5 truncate"><Store className="w-2.5 h-2.5 inline mr-1" />{staff.shopName}</div>
                          <h4 className="font-black text-slate-800 truncate">{staff.staffName}</h4>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="py-8 flex flex-col items-center text-slate-300 opacity-60"><Clock className="w-8 h-8 mb-2" /><p className="text-sm font-bold">全員休息</p></div>
              ) : (
                <div className="py-8 border border-dashed rounded-3xl flex flex-col items-center text-rose-300">
                  <Info className="w-8 h-8 mb-2" />
                  <p className="text-sm font-bold italic">請至「班表中心」點擊同步 {day.targetMonthLabel} 分頁資料</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default WeeklyRosterView;
