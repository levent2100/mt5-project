"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  X,
  Search,
  Sliders,
  DollarSign,
  Briefcase,
  Layers,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Info
} from 'lucide-react';
import Link from 'next/link';

interface TradeDetail {
  position_id: number;
  symbol: string;
  direction: 'buy' | 'sell';
  volume: number;
  open_time: number;
  close_time: number;
  open_price: number;
  close_price: number;
  pips: number;
  commission: number;
  swap: number;
  profit: number;
}

interface MatchedGroup {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  open_time: number;
  close_time: number;
  accounts: Record<string, TradeDetail>;
}

export default function TradeLogPage() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [groups, setGroups] = useState<MatchedGroup[]>([]);
  const [activeAccounts, setActiveAccounts] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Filter & Search states
  const [searchSymbol, setSearchSymbol] = useState('');
  const [showDiscrepanciesOnly, setShowDiscrepanciesOnly] = useState(false);
  const [pipVarianceTolerance, setPipVarianceTolerance] = useState(2.0);
  
  // Expanded row state for detail drawer
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // WebSocket reference
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRequests = useRef<Record<string, { resolve: (data: any) => void; reject: (err: any) => void; timeout: any }>>({});

  useEffect(() => {
    const savedTheme = localStorage.getItem('propfirm-tradelog-theme') as 'light' | 'dark';
    if (savedTheme) {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('propfirm-tradelog-theme', theme);
  }, [theme]);

  // Connect WebSocket
  const connectWS = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    // Build WS endpoint based on current page host
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.hostname;
    const wsPort = '9999'; // Backend port
    const wsUrl = `${wsProto}//${wsHost}:${wsPort}/ws`;

    console.log(`Connecting trade log WebSocket to: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Trade Log WebSocket connected.');
      // Fetch initial trades list on connect
      fetchTrades();
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.requestId && pendingRequests.current[payload.requestId]) {
          const { resolve, reject, timeout } = pendingRequests.current[payload.requestId];
          clearTimeout(timeout);
          delete pendingRequests.current[payload.requestId];
          
          if (payload.status === 'ok') {
            resolve(payload.data);
          } else {
            reject(payload.error || 'Failed to fetch trade log');
          }
        }
      } catch (err) {
        console.error('Error handling WS message:', err);
      }
    };

    ws.onclose = () => {
      console.log('Trade Log WebSocket disconnected. Reconnecting...');
      setTimeout(connectWS, 4000);
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  };

  useEffect(() => {
    connectWS();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const sendRequest = (command: string, payload: any = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return reject('WebSocket not connected');
      }

      const requestId = Math.random().toString(36).substring(2, 11);
      const msg = {
        receiver: 'proplink',
        data: {
          requestId,
          command,
          payload
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.current[requestId]) {
          pendingRequests.current[requestId].reject('Request Timeout');
          delete pendingRequests.current[requestId];
        }
      }, 5000); // 5s timeout safety

      pendingRequests.current[requestId] = { resolve, reject, timeout };
      wsRef.current.send(JSON.stringify(msg));
    });
  };

  const fetchTrades = () => {
    if (isFetching) return;
    setIsFetching(true);
    setErrorMsg(null);

    sendRequest('fetch_tradelogs')
      .then((data) => {
        setGroups(data.groups || []);
        setActiveAccounts(data.active_accounts || []);
      })
      .catch((err) => {
        setErrorMsg(err);
      })
      .finally(() => {
        setIsFetching(false);
      });
  };

  // Helper to format UNIX timestamps to standard HH:MM:SS
  const formatTime = (ts: number) => {
    if (!ts) return 'N/A';
    const date = new Date(ts * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  // Helper to check if a matched group contains any discrepancies
  const checkDiscrepancy = (g: MatchedGroup) => {
    // 1. Missing trade check
    const accountsExecuted = Object.keys(g.accounts);
    if (accountsExecuted.length < activeAccounts.length) {
      return { isDiscrepant: true, reason: 'missing_execution' };
    }

    // 2. Pip variance check
    const pipsList = Object.values(g.accounts).map(t => t.pips);
    if (pipsList.length > 1) {
      const minPips = Math.min(...pipsList);
      const maxPips = Math.max(...pipsList);
      if (maxPips - minPips > pipVarianceTolerance) {
        return { isDiscrepant: true, reason: 'pip_variance', diff: (maxPips - minPips).toFixed(1) };
      }
    }

    return { isDiscrepant: false };
  };

  // Filtered & Searched matched groups list
  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      // Filter by symbol search
      if (searchSymbol && !g.symbol.toLowerCase().includes(searchSymbol.toLowerCase())) {
        return false;
      }
      
      // Filter by discrepancies only
      if (showDiscrepanciesOnly) {
        const check = checkDiscrepancy(g);
        if (!check.isDiscrepant) return false;
      }

      return true;
    });
  }, [groups, searchSymbol, showDiscrepanciesOnly, pipVarianceTolerance, activeAccounts]);

  // Statistics summaries
  const stats = useMemo(() => {
    let totalGroups = groups.length;
    let missingTradesCount = 0;
    let highVarianceCount = 0;

    groups.forEach((g) => {
      const check = checkDiscrepancy(g);
      if (check.isDiscrepant) {
        if (check.reason === 'missing_execution') {
          missingTradesCount++;
        } else if (check.reason === 'pip_variance') {
          highVarianceCount++;
        }
      }
    });

    return {
      totalGroups,
      missingTradesCount,
      highVarianceCount,
      totalAlerts: missingTradesCount + highVarianceCount
    };
  }, [groups, activeAccounts, pipVarianceTolerance]);

  return (
    <div className={`min-h-screen font-sans transition-colors duration-200 selection:bg-indigo-500 selection:text-white ${
      theme === 'dark' ? 'bg-[#0A0A0A] text-neutral-100' : 'bg-[#FAFAFA] text-neutral-900'
    }`}>
      
      {/* Header Bar */}
      <header className={`sticky top-0 z-40 backdrop-blur-md border-b py-4 px-6 ${
        theme === 'dark' ? 'bg-[#121212]/90 border-neutral-800' : 'bg-white/90 border-neutral-200'
      }`}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/" className={`p-2 border rounded-lg transition ${
              theme === 'dark' 
                ? 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-800' 
                : 'bg-white border-neutral-250 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
            }`}>
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className={`text-xl font-bold tracking-tight flex items-center gap-2 ${
                theme === 'dark' ? 'text-white' : 'text-neutral-900'
              }`}>
                <Activity className="w-5 h-5 text-indigo-500 animate-pulse" />
                Broker Trade Sync Analyzer
              </h1>
              <p className={`text-xs mt-0.5 ${theme === 'dark' ? 'text-neutral-450' : 'text-neutral-555'}`}>
                Diagnose trade executions, slippage, and pip variances across your active brokers
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={fetchTrades}
              disabled={isFetching}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-lg shadow-indigo-600/15 transition-all active:scale-95"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
              {isFetching ? 'Fetching Trades...' : 'Fetch Today\'s Trades'}
            </button>
            <button
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              className={`p-2 border rounded-lg transition ${
                theme === 'dark' 
                  ? 'bg-neutral-900 border-neutral-800 text-amber-400 hover:text-amber-350 hover:bg-neutral-800' 
                  : 'bg-white border-neutral-250 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
              }`}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-6">
        
        {/* Connection/Error Banner */}
        {errorMsg && (
          <div className="p-4 bg-red-950/40 border border-red-900/50 text-red-200 rounded-xl flex items-start gap-3 animate-fade-in">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Failed to Sync Trade History</p>
              <p className="text-xs text-red-400 mt-0.5">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="ml-auto text-red-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Stats Summary Rows */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className={`p-5 rounded-2xl flex items-center gap-4 border ${
            theme === 'dark' ? 'bg-[#121212] border-neutral-800' : 'bg-white border-neutral-200/80 shadow-xs'
          }`}>
            <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-500">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <p className={`text-xs ${theme === 'dark' ? 'text-neutral-400' : 'text-neutral-550'}`}>Matched Trade Groups</p>
              <p className={`text-2xl font-bold mt-0.5 ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>{stats.totalGroups}</p>
            </div>
          </div>
          
          <div className={`p-5 rounded-2xl flex items-center gap-4 border ${
            theme === 'dark' ? 'bg-[#121212] border-neutral-800' : 'bg-white border-neutral-200/80 shadow-xs'
          }`}>
            <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-500">
              <Briefcase className="w-6 h-6" />
            </div>
            <div>
              <p className={`text-xs ${theme === 'dark' ? 'text-neutral-400' : 'text-neutral-555'}`}>Polled Broker Accounts</p>
              <p className={`text-2xl font-bold mt-0.5 ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>{activeAccounts.length}</p>
            </div>
          </div>

          <div className={`p-5 rounded-2xl flex items-center gap-4 border ${
            theme === 'dark' ? 'bg-[#121212] border-neutral-800' : 'bg-white border-neutral-200/80 shadow-xs'
          }`}>
            <div className={`p-3 rounded-xl ${stats.missingTradesCount > 0 ? 'bg-red-500/10 text-red-500 animate-pulse' : 'bg-gray-500/10 text-gray-400'}`}>
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <p className={`text-xs ${theme === 'dark' ? 'text-neutral-400' : 'text-neutral-555'}`}>Missing Trade Alerts</p>
              <p className={`text-2xl font-bold mt-0.5 ${stats.missingTradesCount > 0 ? 'text-red-500' : theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>{stats.missingTradesCount}</p>
            </div>
          </div>

          <div className={`p-5 rounded-2xl flex items-center gap-4 border ${
            theme === 'dark' ? 'bg-[#121212] border-neutral-800' : 'bg-white border-neutral-200/80 shadow-xs'
          }`}>
            <div className={`p-3 rounded-xl ${stats.highVarianceCount > 0 ? 'bg-yellow-500/10 text-yellow-500' : 'bg-gray-500/10 text-gray-400'}`}>
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className={`text-xs ${theme === 'dark' ? 'text-neutral-400' : 'text-neutral-555'}`}>High Variance (&gt;{pipVarianceTolerance} Pips)</p>
              <p className={`text-2xl font-bold mt-0.5 ${stats.highVarianceCount > 0 ? 'text-yellow-500' : theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>{stats.highVarianceCount}</p>
            </div>
          </div>
        </div>

        {/* Filter Strip */}
        <div className={`p-4 rounded-2xl flex flex-wrap items-center justify-between gap-4 border ${
          theme === 'dark' ? 'bg-[#121212] border-neutral-800' : 'bg-white border-neutral-200 shadow-xs'
        }`}>
          <div className="flex flex-wrap items-center gap-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchSymbol}
                onChange={(e) => setSearchSymbol(e.target.value)}
                placeholder="Search Symbol..."
                className={`pl-10 pr-4 py-2 w-48 border focus:outline-none rounded-xl text-sm transition-all placeholder-neutral-500 ${
                  theme === 'dark'
                    ? 'bg-[#18181C] border-[#222228] text-white focus:border-indigo-500'
                    : 'bg-neutral-50 border-neutral-250 text-neutral-900 focus:border-indigo-500'
                }`}
              />
            </div>

            {/* Discrepancies Only Toggle */}
            <button
              onClick={() => setShowDiscrepanciesOnly(prev => !prev)}
              className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-semibold transition ${
                showDiscrepanciesOnly 
                  ? 'bg-red-500/10 border-red-500/40 text-red-400' 
                  : theme === 'dark'
                    ? 'bg-[#18181C] border-[#222228] text-neutral-300 hover:bg-neutral-800'
                    : 'bg-white border-neutral-250 text-neutral-700 hover:bg-neutral-50 shadow-2xs'
              }`}
            >
              <Sliders className="w-4 h-4" />
              Discrepancies Only
            </button>
          </div>

          <div className="flex items-center gap-3 text-sm">
            <span className={theme === 'dark' ? 'text-neutral-400' : 'text-neutral-550'}>Pip Tolerance:</span>
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="10.0"
              value={pipVarianceTolerance}
              onChange={(e) => setPipVarianceTolerance(parseFloat(e.target.value) || 2.0)}
              className={`w-16 px-2 py-1 border rounded-lg focus:outline-none focus:border-indigo-500 text-center ${
                theme === 'dark' ? 'bg-[#18181C] border-[#222228] text-white' : 'bg-white border-neutral-250 text-neutral-900'
              }`}
            />
            <span className="text-gray-500">pips</span>
          </div>
        </div>

        {/* Trade Logs Comparison Grid */}
        <div className={`border rounded-2xl overflow-hidden shadow-2xl ${
          theme === 'dark' ? 'bg-[#121212] border-neutral-800' : 'bg-white border-neutral-200'
        }`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              <thead>
                <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${
                  theme === 'dark' ? 'bg-[#0A0A0C] border-neutral-800 text-neutral-400' : 'bg-neutral-50 border-neutral-200 text-neutral-500'
                }`}>
                  <th className="py-4 px-5">Symbol / Dir</th>
                  <th className="py-4 px-4">Open/Close Time</th>
                  {activeAccounts.map((accName) => (
                    <th key={accName} className={`py-4 px-4 border-l text-center min-w-[120px] ${
                      theme === 'dark' ? 'border-neutral-800/50' : 'border-neutral-200/50'
                    }`}>
                      {accName}
                    </th>
                  ))}
                  <th className="py-4 px-4 w-12"></th>
                </tr>
              </thead>
              <tbody className={`divide-y text-sm ${
                theme === 'dark' ? 'divide-neutral-800/40' : 'divide-neutral-200/50'
              }`}>
                {filteredGroups.length === 0 ? (
                  <tr>
                    <td colSpan={2 + activeAccounts.length + 1} className="py-12 text-center text-gray-500">
                      {isFetching ? (
                        <div className="flex flex-col items-center gap-2">
                          <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin" />
                          <span className="text-sm">Retrieving journal entries from brokers...</span>
                        </div>
                      ) : (
                        'No matching trade executions found for today.'
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredGroups.map((g) => {
                    const discrepancyCheck = checkDiscrepancy(g);
                    
                    // Identify the first open time in the group for latency tracking
                    const tradeDetailsList = Object.values(g.accounts);
                    const baseOpenTime = tradeDetailsList.length > 0 ? Math.min(...tradeDetailsList.map(t => t.open_time)) : 0;

                    return (
                      <React.Fragment key={g.id}>
                        <tr 
                          className={`cursor-pointer transition ${
                            theme === 'dark' ? 'hover:bg-neutral-900/30' : 'hover:bg-neutral-50'
                          } ${
                            discrepancyCheck.isDiscrepant 
                              ? discrepancyCheck.reason === 'missing_execution'
                                ? 'bg-red-500/[0.02]' 
                                : 'bg-yellow-500/[0.01]'
                              : ''
                          }`}
                          onClick={() => setExpandedGroup(expandedGroup === g.id ? null : g.id)}
                        >
                          {/* Symbol Column */}
                          <td className="py-4 px-5">
                            <div className="flex items-center gap-2">
                              <span className={`font-bold text-base tracking-tight ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>{g.symbol}</span>
                              <span className={`px-2 py-0.5 text-2xs font-extrabold rounded uppercase tracking-wider ${
                                g.direction === 'buy' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                              }`}>
                                {g.direction}
                              </span>
                            </div>
                          </td>

                          {/* Open/Close Time Column */}
                          <td className={`text-xs space-y-0.5 ${theme === 'dark' ? 'text-neutral-450' : 'text-neutral-555'}`}>
                            <div>Open: <span className={`font-semibold ${theme === 'dark' ? 'text-neutral-200' : 'text-neutral-700'}`}>{formatTime(g.open_time)}</span></div>
                            {g.close_time > 0 && (
                              <div>Close: <span className={`font-semibold ${theme === 'dark' ? 'text-neutral-200' : 'text-neutral-700'}`}>{formatTime(g.close_time)}</span></div>
                            )}
                          </td>

                          {/* Dynamic Account Columns */}
                          {activeAccounts.map((accName) => {
                            const trade = g.accounts[accName];
                            if (!trade) {
                              return (
                                <td key={accName} className={`py-4 px-4 border-l text-center align-middle ${
                                  theme === 'dark' ? 'border-neutral-800/30' : 'border-neutral-200/30'
                                }`}>
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-500/10 border border-red-500/30 text-red-500 text-xs font-bold rounded-lg animate-pulse">
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    MISSING
                                  </span>
                                </td>
                              );
                            }

                            // Calculate execution delay relative to the first trade in the group
                            const delay = trade.open_time - baseOpenTime;
                            const delayStr = delay > 0 ? `+${delay}s` : '0s';

                            return (
                              <td key={accName} className={`py-4 px-4 border-l text-center space-y-1 ${
                                theme === 'dark' ? 'border-neutral-800/30' : 'border-neutral-200/30'
                              }`}>
                                <div className="inline-block">
                                  <span className={`inline-flex px-2 py-0.5 font-bold rounded-lg text-xs ${
                                    trade.pips >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                                  }`}>
                                    {trade.pips >= 0 ? '+' : ''}{trade.pips.toFixed(1)} pips
                                  </span>
                                </div>
                                <div className={`text-2xs space-y-0.5 ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-500'}`}>
                                  <div>Price: {trade.open_price} &rarr; {trade.close_price}</div>
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className={delay > 1 ? 'text-yellow-500 font-medium' : 'text-gray-500'}>
                                      Delay: {delayStr}
                                    </span>
                                    {trade.commission !== 0 && (
                                      <span>| Comm: ${trade.commission.toFixed(2)}</span>
                                    )}
                                  </div>
                                </div>
                              </td>
                            );
                          })}

                          {/* Toggle Expand Column */}
                          <td className="py-4 px-4 text-center">
                            {expandedGroup === g.id ? (
                              <ChevronUp className="w-4 h-4 text-gray-500 hover:text-indigo-500 transition" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-500 hover:text-indigo-500 transition" />
                            )}
                          </td>
                        </tr>

                        {/* Expanded Drawer Details */}
                        {expandedGroup === g.id && (
                          <tr className={theme === 'dark' ? 'bg-[#0A0A0C]/40' : 'bg-neutral-50/50'}>
                            <td colSpan={2 + activeAccounts.length + 1} className={`py-4 px-6 border-b ${theme === 'dark' ? 'border-neutral-800' : 'border-neutral-200'}`}>
                              <div className="space-y-4">
                                <div className={`flex items-center gap-2 border-b pb-2 text-xs font-semibold uppercase tracking-wider ${
                                  theme === 'dark' ? 'border-[#222228] text-neutral-450' : 'border-neutral-200/80 text-neutral-500'
                                }`}>
                                  <Info className="w-4 h-4 text-indigo-500" />
                                  <span>Detailed execution journals per account</span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                  {activeAccounts.map((accName) => {
                                    const trade = g.accounts[accName];
                                    if (!trade) {
                                      return (
                                        <div key={accName} className="p-3 bg-red-950/15 border border-red-900/30 rounded-xl space-y-1">
                                          <p className="text-xs font-bold text-red-400 uppercase">{accName}</p>
                                          <p className="text-xs text-red-500 font-medium mt-1">No matched execution journal found.</p>
                                        </div>
                                      );
                                    }

                                    return (
                                      <div key={accName} className={`p-3 border rounded-xl space-y-1.5 text-xs ${
                                        theme === 'dark' 
                                          ? 'bg-[#18181C] border-[#222228] text-neutral-300' 
                                          : 'bg-white border-neutral-250 text-neutral-700 shadow-2xs'
                                      }`}>
                                        <p className={`font-bold border-b pb-1 uppercase flex justify-between ${
                                          theme === 'dark' ? 'text-white border-[#222228]' : 'text-neutral-900 border-neutral-200'
                                        }`}>
                                          <span>{accName}</span>
                                          <span className="text-neutral-400 font-medium">#{trade.position_id}</span>
                                        </p>
                                        <div className="space-y-0.5">
                                          <div>Volume: <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>{trade.volume} lots</span></div>
                                          <div>Open Time: <span className="font-medium text-gray-500">{new Date(trade.open_time * 1000).toLocaleString()}</span></div>
                                          <div>Close Time: <span className="font-medium text-gray-500">{new Date(trade.close_time * 1000).toLocaleString()}</span></div>
                                          <div>Swap Fee: <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>${trade.swap.toFixed(2)}</span></div>
                                          <div>Comm: <span className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>${trade.commission.toFixed(2)}</span></div>
                                          <div>Gross Profit: <span className={`font-semibold ${trade.profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>${trade.profit.toFixed(2)}</span></div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
