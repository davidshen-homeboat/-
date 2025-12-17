import React, { useState } from 'react';
import { Sparkles, Loader2, RefreshCw } from 'lucide-react';
import { analyzeBakeryData } from '../services/geminiService';
import { Reservation } from '../types';
import ReactMarkdown from 'react-markdown';

interface AnalysisCardProps {
  reservations: Reservation[];
}

const AnalysisCard: React.FC<AnalysisCardProps> = ({ reservations }) => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    setLoading(true);
    const result = await analyzeBakeryData(reservations);
    setAnalysis(result);
    setLoading(false);
  };

  return (
    <div className="bg-gradient-to-br from-indigo-900 to-slate-900 text-white rounded-xl p-6 shadow-lg relative overflow-hidden mb-6">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 rounded-full mix-blend-overlay filter blur-3xl opacity-20 -translate-y-1/2 translate-x-1/2"></div>

      <div className="relative z-10">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-yellow-300" />
            <h2 className="text-xl font-bold">AI 訂位助理</h2>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 transition-colors px-3 py-1.5 rounded-lg text-sm font-medium backdrop-blur-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {analysis ? '重新分析' : '分析訂位狀況'}
          </button>
        </div>

        {!analysis && !loading && (
          <div className="text-slate-300 text-sm leading-relaxed">
            點擊「分析訂位狀況」，AI 將掃描近期的訂位資料，協助您安排座位、預估客流量並提醒特殊需求。
          </div>
        )}

        {loading && (
          <div className="py-8 text-center text-slate-300 animate-pulse flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
            <span>正在分析訂位資料...</span>
          </div>
        )}

        {analysis && !loading && (
          <div className="prose prose-invert prose-sm max-w-none max-h-64 overflow-y-auto pr-2 custom-scrollbar">
             <ReactMarkdown>{analysis}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalysisCard;
