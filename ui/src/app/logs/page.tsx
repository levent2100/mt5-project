"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Activity, 
  Terminal, 
  ArrowLeft, 
  Play, 
  Pause, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  X, 
  ChevronRight, 
  ChevronDown, 
  Copy, 
  Sun, 
  Moon,
  ExternalLink,
  Trash2
} from 'lucide-react';

interface LogEntry {
  timestamp: string;
  message: string;
  source: string;
  type: 'info' | 'trade' | 'error' | 'warning';
  details?: Array<{
    account: string;
    success: boolean;
    error?: string | null;
    message?: string | null;
  }>;
}

interface Account {
  id: string;
  type?: string;
  displayName?: string;
  status: 'Connected' | 'Connecting' | 'Disconnected' | 'Error';
  error?: string | null;
  trade_enabled?: boolean;
}

export default function LogsPage() {
  // Theme State
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('propfirm-logs-theme') as 'light' | 'dark';
    if (savedTheme === 'light' || savedTheme === 'dark') {
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
    localStorage.setItem('propfirm-logs-theme', theme);
  }, [theme]);

  // WebSocket states
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [copierLogs, setCopierLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'trade' | 'error'>('all');
  const [expandedLogIndices, setExpandedLogIndices] = useState<Record<number, boolean>>({});

  // Active console log states
  const [selectedTab, setSelectedTab] = useState<string>('copier'); // 'copier', 'cluster', or account ID
  const [consoleLogs, setConsoleLogs] = useState<string>('');
  const [consoleLoading, setConsoleLoading] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [consoleFontSize, setConsoleFontSize] = useState<number>(11);

  const wsRef = useRef<WebSocket | null>(null);
  const requestsRef = useRef<Record<string, { resolve: (val: any) => void; reject: (err: any) => void }>>({});
  const consoleBottomRef = useRef<HTMLDivElement | null>(null);
  const consoleContainerRef = useRef<HTMLDivElement | null>(null);

  // Send request helper
  const sendRequest = (command: string, payload: any = {}) => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const requestId = Math.random().toString(36).substring(2, 11);
      requestsRef.current[requestId] = { resolve, reject };
      
      wsRef.current.send(JSON.stringify({
        receiver: 'proplink',
        data: {
          requestId,
          command,
          payload
        }
      }));

      // Timeout safety
      setTimeout(() => {
        if (requestsRef.current[requestId]) {
          requestsRef.current[requestId].reject(new Error(`Request ${command} timed out`));
          delete requestsRef.current[requestId];
        }
      }, 5000);
    });
  };

  // Connect WebSocket
  const connectWS = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setWsStatus('connecting');
    const wsUrl = "ws://127.0.0.1:9999/ws";
    
    try {
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsStatus('connected');
        // Subscribe to log and account streams
        sendRequest('subscribe_logs').catch(console.error);
        sendRequest('subscribe_multi_account').catch(console.error);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          
          // Check personal response
          if (payload.requestId && requestsRef.current[payload.requestId]) {
            if (payload.status === 'ok') {
              requestsRef.current[payload.requestId].resolve(payload.data);
            } else {
              requestsRef.current[payload.requestId].reject(new Error(payload.error || 'Request failed'));
            }
            delete requestsRef.current[payload.requestId];
            return;
          }

          // Check channels broadcast
          if (payload.type) {
            switch (payload.type) {
              case 'multi_account_update':
                if (payload.data?.accounts) {
                  setAllAccounts(payload.data.accounts);
                }
                break;
              case 'log_update':
                if (payload.data?.message) {
                  const entry: LogEntry = {
                    timestamp: payload.data.timestamp || new Date().toLocaleTimeString(),
                    message: payload.data.message,
                    source: payload.data.source || 'Server',
                    type: payload.data.type || 'info',
                    details: payload.data.details
                  };
                  setCopierLogs(prev => [entry, ...prev].slice(0, 300));
                }
                break;
              default:
                break;
            }
          }
        } catch (err) {
          console.error("Failed to parse socket payload", err);
        }
      };

      socket.onerror = (err) => {
        setWsStatus('error');
      };

      socket.onclose = () => {
        setWsStatus('disconnected');
        setTimeout(connectWS, 4000);
      };

    } catch (e) {
      setTimeout(connectWS, 4000);
    }
  };

  useEffect(() => {
    connectWS();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Fetch current console logs (e.g. for bridge or cluster)
  const fetchLogs = async (tabName: string) => {
    if (wsStatus !== 'connected' || tabName === 'copier') return;
    setConsoleLoading(true);
    try {
      const res = await sendRequest('get_bridge_logs', { account: tabName }) as any;
      if (res && res.logs !== undefined) {
        // Reverse lines to show newest at top
        const reversed = res.logs.split('\n').reverse().join('\n');
        setConsoleLogs(reversed);
      }
    } catch (err) {
      setConsoleLogs(`Failed to retrieve logs: ${(err as Error).message}`);
    } finally {
      setConsoleLoading(false);
    }
  };

  // Refresh trigger when switching tabs
  useEffect(() => {
    if (selectedTab !== 'copier') {
      setConsoleLogs('Loading logs...');
      fetchLogs(selectedTab);
    }
  }, [selectedTab, wsStatus]);

  // Auto-refresh console logs
  useEffect(() => {
    if (!autoRefresh || selectedTab === 'copier' || wsStatus !== 'connected') return;

    const interval = setInterval(() => {
      fetchLogs(selectedTab);
    }, 2000);

    return () => clearInterval(interval);
  }, [selectedTab, autoRefresh, wsStatus]);

  // Auto-scroll console logs window to top (since newest logs are now reversed at the top)
  useEffect(() => {
    if (consoleContainerRef.current) {
      consoleContainerRef.current.scrollTop = 0;
    }
  }, [consoleLogs]);

  // Filtered Copier Logs
  const filteredCopierLogs = useMemo(() => {
    if (logFilter === 'all') return copierLogs;
    return copierLogs.filter(l => l.type === logFilter);
  }, [copierLogs, logFilter]);

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(consoleLogs);
  };

  const handleClearServerLogs = async () => {
    if (wsStatus !== 'connected') return;
    try {
      await sendRequest('clear_all_logs');
      setCopierLogs([]);
      setConsoleLogs('');
    } catch (err) {
      console.error("Failed to clear server logs:", err);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col transition-colors ${
      theme === 'dark' ? 'bg-[#0B0B0B] text-neutral-200' : 'bg-[#FAFAFA] text-neutral-800'
    }`}>
      {/* Header */}
      <header className={`px-6 py-3.5 border-b flex items-center justify-between transition-colors ${
        theme === 'dark' ? 'bg-[#0E0E0E] border-neutral-900' : 'bg-white border-neutral-200 shadow-sm'
      }`}>
        <div className="flex items-center gap-4">
          <a
            href="/"
            className={`p-2 rounded-lg border transition-all active:scale-95 flex items-center justify-center ${
              theme === 'dark' 
                ? 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white' 
                : 'bg-neutral-100 border-neutral-250 text-neutral-600 hover:text-black'
            }`}
            title="Back to Dashboard"
          >
            <ArrowLeft size={16} />
          </a>
          <div>
            <h1 className="text-sm font-bold tracking-tight flex items-center gap-2">
              Console Log Center
              <span className={`text-[9px] uppercase font-mono px-1.5 py-0.2 rounded border ${
                theme === 'dark' 
                  ? 'bg-white/5 text-neutral-400 border-white/10' 
                  : 'bg-black/5 text-neutral-600 border-black/10'
              }`}>Verbose Diagnostics</span>
            </h1>
            <p className={`text-[10px] ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
              Central copier metrics, bridge console monitors, and cluster diagnostics
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* WS Connection Badge */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] font-bold uppercase border transition-colors ${
            theme === 'dark' ? 'bg-neutral-900 border-neutral-800' : 'bg-neutral-100 border-neutral-250'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              wsStatus === 'connected' ? 'bg-emerald-500' :
              wsStatus === 'connecting' ? 'bg-amber-500 animate-pulse' : 'bg-rose-500'
            }`} />
            <span className={theme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'}>
              Server: {wsStatus}
            </span>
          </div>

          {/* Clear Server Logs Button */}
          <button
            onClick={handleClearServerLogs}
            disabled={wsStatus !== 'connected'}
            className={`px-3 py-1.5 rounded-lg border text-[10px] font-extrabold uppercase transition-all active:scale-95 flex items-center gap-1.5 ${
              theme === 'dark'
                ? 'bg-rose-950/20 border-rose-900/40 text-rose-450 hover:bg-rose-950/35'
                : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100 shadow-sm'
            }`}
          >
            <Trash2 size={11} />
            Clear Server Logs
          </button>

          {/* Theme Switcher */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`p-2 rounded-lg border transition-all active:scale-95 flex items-center justify-center ${
              theme === 'dark'
                ? 'bg-neutral-900 border-neutral-800 text-amber-400 hover:text-amber-300'
                : 'bg-neutral-100 border-neutral-250 text-neutral-600 hover:text-neutral-950'
            }`}
          >
            {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex overflow-hidden h-[calc(100vh-62px)]">
        {/* Sidebar Log Tabs */}
        <aside className={`w-72 border-r flex flex-col overflow-y-auto flex-shrink-0 transition-colors ${
          theme === 'dark' ? 'bg-[#0D0D0D] border-neutral-900' : 'bg-[#F5F5F5] border-neutral-200'
        }`}>
          <div className="p-4 flex flex-col gap-4">
            <div>
              <h3 className={`text-[10px] font-bold uppercase tracking-wider px-2 mb-2 ${
                theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
              }`}>System Log Streams</h3>
              
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => setSelectedTab('copier')}
                  className={`w-full text-left px-3 py-2 rounded-lg font-medium text-xs flex items-center gap-2.5 transition-all ${
                    selectedTab === 'copier'
                      ? 'bg-neutral-800 text-white shadow-sm border border-neutral-700/30'
                      : (theme === 'dark' ? 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200' : 'text-neutral-600 hover:bg-neutral-200/50 hover:text-neutral-900')
                  }`}
                >
                  <Activity size={13} />
                  <span>Central Copier Logs</span>
                </button>

                <button
                  onClick={() => setSelectedTab('cluster')}
                  className={`w-full text-left px-3 py-2 rounded-lg font-medium text-xs flex items-center gap-2.5 transition-all ${
                    selectedTab === 'cluster'
                      ? 'bg-neutral-800 text-white shadow-sm border border-neutral-700/30'
                      : (theme === 'dark' ? 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200' : 'text-neutral-600 hover:bg-neutral-200/50 hover:text-neutral-900')
                  }`}
                >
                  <Terminal size={13} />
                  <span>MT5 Cluster Console</span>
                </button>
              </div>
            </div>

            <div>
              <h3 className={`text-[10px] font-bold uppercase tracking-wider px-2 mb-2 ${
                theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
              }`}>Account Bridge Consoles</h3>
              
              <div className="flex flex-col gap-1">
                {allAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => setSelectedTab(acc.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg font-medium text-xs flex items-center justify-between transition-all ${
                      selectedTab === acc.id
                        ? 'bg-neutral-800 text-white shadow-sm border border-neutral-700/30'
                        : (theme === 'dark' ? 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200' : 'text-neutral-600 hover:bg-neutral-200/50 hover:text-neutral-900')
                    }`}
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <Terminal size={13} className="flex-shrink-0" />
                      <span className="truncate">{acc.displayName || acc.id}</span>
                    </div>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ml-1.5 ${
                      acc.status === 'Connected' ? 'bg-emerald-500' :
                      acc.status === 'Error' ? 'bg-rose-500' : 'bg-neutral-400'
                    }`} />
                  </button>
                ))}
                {allAccounts.length === 0 && (
                  <p className="text-[10px] italic text-neutral-500 px-2">No accounts sync'd.</p>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Console view area */}
        <main className={`flex-1 flex flex-col overflow-hidden transition-colors ${
          theme === 'dark' ? 'bg-[#080808]' : 'bg-[#FAFAFA]'
        }`}>
          {selectedTab === 'copier' ? (
            /* Copier Logs List View */
            <div className="flex-grow flex flex-col overflow-hidden">
              {/* Toolbar */}
              <div className={`px-6 py-2.5 border-b flex items-center justify-between transition-colors ${
                theme === 'dark' ? 'bg-neutral-905/45 border-neutral-900' : 'bg-white border-neutral-200'
              }`}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Filter Events:</span>
                  <div className={`flex gap-0.5 p-0.5 rounded-lg border ${
                    theme === 'dark' ? 'bg-neutral-950/60 border-neutral-900' : 'bg-neutral-100 border-neutral-200'
                  }`}>
                    {(['all', 'info', 'trade', 'error'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setLogFilter(filter)}
                        className={`px-2 py-0.5 rounded-md text-[9px] uppercase font-bold transition-all ${
                          logFilter === filter 
                            ? (theme === 'dark' ? 'bg-neutral-800 text-neutral-100 shadow-sm' : 'bg-white text-neutral-900 shadow-sm border border-neutral-200/40') 
                            : (theme === 'dark' ? 'text-neutral-500 hover:text-neutral-200' : 'text-neutral-500 hover:text-neutral-900')
                        }`}
                      >
                        {filter}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => { setCopierLogs([]); setExpandedLogIndices({}); }}
                  className="px-2 py-1 rounded border border-rose-500/20 text-rose-500 hover:bg-rose-500/10 text-[9px] font-extrabold uppercase transition-all"
                >
                  Clear History
                </button>
              </div>

              {/* Logs Content */}
              <div className="flex-grow overflow-y-auto p-6 flex flex-col gap-2 font-mono text-xs">
                {filteredCopierLogs.length > 0 ? (
                  filteredCopierLogs.map((log, idx) => (
                    <div 
                      key={idx} 
                      className={`p-3 rounded-lg border transition-colors ${
                        theme === 'dark' 
                          ? 'bg-neutral-900/40 border-neutral-850/50 hover:bg-neutral-900/60' 
                          : 'bg-white border-neutral-200 shadow-sm hover:bg-neutral-50/50'
                      }`}
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.2 rounded border font-semibold uppercase ${
                            theme === 'dark' ? 'bg-neutral-950 border-neutral-800 text-neutral-400' : 'bg-neutral-100 border-neutral-300 text-neutral-600'
                          }`}>{log.source}</span>
                          <span className={
                            log.type === 'error' ? 'text-rose-500 font-bold' :
                            log.type === 'warning' ? 'text-amber-500 font-bold' :
                            log.type === 'trade' ? 'text-emerald-500 font-bold' :
                            (theme === 'dark' ? 'text-neutral-350' : 'text-neutral-700')
                          }>
                            {log.message}
                          </span>
                        </div>
                        <span className={`text-[10px] ${theme === 'dark' ? 'text-neutral-650' : 'text-neutral-400'}`}>
                          {log.timestamp}
                        </span>
                      </div>

                      {log.details && log.details.length > 0 && (
                        <div className="mt-2.5 border-t border-neutral-800/40 dark:border-neutral-900/60 pt-2 flex flex-col gap-1">
                          <button
                            onClick={() => setExpandedLogIndices(prev => ({ ...prev, [idx]: !prev[idx] }))}
                            className="text-[10px] text-neutral-500 hover:text-neutral-300 flex items-center gap-1 font-bold text-left mb-1"
                          >
                            {expandedLogIndices[idx] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                            {expandedLogIndices[idx] ? 'HIDE PER-ACCOUNT STATUS' : `VIEW PER-ACCOUNT STATUS (${log.details.length} Accounts)`}
                          </button>

                          {expandedLogIndices[idx] && (
                            <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 mt-1.5`}>
                              {log.details.map((detail, dIdx) => (
                                <div 
                                  key={dIdx} 
                                  className={`p-2.5 rounded border text-[10px] flex flex-col justify-between ${
                                    detail.success 
                                      ? (theme === 'dark' ? 'bg-emerald-950/20 border-emerald-900/30' : 'bg-emerald-50 border-emerald-200/50')
                                      : (theme === 'dark' ? 'bg-rose-950/20 border-rose-900/30' : 'bg-rose-50 border-rose-200/50')
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <span className="font-extrabold">{detail.account}</span>
                                    {detail.success ? (
                                      <span className="text-emerald-500 flex items-center gap-0.5 text-[9px] uppercase font-bold">
                                        <CheckCircle2 size={11} /> SUCCESS
                                      </span>
                                    ) : (
                                      <span className="text-rose-500 flex items-center gap-0.5 text-[9px] uppercase font-bold">
                                        <AlertCircle size={11} /> FAILED
                                      </span>
                                    )}
                                  </div>
                                  {!detail.success && (
                                    <p className={`text-[9px] break-all leading-normal ${
                                      theme === 'dark' ? 'text-rose-400/80' : 'text-rose-600'
                                    }`}>
                                      {detail.error || detail.message || "Unknown error details."}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-neutral-500 italic py-20">
                    <Activity className="opacity-25 mb-2 animate-pulse" size={24} />
                    Waiting for trade activity...
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Bridge / Cluster Console Raw Terminal View */
            <div className="flex-grow flex flex-col overflow-hidden">
              {/* Console Toolbar */}
              <div className={`px-6 py-2.5 border-b flex items-center justify-between transition-colors ${
                theme === 'dark' ? 'bg-neutral-905/45 border-neutral-900' : 'bg-white border-neutral-200'
              }`}>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Font size:</span>
                    <select
                      value={consoleFontSize}
                      onChange={(e) => setConsoleFontSize(Number(e.target.value))}
                      className={`px-1.5 py-0.5 rounded border text-[10px] ${
                        theme === 'dark' ? 'bg-neutral-900 border-neutral-800 text-white' : 'bg-neutral-50 border-neutral-350 text-neutral-800'
                      }`}
                    >
                      {[9, 10, 11, 12, 13, 14, 15].map(sz => (
                        <option key={sz} value={sz}>{sz}px</option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    className={`px-2.5 py-1 rounded text-[10px] font-extrabold uppercase transition-all flex items-center gap-1.5 border ${
                      autoRefresh 
                        ? (theme === 'dark' ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-400' : 'bg-emerald-50 border-emerald-250 text-emerald-700')
                        : (theme === 'dark' ? 'bg-neutral-900 border-neutral-800 text-neutral-400' : 'bg-white border-neutral-300 text-neutral-600')
                    }`}
                  >
                    {autoRefresh ? <Pause size={10} /> : <Play size={10} />}
                    {autoRefresh ? 'Streaming Live' : 'Streaming Paused'}
                  </button>

                  <button
                    onClick={() => fetchLogs(selectedTab)}
                    disabled={consoleLoading}
                    className={`p-1.5 rounded border active:scale-95 transition-all flex items-center justify-center ${
                      theme === 'dark'
                        ? 'bg-neutral-900 border-neutral-800 text-neutral-450 hover:text-white'
                        : 'bg-white border-neutral-250 text-neutral-600 hover:text-black'
                    }`}
                  >
                    <RefreshCw size={11} className={consoleLoading ? 'animate-spin' : ''} />
                  </button>
                </div>

                <button
                  onClick={handleCopyLogs}
                  className={`px-2 py-1 rounded text-[10px] font-bold uppercase transition-all flex items-center gap-1.5 border ${
                    theme === 'dark' 
                      ? 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white' 
                      : 'bg-white border-neutral-300 text-neutral-600 hover:text-black hover:border-neutral-400 shadow-sm'
                  }`}
                >
                  <Copy size={11} /> Copy to Clipboard
                </button>
              </div>

              {/* Console Box */}
              <div className="flex-1 p-5 overflow-hidden flex flex-col">
                <div 
                  ref={consoleContainerRef}
                  className={`flex-1 p-5 rounded-xl font-mono overflow-y-auto shadow-2xl relative border ${
                    theme === 'dark' 
                      ? 'bg-[#050505] text-[#A8FFB2] border-neutral-900' 
                      : 'bg-neutral-50 text-neutral-900 border-neutral-300 shadow-sm'
                  }`}
                  style={{ fontSize: `${consoleFontSize}px` }}
                >
                  <div className="whitespace-pre-wrap leading-relaxed select-text pr-2">
                    {consoleLogs}
                  </div>
                  <div ref={consoleBottomRef} />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
