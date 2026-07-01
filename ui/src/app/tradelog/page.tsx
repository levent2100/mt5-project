"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  X,
  Search,
  Sliders,
  Briefcase,
  Layers,
  ChevronDown,
  ChevronUp,
  TrendingUp,
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
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
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
    } else {
      setTheme('light');
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

  const [symbolMap, setSymbolMap] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/symbols')
      .then((res) => res.json())
      .then((data) => setSymbolMap(data))
      .catch((err) => {
        console.error('Failed to load symbol map:', err);
        setSymbolMap({});
      });
  }, []);

  const connectWS = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = window.location.hostname;
    const wsPort = '9999';
    const wsUrl = `${wsProto}//${wsHost}:${wsPort}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
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
      }, 5000);

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
        const mappedGroups = (data.groups || []).map((g: MatchedGroup) => ({
          ...g,
          symbol: symbolMap[g.symbol] || g.symbol,
        }));
        setGroups(mappedGroups);
        setActiveAccounts(data.active_accounts || []);
      })
      .catch((err) => {
        setErrorMsg(err);
      })
      .finally(() => {
        setIsFetching(false);
      });
  };

  // Helper to format UNIX timestamps to standard HH:MM:SS (No Date)
  const formatTime = (ts: number) => {
    if (!ts) return '-';
    const date = new Date(ts * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  const checkDiscrepancy = (g: MatchedGroup) => {
    const accountsExecuted = Object.keys(g.accounts);
    if (accountsExecuted.length < activeAccounts.length) {
      return { isDiscrepant: true, reason: 'missing_execution' };
    }

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

  const filteredGroups = useMemo(() => {
    return groups.filter((g) => {
      if (searchSymbol && !g.symbol.toLowerCase().includes(searchSymbol.toLowerCase())) {
        return false;
      }
      if (showDiscrepanciesOnly) {
        const check = checkDiscrepancy(g);
        if (!check.isDiscrepant) return false;
      }
      return true;
    });
  }, [groups, searchSymbol, showDiscrepanciesOnly, pipVarianceTolerance, activeAccounts]);

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

    return { totalGroups, missingTradesCount, highVarianceCount };
  }, [groups, activeAccounts, pipVarianceTolerance]);

  return (
    <div className={`min-h-screen font-sans transition-colors duration-200 selection:bg-indigo-500 selection:text-white ${theme === 'dark' ? 'bg-[#0A0A0A] text-neutral-100' : 'bg-[#F4F4F5] text-neutral-900'
      }`}>

      {/* Header Bar - Full Width */}
      <header className={`sticky top-0 z-40 backdrop-blur-md border-b py-3 px-6 w-full ${theme === 'dark' ? 'bg-[#121212]/90 border-neutral-800' : 'bg-white/90 border-neutral-200'
        }`}>
        <div className="w-full flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/" className={`p-2 border rounded-lg transition ${theme === 'dark'
              ? 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white hover:bg-neutral-700'
              : 'bg-white border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
              }`}>
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className={`text-lg font-bold tracking-tight flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-neutral-900'
                }`}>
                <Activity className="w-4 h-4 text-indigo-500 animate-pulse" />
                Trade Sync Farm Analyzer
              </h1>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={fetchTrades}
              disabled={isFetching}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-md shadow-indigo-600/10 transition-all active:scale-95"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              {isFetching ? 'Syncing...' : "Fetch Today"}
            </button>
            <button
              onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
              className={`p-2 border rounded-lg transition ${theme === 'dark'
                ? 'bg-neutral-900 border-neutral-800 text-amber-400 hover:text-amber-300 hover:bg-neutral-700'
                : 'bg-white border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50'
                }`}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container - Full Width Padding */}
      <main className="w-full px-4 sm:px-6 py-6 space-y-4">

        {/* Error Banner */}
        {errorMsg && (
          <div className="p-3 bg-red-950/40 border border-red-900/50 text-red-200 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm">Sync Error</p>
              <p className="text-xs text-red-400">{errorMsg}</p>
            </div>
            <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Top Filters & Stats Compact Strip */}
        <div className={`p-4 rounded-xl flex flex-wrap items-center justify-between gap-4 border ${theme === 'dark' ? 'bg-[#121212] border-neutral-800' : 'bg-white border-neutral-200 shadow-sm'
          }`}>
          {/* Quick Stats */}
          <div className="flex gap-6 mr-4 border-r pr-6 border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <Layers className={`w-4 h-4 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-500'}`} />
              <span className="text-sm font-medium">Groups: {stats.totalGroups}</span>
            </div>
            <div className="flex items-center gap-2">
              <Briefcase className={`w-4 h-4 ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-500'}`} />
              <span className="text-sm font-medium">Terminals: {activeAccounts.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle className={`w-4 h-4 ${stats.missingTradesCount > 0 ? 'text-red-500' : 'text-gray-400'}`} />
              <span className={`text-sm font-medium ${stats.missingTradesCount > 0 ? 'text-red-500' : ''}`}>Missing: {stats.missingTradesCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className={`w-4 h-4 ${stats.highVarianceCount > 0 ? 'text-yellow-500' : 'text-gray-400'}`} />
              <span className={`text-sm font-medium ${stats.highVarianceCount > 0 ? 'text-yellow-500' : ''}`}>High Variance: {stats.highVarianceCount}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchSymbol}
                onChange={(e) => setSearchSymbol(e.target.value)}
                placeholder="Symbol..."
                className={`pl-8 pr-3 py-1.5 w-32 border focus:outline-none rounded-lg text-sm transition-all placeholder-neutral-500 ${theme === 'dark'
                  ? 'bg-[#18181C] border-[#222228] text-white focus:border-indigo-500'
                  : 'bg-neutral-50 border-neutral-200 text-neutral-900 focus:border-indigo-500'
                  }`}
              />
            </div>

            <button
              onClick={() => setShowDiscrepanciesOnly(prev => !prev)}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-semibold transition ${showDiscrepanciesOnly
                ? 'bg-red-500/10 border-red-500/40 text-red-500'
                : theme === 'dark'
                  ? 'bg-[#18181C] border-[#222228] text-neutral-300 hover:bg-neutral-800'
                  : 'bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50'
                }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              Discrepancies Only
            </button>

            <div className="flex items-center gap-2 text-xs">
              <span className={theme === 'dark' ? 'text-neutral-400' : 'text-neutral-500'}>Tolerance:</span>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="10.0"
                value={pipVarianceTolerance}
                onChange={(e) => setPipVarianceTolerance(parseFloat(e.target.value) || 2.0)}
                className={`w-14 px-2 py-1 border rounded-md focus:outline-none focus:border-indigo-500 text-center ${theme === 'dark' ? 'bg-[#18181C] border-[#222228] text-white' : 'bg-white border-neutral-200 text-neutral-900'
                  }`}
              />
              <span className="text-gray-500">pips</span>
            </div>
          </div>
        </div>

        {/* Main Wide Table */}
        <div className={`border rounded-xl overflow-hidden shadow-sm ${theme === 'dark' ? 'bg-[#121212] border-neutral-800' : 'bg-white border-neutral-200'
          }`}>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className={`border-b text-xs font-semibold uppercase tracking-wider ${theme === 'dark' ? 'bg-[#0A0A0C] border-neutral-800 text-neutral-400' : 'bg-neutral-50 border-neutral-200 text-neutral-500'
                  }`}>
                  <th className="py-3 px-4 w-[140px]">Symbol / Dir</th>
                  <th className="py-3 px-3 w-[90px]">Time</th>
                  {activeAccounts.map((accName) => (
                    <th key={accName} className={`py-3 px-2 border-l text-center min-w-[90px] ${theme === 'dark' ? 'border-neutral-800/50' : 'border-neutral-200/50'
                      }`}>
                      {accName}
                    </th>
                  ))}
                  <th className="py-3 px-3 w-8"></th>
                </tr>
              </thead>
              <tbody className={`divide-y text-sm ${theme === 'dark' ? 'divide-neutral-800/40' : 'divide-neutral-200/50'
                }`}>
                {filteredGroups.length === 0 ? (
                  <tr>
                    <td colSpan={2 + activeAccounts.length + 1} className="py-10 text-center">
                      {isFetching ? (
                        <span className="text-indigo-500 flex justify-center items-center gap-2 text-sm">
                          <RefreshCw className="w-4 h-4 animate-spin" /> Syncing from terminals...
                        </span>
                      ) : (
                        <span className="text-gray-500 text-sm">No matched trades found for today.</span>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredGroups.map((g) => {
                    const discrepancyCheck = checkDiscrepancy(g);
                    const tradeDetailsList = Object.values(g.accounts);
                    const baseOpenTime = tradeDetailsList.length > 0 ? Math.min(...tradeDetailsList.map(t => t.open_time)) : 0;

                    return (
                      <React.Fragment key={g.id}>
                        <tr
                          className={`cursor-pointer transition group ${theme === 'dark' ? 'hover:bg-neutral-900/40' : 'hover:bg-neutral-50'
                            } ${discrepancyCheck.isDiscrepant
                              ? discrepancyCheck.reason === 'missing_execution'
                                ? 'bg-red-500/[0.03]'
                                : 'bg-yellow-500/[0.02]'
                              : ''
                            }`}
                          onClick={() => setExpandedGroup(expandedGroup === g.id ? null : g.id)}
                        >
                          {/* Symbol Column */}
                          <td className="py-2.5 px-4">
                            <div className="flex flex-col items-start gap-1">
                              <span className={`font-bold text-sm ${theme === 'dark' ? 'text-white' : 'text-neutral-900'}`}>
                                {g.symbol}
                              </span>
                              <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded uppercase tracking-wider ${g.direction === 'buy' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                                }`}>
                                {g.direction}
                              </span>
                            </div>
                          </td>

                          {/* Time Column (Just time) */}
                          <td className="py-2.5 px-3">
                            <div className="flex flex-col text-[11px] leading-tight text-neutral-500 font-medium">
                              <div><span className="text-neutral-400 dark:text-neutral-600">O:</span> {formatTime(g.open_time)}</div>
                              {g.close_time > 0 && (
                                <div><span className="text-neutral-400 dark:text-neutral-600">C:</span> {formatTime(g.close_time)}</div>
                              )}
                            </div>
                          </td>

                          {/* Dynamic Account Columns - Compact */}
                          {activeAccounts.map((accName) => {
                            const trade = g.accounts[accName];
                            if (!trade) {
                              return (
                                <td key={accName} className={`py-2.5 px-2 border-l text-center align-middle ${theme === 'dark' ? 'border-neutral-800/30' : 'border-neutral-200/50'
                                  }`}>
                                  <span className="inline-block px-1.5 py-0.5 bg-red-500/10 text-red-500 text-[10px] font-bold rounded">
                                    MISSING
                                  </span>
                                </td>
                              );
                            }

                            const delay = trade.open_time - baseOpenTime;
                            const delayStr = delay > 0 ? `+${delay}s` : '0s';

                            return (
                              <td key={accName} className={`py-2 px-2 border-l text-center align-middle ${theme === 'dark' ? 'border-neutral-800/30' : 'border-neutral-200/50'
                                }`}>
                                <div className="flex flex-col items-center justify-center gap-0.5">
                                  <span className={`inline-flex px-1.5 py-0.5 font-bold rounded text-xs ${trade.pips >= 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                                    }`}>
                                    {trade.pips > 0 ? '+' : ''}{trade.pips.toFixed(1)}
                                  </span>
                                  <div className="text-[10px] text-gray-500 dark:text-neutral-500">
                                    <span className={delay > 1 ? 'text-yellow-500 font-semibold' : ''}>D: {delayStr}</span>
                                    {trade.commission !== 0 && <span> | C: {trade.commission.toFixed(1)}</span>}
                                  </div>
                                </div>
                              </td>
                            );
                          })}

                          {/* Expand Toggle */}
                          <td className="py-2.5 px-3 text-center align-middle">
                            {expandedGroup === g.id ? (
                              <ChevronUp className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 transition mx-auto" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-indigo-500 transition mx-auto" />
                            )}
                          </td>
                        </tr>

                        {/* EXPANDED DRAWER - Vertically / Horizontally aligned clean table */}
                        {expandedGroup === g.id && (
                          <tr className={theme === 'dark' ? 'bg-[#0A0A0C]/80' : 'bg-neutral-50'}>
                            <td colSpan={2 + activeAccounts.length + 1} className={`p-4 border-b ${theme === 'dark' ? 'border-neutral-800' : 'border-neutral-200'}`}>
                              <div className={`rounded-lg border overflow-hidden ${theme === 'dark' ? 'border-neutral-800' : 'border-neutral-200 bg-white shadow-sm'}`}>
                                <table className="w-full text-sm text-left border-collapse whitespace-nowrap">
                                  <thead>
                                    <tr className={`border-b text-[11px] font-semibold uppercase tracking-wider ${theme === 'dark' ? 'bg-[#18181C] text-neutral-400 border-neutral-800' : 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                                      <th className="py-2 px-4">Account</th>
                                      <th className="py-2 px-4 text-right">Pips</th>
                                      <th className="py-2 px-4 text-right">Comm</th>
                                      <th className="py-2 px-4 text-right">Profit</th>
                                      <th className="py-2 px-4 text-right">Net Profit</th>
                                      <th className="py-2 px-4 text-right">Position ID</th>
                                      <th className="py-2 px-4 text-right">Open Time</th>
                                      <th className="py-2 px-4 text-right">Close Time</th>
                                    </tr>
                                  </thead>
                                  <tbody className={`divide-y ${theme === 'dark' ? 'divide-neutral-800/40' : 'divide-neutral-100'}`}>
                                    {activeAccounts.map((accName) => {
                                      const trade = g.accounts[accName];
                                      if (!trade) {
                                        return (
                                          <tr key={accName} className="bg-red-500/5">
                                            <td className="py-2 px-4 font-medium text-red-500" colSpan={8}>
                                              {accName} <span className="font-normal opacity-70">– No execution matched</span>
                                            </td>
                                          </tr>
                                        );
                                      }
                                      return (
                                        <tr key={accName} className={`hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${theme === 'dark' ? 'text-neutral-300' : 'text-neutral-700'}`}>
                                          {/* ID */}
                                          <td className="py-2 px-4 font-medium text-indigo-500 dark:text-indigo-400">{accName}</td>
                                          {/* Pips */}
                                          <td className="py-2 px-4 text-right font-medium">
                                            <span className={trade.pips > 0 ? 'text-emerald-500' : trade.pips < 0 ? 'text-red-500' : ''}>
                                              {trade.pips > 0 ? '+' : ''}{trade.pips.toFixed(1)}
                                            </span>
                                          </td>

                                          {/* Commission */}
                                          <td className="py-2 px-4 text-right font-mono text-[13px]">{trade.commission.toFixed(3)}%</td>
                                          {/* Profit */}
                                          <td className={`py-2 px-4 text-right font-medium font-mono text-[13px] ${trade.profit >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                            {trade.profit > 0 ? '+' : ''}{trade.profit.toFixed(3)}%
                                          </td>
                                          {/* Net Profit (Profit + Commission) */}
                                          <td className={`py-2 px-4 text-right font-bold font-mono text-[13px] ${(trade.profit + trade.commission) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                            {(trade.profit + trade.commission) > 0 ? '+' : ''}{(trade.profit + trade.commission).toFixed(3)}%
                                          </td>
                                          {/* Position ID */}
                                          <td className="py-2 px-4 text-right text-gray-500 font-mono text-[12px]">#{trade.position_id}</td>
                                          {/* Times */}
                                          <td className="py-2 px-4 text-right text-gray-500 text-xs">{formatTime(trade.open_time)}</td>
                                          <td className="py-2 px-4 text-right text-gray-500 text-xs">{formatTime(trade.close_time)}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
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