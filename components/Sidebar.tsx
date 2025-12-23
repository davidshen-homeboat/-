
import React from 'react';
import { CalendarDays, Link as LinkIcon, X, ChefHat, ClipboardList } from 'lucide-react';
import { AppView } from '../types';

interface SidebarProps {
  currentView: AppView;
  onChangeView: (view: AppView) => void;
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, isOpen, onClose }) => {
  const menuItems = [
    { id: AppView.RESERVATIONS, label: '訂位管理', icon: CalendarDays },
    { id: AppView.ROSTER, label: '班表顯示系統', icon: ClipboardList },
    { id: AppView.INTEGRATION, label: '資料來源設定', icon: LinkIcon },
  ];

  const handleNavClick = (id: AppView) => {
    onChangeView(id);
    onClose(); 
  };

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 bg-slate-900/50 z-30 transition-opacity duration-300 md:hidden ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      <aside 
        className={`w-64 bg-slate-900 text-white flex flex-col h-screen fixed left-0 top-0 shadow-xl z-40 transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
      >
        <div className="p-6 border-b border-slate-700 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
              <ChefHat className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">BakeryOS</h1>
              <p className="text-xs text-slate-400">專屬營運系統</p>
            </div>
          </div>
          <button onClick={onClose} className="md:hidden text-slate-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors duration-200 text-sm font-medium ${
                currentView === item.id
                  ? 'bg-orange-600 text-white shadow-md'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700 text-center text-xs text-slate-500">
          v4.0 Roster Active
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
