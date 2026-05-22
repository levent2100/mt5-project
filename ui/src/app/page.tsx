"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Activity, 
  ArrowDownRight, 
  ArrowUpRight, 
  Award, 
  CheckCircle2, 
  ChevronRight, 
  DollarSign, 
  Flame, 
  Layers, 
  ListFilter, 
  LogOut, 
  Play, 
  RefreshCw, 
  RotateCcw, 
  ShieldAlert, 
  Smartphone, 
  TrendingUp, 
  Volume2, 
  X, 
  XOctagon,
  Sun,
  Moon
} from 'lucide-react';

// --- TS Interface Declarations ---
interface Position {
  symbol: string;
  displaySymbol?: string;
  direction: 'BUY' | 'SELL';
  quantity: number;
  avgPrice: number;
  pnl?: number;
}

interface Order {
  symbol: string;
  displaySymbol?: string;
  direction: 'BUY' | 'SELL';
  quantity: number;
  orderType: 'limit' | 'stop' | 'market';
  price: number;
}

interface Account {
  id: string;
  type?: string;
  displayName?: string;
  status: 'Connected' | 'Connecting' | 'Disconnected' | 'Error';
  error?: string | null;
  realizedPNL?: number;
  unrealizedPNL?: number;
  positions: Position[];
  orders: Order[];
  lastUpdated?: string;
  // Extra fields populated by bridge
  cash_value?: number;
  buying_power?: number;
  multiplier?: number;
  riskPerc?: number;
  trade_enabled?: boolean;
}

interface LogEntry {
  timestamp: string;
  message: string;
  source: string;
  type: 'info' | 'trade' | 'error' | 'warning';
}

interface SpreadAccount {
  id: string;
  displayName: string;
  company: string;
  spreads: Record<string, number | null>;
  defaultpointvalue: Record<string, number>;
}

export default function Dashboard() {
  // Theme State & Persistent Dark Mode Toggle
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('propfirm-theme') as 'light' | 'dark';
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setTheme(savedTheme);
    } else if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      setTheme('dark');
    }
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('propfirm-theme', theme);
  }, [theme]);

  // --- UI State Variables ---
  const [activeTab, setActiveTab] = useState<'reference' | 'farm' | 'spreads'>('reference');
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastUpdated, setLastUpdated] = useState<string>('Never');
  
  // Data States
  const [referenceAccount, setReferenceAccount] = useState<Account | null>(null);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [defaultSlPips, setDefaultSlPips] = useState<Record<string, number>>({});
  const [spreadAccounts, setSpreadAccounts] = useState<SpreadAccount[]>([]);
  const [spreadPulses, setSpreadPulses] = useState<Record<string, boolean>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'info' | 'trade' | 'error'>('all');
  
  // Interactive Trading Form States
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [slPips, setSlPips] = useState<string>('');
  const [quantity, setQuantity] = useState<string>('1.0');
  const [isRiskBasedInput, setIsRiskBasedInput] = useState<boolean>(true);
  
  // Modal / Feedback States
  const [alertMessage, setAlertMessage] = useState<{ text: string; type: 'success' | 'danger' | 'info' | 'warning' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ 
    isOpen: boolean; 
    title: string; 
    message: string; 
    action: () => void; 
    isDanger?: boolean;
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: () => {},
  });

  // Pulse (Flicker) Animation Trigger States
  const [refPnlPulse, setRefPnlPulse] = useState(false);
  const [farmPnlPulse, setFarmPnlPulse] = useState<Record<string, boolean>>({});

  // Refs for tracking previous values to animate
  const prevRefUnrealized = useRef<number>(0);
  const prevAccountsUnrealized = useRef<Record<string, number>>({});
  
  // WebSocket Reference
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRequests = useRef<Record<string, { resolve: (data: any) => void; reject: (err: any) => void; timeout: NodeJS.Timeout }>>({});

  // --- Helper: Render dynamic HSL alerts ---
  const triggerAlert = (text: string, type: 'success' | 'danger' | 'info' | 'warning' = 'info') => {
    setAlertMessage({ text, type });
    setTimeout(() => {
      setAlertMessage(current => current?.text === text ? null : current);
    }, 4500);
  };

  // --- Helper: Local Logger ---
  const addLog = (message: string, source = 'UI', type: LogEntry['type'] = 'info') => {
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      message,
      source,
      type
    };
    setLogs(prev => [entry, ...prev].slice(0, 150));
  };

  // --- WebSocket Connection Core ---
  const connectWS = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setWsStatus('connecting');
    addLog('Connecting to backend WebSocket...', 'UI-WS');

    // Dynamic resolution to host machine or localhost depending on environment
    const host = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
    const WS_URL = `ws://${host}:9999/ws`;
    
    try {
      const socket = new WebSocket(WS_URL);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsStatus('connected');
        addLog('Connected to backend WebSocket successfully.', 'UI-WS', 'info');
        triggerAlert('Server Connection Established', 'success');

        // 1. Fetch initial reference status
        sendRequest('get_account_status')
          .then(data => {
            if (data?.account) {
              setReferenceAccount(data.account);
              setLastUpdated(new Date().toLocaleTimeString());
            }
          })
          .catch(err => addLog(`Failed to fetch initial status: ${err}`, 'UI-WS', 'error'));

        // 2. Fetch global symbols
        sendRequest('get_global_symbols')
          .then(data => {
            if (data?.symbols) {
              setSymbols(data.symbols);
              if (data.slpips) setDefaultSlPips(data.slpips);
              if (data.symbols.length > 0) setSelectedSymbol(data.symbols[0]);
            }
          })
          .catch(err => addLog(`Failed to fetch symbols: ${err}`, 'UI-WS', 'error'));

        // 3. Subscribe channels
        sendRequest('subscribe_account').catch(e => addLog(`Sub error: ${e}`, 'UI-WS', 'error'));
        sendRequest('subscribe_multi_account').catch(e => addLog(`Sub error: ${e}`, 'UI-WS', 'error'));
        sendRequest('subscribe_spreads').catch(e => addLog(`Sub error: ${e}`, 'UI-WS', 'error'));
        sendRequest('subscribe_logs').catch(e => addLog(`Sub error: ${e}`, 'UI-WS', 'error'));
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          // Handle response to explicit request Promises
          if (payload.requestId && pendingRequests.current[payload.requestId]) {
            const { resolve, reject, timeout } = pendingRequests.current[payload.requestId];
            clearTimeout(timeout);
            
            if (payload.status === 'ok') {
              resolve(payload.data);
            } else {
              reject(payload.error || 'Server error response');
            }
            delete pendingRequests.current[payload.requestId];
          } 
          // Handle pushed updates
          else if (payload.type) {
            switch (payload.type) {
              case 'account_update':
                if (payload.data?.account) {
                  const acc = payload.data.account as Account;
                  setReferenceAccount(prev => {
                    // Trigger flash animation if unrealized PnL changed
                    if (prev && prev.unrealizedPNL !== acc.unrealizedPNL) {
                      setRefPnlPulse(true);
                      setTimeout(() => setRefPnlPulse(false), 4500);
                    }
                    return acc;
                  });
                  setLastUpdated(new Date().toLocaleTimeString());
                }
                break;

              case 'multi_account_update':
                if (payload.data?.accounts) {
                  const accs = payload.data.accounts as Account[];
                  setAllAccounts(prev => {
                    // Check individual accounts PnL shifts for flash pulses
                    const pulses: Record<string, boolean> = {};
                    accs.forEach(acc => {
                      const match = prev.find(p => p.id === acc.id);
                      if (match && match.unrealizedPNL !== acc.unrealizedPNL) {
                        pulses[acc.id] = true;
                      }
                    });
                    if (Object.keys(pulses).length > 0) {
                      setFarmPnlPulse(pulses);
                      setTimeout(() => setFarmPnlPulse({}), 450);
                    }
                    return accs;
                  });
                }
                break;

              case 'spreads_update':
                if (payload.data?.accounts) {
                  const newAccounts = payload.data.accounts as SpreadAccount[];
                  setSpreadAccounts((prev: SpreadAccount[]) => {
                    const pulses: Record<string, boolean> = {};
                    newAccounts.forEach(acc => {
                      const prevAcc = prev.find((p: SpreadAccount) => p.id === acc.id);
                      if (prevAcc) {
                        Object.keys(acc.spreads).forEach(sym => {
                          const val = acc.spreads[sym];
                          const prevVal = prevAcc.spreads[sym];
                          if (val !== prevVal) {
                            pulses[`${acc.id}-${sym}`] = true;
                          }
                        });
                      }
                    });
                    if (Object.keys(pulses).length > 0) {
                      setSpreadPulses((prevPulses: Record<string, boolean>) => ({ ...prevPulses, ...pulses }));
                      setTimeout(() => {
                        setSpreadPulses((prevPulses: Record<string, boolean>) => {
                          const updated = { ...prevPulses };
                          Object.keys(pulses).forEach(key => {
                            delete updated[key];
                          });
                          return updated;
                        });
                      }, 600);
                    }
                    return newAccounts;
                  });
                }
                break;

              case 'log_update':
                if (payload.data?.message) {
                  addLog(
                    payload.data.message, 
                    payload.data.source || 'Server', 
                    payload.data.type || 'info'
                  );
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
        addLog('WebSocket error encountered.', 'UI-WS', 'error');
        setWsStatus('error');
      };

      socket.onclose = () => {
        setWsStatus('disconnected');
        setReferenceAccount(null);
        addLog('WebSocket connection closed. Retrying in 5 seconds...', 'UI-WS', 'warning');
        setTimeout(connectWS, 5000);
      };

    } catch (e) {
      addLog(`Socket launch failed: ${e}`, 'UI-WS', 'error');
      setTimeout(connectWS, 5000);
    }
  };

  // --- WebSocket Promise Wrapper ---
  const sendRequest = (command: string, payload: any = {}): Promise<any> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return reject('Socket not connected');
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
          addLog(`Request ${command} timed out.`, 'UI', 'error');
        }
      }, 8000);

      pendingRequests.current[requestId] = { resolve, reject, timeout };
      wsRef.current.send(JSON.stringify(msg));
    });
  };

  // Connect on Mount
  useEffect(() => {
    connectWS();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // --- Auto-fill SL pips based on selected symbol ---
  useEffect(() => {
    if (selectedSymbol && defaultSlPips[selectedSymbol] !== undefined) {
      setSlPips(defaultSlPips[selectedSymbol].toString());
      // Adjust forms for indexes vs currencies
      const isIndex = ['SP500', 'DAX40', 'FTSE100', 'NQ100', 'GOLD'].includes(selectedSymbol);
      setIsRiskBasedInput(!isIndex);
    }
  }, [selectedSymbol, defaultSlPips]);

  // --- Interactive Command Triggers ---
  const handleTrade = (direction: 'buy' | 'sell') => {
    const slVal = parseFloat(slPips);
    const qtyVal = parseFloat(quantity);

    if (!selectedSymbol) return triggerAlert('Select an instrument first!', 'warning');
    if (isNaN(slVal) || slVal <= 0) return triggerAlert('Input a valid Stop Loss (pips)!', 'warning');
    if (!isRiskBasedInput && (isNaN(qtyVal) || qtyVal <= 0)) {
      return triggerAlert('Input a valid trade quantity (lots)!', 'warning');
    }

    const payload = {
      symbol: selectedSymbol,
      direction,
      ordertype: 'market',
      qty: isRiskBasedInput ? 0 : qtyVal,
      sl_pips: slVal
    };

    triggerAlert(`Sending scaled ${direction.toUpperCase()} for ${selectedSymbol}...`, 'info');
    
    sendRequest('trade', payload)
      .then(res => {
        triggerAlert(res?.message || `Trade placed successfully.`, 'success');
      })
      .catch(err => {
        triggerAlert(`Trade failed: ${err}`, 'danger');
      });
  };

  const handleFlattenSymbol = () => {
    if (!selectedSymbol) return triggerAlert('Select a symbol to flatten!', 'warning');
    
    setConfirmModal({
      isOpen: true,
      title: 'Flatten Symbol Positions',
      message: `Are you sure you want to close ALL positions and cancel pending orders for ${selectedSymbol} across all trade-enabled terminals?`,
      isDanger: true,
      action: () => {
        triggerAlert(`Flattening ${selectedSymbol}...`, 'info');
        sendRequest('flatten', { instrument: selectedSymbol })
          .then(res => triggerAlert(res?.message || 'Symbol flattened.', 'success'))
          .catch(err => triggerAlert(`Flatten failed: ${err}`, 'danger'));
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleCancelAllPending = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Cancel Pending Orders',
      message: 'Are you sure you want to cancel ALL pending orders across all active accounts?',
      action: () => {
        triggerAlert('Cancelling all pending orders...', 'info');
        sendRequest('cancel', {})
          .then(res => triggerAlert(res?.message || 'All pending orders cancelled.', 'success'))
          .catch(err => triggerAlert(`Cancel failed: ${err}`, 'danger'));
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleFlattenEverything = () => {
    setConfirmModal({
      isOpen: true,
      title: 'DANGER: FLATTEN EVERYTHING',
      message: 'CRITICAL ACTION: This will immediately close ALL open positions and cancel ALL pending orders across all managed MT5 accounts. This cannot be undone!',
      isDanger: true,
      action: () => {
        triggerAlert('Flushing entire farm portfolio...', 'warning');
        sendRequest('flatten', {})
          .then(res => triggerAlert(res?.message || 'Farm fully flattened!', 'success'))
          .catch(err => triggerAlert(`Full flatten failed: ${err}`, 'danger'));
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleManualRefresh = () => {
    triggerAlert('Refreshing dashboard data...', 'info');
    sendRequest('get_account_status')
      .then(d => {
        if (d?.account) setReferenceAccount(d.account);
      })
      .catch(e => triggerAlert(`Refresh failed: ${e}`, 'warning'));
    
    sendRequest('get_global_symbols')
      .then(d => {
        if (d?.symbols) setSymbols(d.symbols);
      })
      .catch(() => {});
  };

  // --- Derived Metrics ---
  const filteredLogs = useMemo(() => {
    if (logFilter === 'all') return logs;
    return logs.filter(l => l.type === logFilter);
  }, [logs, logFilter]);

  const activePositionsTotalPnL = useMemo(() => {
    if (!referenceAccount?.positions) return 0;
    return referenceAccount.positions.reduce((sum, pos) => sum + (pos.pnl || 0), 0);
  }, [referenceAccount]);

  // Format Helper
  const formatPnl = (val: number | undefined) => {
    if (val === undefined || isNaN(val)) return '0.00$';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(2)}$`;
  };

  return (
    <div className={`flex flex-col min-h-screen transition-colors duration-200 ${
      theme === 'dark' ? 'dark bg-[#0A0A0A] text-neutral-100' : 'bg-[#FAFAFA] text-neutral-900'
    }`}>
      {/* Dynamic Top Notification Header */}
      {alertMessage && (
        <div className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-xl shadow-lg border text-xs font-bold transition-all duration-300 flex items-center gap-3 animate-bounce ${
          alertMessage.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/90 dark:border-emerald-500/50 dark:text-emerald-400' 
            : alertMessage.type === 'danger' 
            ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/90 dark:border-rose-500/50 dark:text-rose-400' 
            : alertMessage.type === 'warning' 
            ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/90 dark:border-amber-500/50 dark:text-amber-400' 
            : 'bg-neutral-100 border-neutral-200 text-neutral-800 dark:bg-neutral-900/90 dark:border-neutral-700/50 dark:text-neutral-200'
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${
            alertMessage.type === 'success' ? 'bg-emerald-500 shadow-glow-green' :
            alertMessage.type === 'danger' ? 'bg-rose-500 shadow-glow-red' :
            alertMessage.type === 'warning' ? 'bg-amber-500' : 'bg-neutral-500'
          }`} />
          <span>{alertMessage.text}</span>
          <button onClick={() => setAlertMessage(null)} className="hover:opacity-70 ml-2">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Top Glassmorphic Navigation Bar */}
      <header className={`sticky top-0 z-40 w-full border-b px-6 py-3.5 flex flex-wrap justify-between items-center gap-4 transition-colors ${
        theme === 'dark' 
          ? 'bg-[#0B0B0B] border-neutral-900 text-white' 
          : 'bg-[#FAFAFA] border-neutral-200 shadow-sm text-neutral-800'
      }`}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`w-9 h-9 rounded-lg border flex items-center justify-center transition-colors ${
              theme === 'dark' ? 'bg-neutral-900 border-neutral-800' : 'bg-neutral-100 border-neutral-200'
            }`}>
              <Activity className={theme === 'dark' ? 'text-white' : 'text-neutral-800'} size={18} />
            </div>
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 transition-colors ${
              theme === 'dark' ? 'border-[#0B0B0B]' : 'border-[#FAFAFA]'
            } ${
              wsStatus === 'connected' ? 'bg-emerald-500' :
              wsStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
              'bg-rose-500'
            }`} />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight flex items-center gap-2">
              PropFirm Farm Control
              <span className={`text-[9px] uppercase font-mono px-1.5 py-0.2 rounded border ${
                theme === 'dark' 
                  ? 'bg-white/5 text-neutral-300 border-white/10' 
                  : 'bg-black/5 text-neutral-700 border-black/10'
              }`}>v2.0</span>
            </h1>
            <p className={`text-[10px] ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
              Reference: {referenceAccount ? `${referenceAccount.displayName || referenceAccount.id}` : 'Syncing...'}
            </p>
          </div>
        </div>

        {/* Global Stats bar */}
        <div className="flex items-center gap-5 text-xs">
          <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors ${
            theme === 'dark' ? 'bg-neutral-900/50 border-neutral-850' : 'bg-neutral-100/80 border-neutral-250'
          }`}>
            <span className={theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}>Realized:</span>
            <span className={`font-mono font-bold ${
              (referenceAccount?.realizedPNL || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {formatPnl(referenceAccount?.realizedPNL)}
            </span>
          </div>

          <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors ${
            theme === 'dark' ? 'bg-neutral-900/50 border-neutral-850' : 'bg-neutral-100/80 border-neutral-250'
          }`}>
            <span className={theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}>Unrealized:</span>
            <span className={`font-mono font-bold transition-all duration-300 ${refPnlPulse ? 'animate-flicker' : ''} ${
              (referenceAccount?.unrealizedPNL || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {formatPnl(referenceAccount?.unrealizedPNL)}
            </span>
          </div>

          <div className="flex items-center gap-3.5">
            <span className={`text-[10px] ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
              Sync: <span className={`font-mono font-semibold ${theme === 'dark' ? 'text-neutral-300' : 'text-neutral-700'}`}>{lastUpdated}</span>
            </span>
            <button 
              onClick={handleManualRefresh} 
              className={`p-2 rounded-lg border active:scale-95 transition-all ${
                theme === 'dark'
                  ? 'bg-neutral-900/80 border-neutral-850 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                  : 'bg-neutral-100 border-neutral-250 text-neutral-600 hover:text-neutral-800 hover:border-neutral-400'
              }`}
              title="Manual Sync Request"
            >
              <RefreshCw size={12} className={wsStatus === 'connecting' ? 'animate-spin' : ''} />
            </button>
            
            {/* Elite Apple Theme Toggler */}
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={`p-2 rounded-lg border transition-all active:scale-95 flex items-center justify-center ${
                theme === 'dark'
                  ? 'bg-neutral-900/80 border-neutral-850 text-amber-400 hover:text-amber-300 hover:border-neutral-700'
                  : 'bg-neutral-100 border-neutral-250 text-neutral-600 hover:text-neutral-850 hover:border-neutral-450'
              }`}
              title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Theme`}
            >
              {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Grid Viewport - Unified Single Surface Desktop Layout */}
      <div className={`flex flex-1 h-[calc(100vh-62px)] overflow-hidden transition-colors ${
        theme === 'dark' ? 'bg-[#0A0A0A]' : 'bg-[#FAFAFA]'
      }`}>
        
        {/* Left Column Sidebar */}
        <aside className={`w-80 border-r flex flex-col justify-between overflow-y-auto flex-shrink-0 transition-colors ${
          theme === 'dark' 
            ? 'bg-[#0E0E0E] border-neutral-900' 
            : 'bg-[#F4F4F4] border-neutral-200'
        }`}>
          
          <div className="flex flex-col p-5 gap-6">
            
            {/* View Hub Links */}
            <div className={`flex flex-col gap-1 pb-5 border-b ${
              theme === 'dark' ? 'border-neutral-900/60' : 'border-neutral-200/85'
            }`}>
              <h2 className={`text-[10px] font-bold uppercase tracking-wider px-2 mb-2 ${
                theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
              }`}>View Hub</h2>
              
              <button
                onClick={() => setActiveTab('reference')}
                className={`w-full text-left px-3.5 py-2.5 rounded-lg font-medium text-xs flex items-center justify-between transition-all ${
                  activeTab === 'reference' 
                    ? (theme === 'dark' ? 'bg-white text-black font-bold' : 'bg-black text-white font-bold') 
                    : (theme === 'dark' 
                        ? 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/40' 
                        : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/40')
                }`}
              >
                <div className="flex items-center gap-3">
                  <Smartphone size={14} />
                  <span>Reference Terminal</span>
                </div>
                <ChevronRight size={12} className="opacity-60" />
              </button>

              <button
                onClick={() => setActiveTab('farm')}
                className={`w-full text-left px-3.5 py-2.5 rounded-lg font-medium text-xs flex items-center justify-between transition-all ${
                  activeTab === 'farm' 
                    ? (theme === 'dark' ? 'bg-white text-black font-bold' : 'bg-black text-white font-bold') 
                    : (theme === 'dark' 
                        ? 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/40' 
                        : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/40')
                }`}
              >
                <div className="flex items-center gap-3">
                  <Layers size={14} />
                  <span>Multi-Account Farm</span>
                </div>
                <ChevronRight size={12} className="opacity-60" />
              </button>

              <button
                onClick={() => setActiveTab('spreads')}
                className={`w-full text-left px-3.5 py-2.5 rounded-lg font-medium text-xs flex items-center justify-between transition-all ${
                  activeTab === 'spreads' 
                    ? (theme === 'dark' ? 'bg-white text-black font-bold' : 'bg-black text-white font-bold') 
                    : (theme === 'dark' 
                        ? 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/40' 
                        : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/40')
                }`}
              >
                <div className="flex items-center gap-3">
                  <TrendingUp size={14} />
                  <span>Live Spreads</span>
                </div>
                <ChevronRight size={12} className="opacity-60" />
              </button>
            </div>

            {/* Quick Order pad */}
            <div className={`flex flex-col gap-4 pb-5 border-b ${
              theme === 'dark' ? 'border-neutral-900/60' : 'border-neutral-200/85'
            }`}>
              <div className="flex justify-between items-center px-1">
                <h2 className={`text-[10px] font-bold uppercase tracking-wider ${
                  theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
                }`}>Execution Pad</h2>
                <span className={`px-1.5 py-0.2 text-[8px] rounded font-mono ${
                  theme === 'dark' ? 'bg-neutral-900 text-neutral-500 border border-neutral-850' : 'bg-neutral-200 text-neutral-600 border border-neutral-250'
                }`}>Scaled Copy</span>
              </div>

              {/* Instrument Select */}
              <div className="flex flex-col gap-1">
                <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Select Symbol</label>
                <select
                  value={selectedSymbol}
                  onChange={(e) => setSelectedSymbol(e.target.value)}
                  className={`w-full border rounded-lg px-3 py-2 text-xs transition-all font-semibold focus:outline-none ${
                    theme === 'dark'
                      ? 'bg-neutral-900/80 border-neutral-800 hover:border-neutral-750 text-neutral-200 focus:border-neutral-600'
                      : 'bg-white border-neutral-200 hover:border-neutral-300 text-neutral-800 focus:border-neutral-400'
                  }`}
                >
                  <option value="">-- No Symbol Selected --</option>
                  {symbols.map(sym => (
                    <option key={sym} value={sym}>{sym}</option>
                  ))}
                </select>
              </div>

              {/* Input Lot sizes / SL Pips */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>SL Pips</label>
                  <input
                    type="number"
                    value={slPips}
                    onChange={(e) => setSlPips(e.target.value)}
                    placeholder="SL pips"
                    className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                      theme === 'dark'
                        ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                        : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                    }`}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center px-1">
                    <label className={`text-[10px] font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Volume</label>
                    <button 
                      onClick={() => setIsRiskBasedInput(!isRiskBasedInput)}
                      className={`text-[8px] uppercase tracking-wider font-extrabold hover:underline ${
                        theme === 'dark' ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-800'
                      }`}
                    >
                      {isRiskBasedInput ? 'Risk' : 'Lots'}
                    </button>
                  </div>
                  <input
                    type={isRiskBasedInput ? "text" : "number"}
                    disabled={isRiskBasedInput}
                    value={isRiskBasedInput ? "Auto %Risk" : quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="Lots"
                    className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed ${
                      theme === 'dark'
                        ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                        : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                    }`}
                  />
                </div>
              </div>

              {/* Huge Buy/Sell triggers */}
              <div className="grid grid-cols-2 gap-3 mt-1">
                <button
                  onClick={() => handleTrade('buy')}
                  className="py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wide active:scale-95 transition-all flex items-center justify-center gap-1.5"
                >
                  <ArrowUpRight size={14} />
                  BUY
                </button>
                <button
                  onClick={() => handleTrade('sell')}
                  className="py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs tracking-wide active:scale-95 transition-all flex items-center justify-center gap-1.5"
                >
                  <ArrowDownRight size={14} />
                  SELL
                </button>
              </div>

              {/* Flatten Symbol */}
              <button
                onClick={handleFlattenSymbol}
                className={`w-full py-2.5 rounded-lg border text-[10px] font-bold tracking-wider transition-all flex items-center justify-center gap-2 active:scale-95 ${
                  theme === 'dark'
                    ? 'bg-neutral-900 border-neutral-850 hover:border-neutral-750 text-neutral-300 hover:text-white'
                    : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 hover:border-neutral-300 text-neutral-700 hover:text-black'
                }`}
              >
                <XOctagon size={12} className="text-rose-500 animate-pulse" />
                FLATTEN SYMBOL
              </button>
            </div>

            {/* Quick Metrics */}
            <div className="flex flex-col gap-2">
              <h2 className={`text-[10px] font-bold uppercase tracking-wider px-1 ${
                theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
              }`}>Reference Metrics</h2>
              
              <div className="grid grid-cols-2 gap-3">
                <div className={`p-3 rounded-lg border transition-colors ${
                  theme === 'dark' 
                    ? 'bg-neutral-900/40 border-neutral-850/60' 
                    : 'bg-white border-neutral-250/80 shadow-sm'
                }`}>
                  <span className={`text-[9px] uppercase font-bold block mb-1 ${
                    theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
                  }`}>Cash Balance</span>
                  <span className={`font-mono text-xs font-extrabold ${
                    theme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'
                  }`}>
                    {referenceAccount?.cash_value ? `${referenceAccount.cash_value.toFixed(2)}$` : 'N/A'}
                  </span>
                </div>
                
                <div className={`p-3 rounded-lg border transition-colors ${
                  theme === 'dark' 
                    ? 'bg-neutral-900/40 border-neutral-850/60' 
                    : 'bg-white border-neutral-250/80 shadow-sm'
                }`}>
                  <span className={`text-[9px] uppercase font-bold block mb-1 ${
                    theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
                  }`}>Free Margin</span>
                  <span className={`font-mono text-xs font-extrabold ${
                    theme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'
                  }`}>
                    {referenceAccount?.buying_power ? `${referenceAccount.buying_power.toFixed(2)}$` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

          </div>

          {/* Sidebar Status / Info Footer (Saves Vertical Pixels) */}
          <div className={`p-4 border-t flex flex-col gap-2 text-[10px] transition-colors ${
            theme === 'dark' ? 'border-neutral-900 text-neutral-500' : 'border-neutral-200/85 text-neutral-450'
          }`}>
            <div className="flex items-center gap-2">
              <ShieldAlert size={12} className={theme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'} />
              <span>Secure Sandbox Backend</span>
            </div>
            <div className="flex items-center gap-2">
              <Volume2 size={12} className="text-emerald-500" />
              <span>Multi-Account Copier Active</span>
            </div>
            <div className="opacity-60 mt-1 select-none font-sans">
              © 2026 PropFirm Control Hub
            </div>
          </div>
        </aside>

        {/* Right Column Main Viewport */}
        <div className="flex-grow flex flex-col h-full overflow-hidden">
          
          {/* Scrollable View Content - Compresses spacing and displays raw tables directly on theme canvas */}
          <div className="flex-grow overflow-y-auto px-6 py-5 flex flex-col gap-6">
            
            {/* TAB 1: Reference Terminal */}
            {activeTab === 'reference' && (
              <div className="flex flex-col gap-6">
                
                {/* Positions Panel */}
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <div>
                      <h3 className={`font-bold text-sm tracking-tight ${
                        theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'
                      }`}>Reference Positions</h3>
                      <p className={`text-xs ${
                        theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
                      }`}>Current positions active on the primary master terminal.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs ${
                        theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
                      }`}>Unrealized:</span>
                      <span className={`font-mono text-xs font-bold px-2.5 py-1 rounded-md border ${
                        theme === 'dark' 
                          ? 'bg-neutral-900/60 border-neutral-800' 
                          : 'bg-neutral-100 border-neutral-250 shadow-sm'
                      } ${
                        activePositionsTotalPnL >= 0 ? 'text-emerald-500' : 'text-rose-500'
                      }`}>
                        {formatPnl(activePositionsTotalPnL)}
                      </span>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className={`border-b text-[10px] uppercase tracking-wider font-bold ${
                          theme === 'dark' ? 'border-neutral-900 text-neutral-500' : 'border-neutral-200 text-neutral-450'
                        }`}>
                          <th className="pb-2.5">Symbol</th>
                          <th className="pb-2.5">Direction</th>
                          <th className="pb-2.5">Quantity</th>
                          <th className="pb-2.5">Avg Entry</th>
                          <th className="pb-2.5 text-right">PNL</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${
                        theme === 'dark' ? 'divide-neutral-900/40' : 'divide-neutral-200/60'
                      }`}>
                        {referenceAccount?.positions && referenceAccount.positions.length > 0 ? (
                          referenceAccount.positions.map((pos, idx) => (
                            <tr key={idx} className={`transition-colors ${
                              theme === 'dark' ? 'hover:bg-white/[0.01]' : 'hover:bg-black/[0.01]'
                            }`}>
                              <td className={`py-2.5 font-semibold ${
                                theme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'
                              }`}>{pos.displaySymbol || pos.symbol}</td>
                              <td className="py-2.5">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${
                                  pos.direction === 'BUY' 
                                    ? 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/40 dark:text-emerald-400' 
                                    : 'bg-rose-950/40 text-rose-500 border border-rose-900/40 dark:text-rose-400'
                                }`}>
                                  {pos.direction}
                                </span>
                              </td>
                              <td className={`py-2.5 font-mono ${
                                theme === 'dark' ? 'text-neutral-350' : 'text-neutral-600'
                              }`}>{Math.abs(pos.quantity).toFixed(2)}</td>
                              <td className={`py-2.5 font-mono ${
                                theme === 'dark' ? 'text-neutral-400' : 'text-neutral-500'
                              }`}>{pos.avgPrice.toFixed(pos.avgPrice > 50 ? 2 : 5)}</td>
                              <td className={`py-2.5 text-right font-mono font-semibold ${
                                (pos.pnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                              }`}>
                                {formatPnl(pos.pnl)}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className={`py-6 text-center italic ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'}`}>
                              {wsStatus !== 'connected' ? 'Connecting to live status...' : 'No active positions on reference account.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Pending Orders Panel */}
                <div className="flex flex-col gap-3 mt-2">
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <div>
                      <h3 className={`font-bold text-sm tracking-tight ${
                        theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'
                      }`}>Pending Orders</h3>
                      <p className={`text-xs ${
                        theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
                      }`}>Staged orders awaiting execution conditions.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCancelAllPending}
                        className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold tracking-wide transition-all active:scale-95 ${
                          theme === 'dark'
                            ? 'bg-amber-600/10 border-amber-500/20 hover:border-amber-500/40 text-amber-400'
                            : 'bg-amber-50 border-amber-200 hover:bg-amber-100 text-amber-700'
                        }`}
                      >
                        CANCEL ALL PENDING
                      </button>
                      <button
                        onClick={handleFlattenEverything}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold tracking-wide transition-all active:scale-95"
                      >
                        FLATTEN EVERYTHING
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className={`border-b text-[10px] uppercase tracking-wider font-bold ${
                          theme === 'dark' ? 'border-neutral-900 text-neutral-500' : 'border-neutral-200 text-neutral-450'
                        }`}>
                          <th className="pb-2.5">Symbol</th>
                          <th className="pb-2.5">Direction</th>
                          <th className="pb-2.5">Quantity</th>
                          <th className="pb-2.5">Order Type</th>
                          <th className="pb-2.5 text-right">Target Price</th>
                        </tr>
                      </thead>
                      <tbody className={`divide-y ${
                        theme === 'dark' ? 'divide-neutral-900/40' : 'divide-neutral-200/60'
                      }`}>
                        {referenceAccount?.orders && referenceAccount.orders.length > 0 ? (
                          referenceAccount.orders.map((ord, idx) => (
                            <tr key={idx} className={`transition-colors ${
                              theme === 'dark' ? 'hover:bg-white/[0.01]' : 'hover:bg-black/[0.01]'
                            }`}>
                              <td className={`py-2.5 font-semibold ${
                                theme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'
                              }`}>{ord.displaySymbol || ord.symbol}</td>
                              <td className="py-2.5">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${
                                  ord.direction === 'BUY' 
                                    ? 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/40 dark:text-emerald-400' 
                                    : 'bg-rose-950/40 text-rose-500 border border-rose-900/40 dark:text-rose-400'
                                }`}>
                                  {ord.direction}
                                </span>
                              </td>
                              <td className={`py-2.5 font-mono ${
                                theme === 'dark' ? 'text-neutral-350' : 'text-neutral-600'
                              }`}>{ord.quantity.toFixed(2)}</td>
                              <td className={`py-2.5 uppercase font-mono text-[10px] ${
                                theme === 'dark' ? 'text-neutral-400' : 'text-neutral-500'
                              }`}>{ord.orderType}</td>
                              <td className={`py-2.5 text-right font-mono ${
                                theme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'
                              }`}>{ord.price.toFixed(ord.price > 50 ? 2 : 5)}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className={`py-6 text-center italic ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'}`}>
                              {wsStatus !== 'connected' ? 'Connecting to live status...' : 'No pending orders on reference account.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 2: Multi-Account Farm Overview */}
            {activeTab === 'farm' && (
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center flex-wrap gap-4 border-b pb-3.5 transition-colors border-neutral-200/80 dark:border-neutral-900">
                  <div>
                    <h3 className={`font-bold text-sm tracking-tight ${
                      theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'
                    }`}>Multi-Account Trading Farm</h3>
                    <p className={`text-xs ${
                      theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
                    }`}>Central management dashboard monitoring copy actions and allocations.</p>
                  </div>
                  
                  <div className="flex gap-2.5">
                    <button
                      onClick={handleCancelAllPending}
                      className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold tracking-wide transition-all active:scale-95 ${
                        theme === 'dark'
                          ? 'bg-amber-600/10 border-amber-500/20 hover:border-amber-500/40 text-amber-400'
                          : 'bg-amber-50 border-amber-200 hover:bg-amber-100 text-amber-700'
                      }`}
                    >
                      CANCEL ALL PENDING
                    </button>
                    <button
                      onClick={handleFlattenEverything}
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold tracking-wide transition-all active:scale-95"
                    >
                      FLATTEN ENTIRE PORTFOLIO
                    </button>
                  </div>
                </div>

                {/* High-density Farm Account Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className={`border-b text-[10px] uppercase tracking-wider font-bold ${
                        theme === 'dark' ? 'border-neutral-900 text-neutral-500' : 'border-neutral-200 text-neutral-450'
                      }`}>
                        <th className="pb-2.5 px-3">Account / ID</th>
                        <th className="pb-2.5 px-3">Status</th>
                        <th className="pb-2.5 px-3">Copy Action</th>
                        <th className="pb-2.5 px-3 text-right">Multiplier</th>
                        <th className="pb-2.5 px-3 text-right">Alloc Risk</th>
                        <th className="pb-2.5 px-3 text-right">Equity Balance</th>
                        <th className="pb-2.5 px-3 text-right">Free Margin</th>
                        <th className="pb-2.5 px-3 text-right">Realized Profit</th>
                        <th className="pb-2.5 px-3 text-right">Unrealized PNL</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${
                      theme === 'dark' ? 'divide-neutral-900/40' : 'divide-neutral-200/60'
                    }`}>
                      {allAccounts.length > 0 ? (
                        allAccounts.map((acc) => {
                          const isReference = referenceAccount?.id === acc.id;
                          const pnlVal = acc.unrealizedPNL || 0;
                          const hasPositions = acc.positions && acc.positions.length > 0;
                          
                          // Style has open positions with elegant subtle background
                          const positionHighlightClass = hasPositions
                            ? (theme === 'dark' ? 'bg-emerald-950/15' : 'bg-emerald-50/40')
                            : '';
                          
                          return (
                            <tr 
                              key={acc.id} 
                              className={`transition-colors duration-150 ${positionHighlightClass} ${
                                theme === 'dark' ? 'hover:bg-white/[0.02]' : 'hover:bg-black/[0.02]'
                              } ${
                                isReference 
                                  ? (theme === 'dark' ? 'bg-white/[0.02] border-l-2 border-white' : 'bg-black/[0.02] border-l-2 border-black') 
                                  : ''
                              }`}
                            >
                              <td className="py-2.5 px-3 font-semibold">
                                <div className="flex items-center gap-1.5">
                                  <span className={theme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'}>
                                    {acc.displayName || acc.id}
                                  </span>
                                  {isReference && (
                                    <span className={`text-[7px] uppercase tracking-wider font-extrabold px-1 py-0.2 rounded font-sans ${
                                      theme === 'dark' ? 'bg-white text-black' : 'bg-black text-white'
                                    }`}>
                                      Ref
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-1.5">
                                  <span className={`w-1.5 h-1.5 rounded-full ${
                                    acc.status === 'Connected' ? 'bg-emerald-500' :
                                    acc.status === 'Connecting' ? 'bg-amber-500 animate-pulse' :
                                    'bg-rose-500'
                                  }`} />
                                  <span className={`text-[10px] ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>{acc.status}</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className={`px-1.5 py-0.2 rounded text-[8px] uppercase tracking-wider font-extrabold ${
                                  acc.trade_enabled 
                                    ? (theme === 'dark' ? 'bg-neutral-900 text-neutral-300 border border-neutral-800' : 'bg-neutral-200 text-neutral-700 border border-neutral-250') 
                                    : (theme === 'dark' ? 'bg-neutral-950 text-neutral-600 border border-neutral-900/60' : 'bg-neutral-100 text-neutral-450 border border-neutral-200/50')
                                }`}>
                                  {acc.trade_enabled ? 'Active' : 'Disabled'}
                                </span>
                              </td>
                              <td className={`py-2.5 px-3 text-right font-mono text-xs ${theme === 'dark' ? 'text-neutral-300' : 'text-neutral-600'}`}>
                                {acc.multiplier !== undefined ? `x${acc.multiplier.toFixed(1)}` : 'N/A'}
                              </td>
                              <td className={`py-2.5 px-3 text-right font-mono text-xs ${theme === 'dark' ? 'text-neutral-450' : 'text-neutral-500'}`}>
                                {acc.riskPerc !== undefined ? `${acc.riskPerc}%` : 'N/A'}
                              </td>
                              <td className={`py-2.5 px-3 text-right font-mono text-xs ${theme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'}`}>
                                {acc.cash_value ? `${acc.cash_value.toFixed(2)}$` : 'N/A'}
                              </td>
                              <td className={`py-2.5 px-3 text-right font-mono text-xs ${theme === 'dark' ? 'text-neutral-450' : 'text-neutral-500'}`}>
                                {acc.buying_power ? `${acc.buying_power.toFixed(2)}$` : 'N/A'}
                              </td>
                              <td className={`py-2.5 px-3 text-right font-mono text-xs font-semibold ${
                                (acc.realizedPNL || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                              }`}>
                                {formatPnl(acc.realizedPNL)}
                              </td>
                              <td className={`py-2.5 px-3 text-right font-mono text-xs font-semibold transition-all duration-300 ${
                                farmPnlPulse[acc.id] ? 'animate-flicker' : ''
                              } ${
                                pnlVal >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                              }`}>
                                {formatPnl(acc.unrealizedPNL)}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={9} className={`py-6 text-center italic ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-400'}`}>
                            {wsStatus !== 'connected' ? 'Connecting to farm accounts...' : 'No accounts detected. Configure settings in propfundsettings.json.'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: Spreads Matrix */}
            {activeTab === 'spreads' && (
              <div className="flex flex-col gap-4 animate-fadeIn">
                <div className="border-b pb-3.5 transition-colors border-neutral-200/80 dark:border-neutral-900">
                  <h3 className={`font-bold text-sm tracking-tight ${
                    theme === 'dark' ? 'text-neutral-100' : 'text-neutral-900'
                  }`}>Spread Monitor Matrix</h3>
                  <p className={`text-xs ${
                    theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
                  }`}>Live spreads monitored concurrently on active meta bridge instances.</p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className={`border-b text-[10px] uppercase tracking-wider font-bold ${
                        theme === 'dark' ? 'border-neutral-900 text-neutral-500' : 'border-neutral-200 text-neutral-450'
                      }`}>
                        <th className="pb-2.5 px-3">Account</th>
                        {symbols.map((sym: string) => (
                          <th key={sym} className="pb-2.5 px-3 text-center">{sym}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${
                      theme === 'dark' ? 'divide-neutral-900/40' : 'divide-neutral-200/60'
                    }`}>
                      {symbols.length > 0 ? (
                        spreadAccounts.length > 0 ? (
                          spreadAccounts.map((account: SpreadAccount) => (
                            <tr key={account.id} className={`transition-colors ${
                              theme === 'dark' ? 'hover:bg-white/[0.01]' : 'hover:bg-black/[0.01]'
                            }`}>
                              <td className={`py-2.5 px-3 font-semibold ${
                                theme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'
                              }`}>{account.displayName || account.id}</td>
                              {symbols.map((sym: string) => {
                                const rawSpread = account.spreads ? account.spreads[sym] : undefined;
                                const pointValue = account.defaultpointvalue ? account.defaultpointvalue[sym] : undefined;
                                let displayVal = '-';
                                let spreadClass = theme === 'dark' ? 'text-neutral-400' : 'text-neutral-500';
                                
                                if (rawSpread !== undefined && rawSpread !== null && pointValue !== undefined && pointValue > 0) {
                                  const pipValue = rawSpread / pointValue;
                                  displayVal = pipValue.toFixed(1);
                                  if (pipValue <= 1.5) {
                                    spreadClass = 'text-emerald-600 dark:text-emerald-450 font-semibold';
                                  } else if (pipValue <= 3.0) {
                                    spreadClass = 'text-amber-600 dark:text-amber-500 font-semibold';
                                  } else {
                                    spreadClass = 'text-red-600 dark:text-red-405 font-semibold';
                                  }
                                }
                                
                                const isFlickering = spreadPulses[`${account.id}-${sym}`];
                                return (
                                  <td 
                                    key={sym} 
                                    className={`py-2.5 px-3 text-center font-mono text-xs transition-colors duration-300 ${spreadClass} ${
                                      isFlickering ? 'animate-spread-flash' : ''
                                    }`}
                                  >
                                    {displayVal}
                                  </td>
                                );
                              })}
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={symbols.length + 1} className={`py-6 text-center italic ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                              {wsStatus !== 'connected' ? 'Waiting for WebSocket connection...' : 'Connecting to active meta bridge instances to poll spreads...'}
                            </td>
                          </tr>
                        )
                      ) : (
                        <tr>
                          <td className={`py-6 text-center italic ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                            Waiting for global symbol configuration...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>

          {/* Integrated Logs Base Panel - Saves Vertical space and blends into main viewport bottom */}
          <div className={`h-44 border-t px-6 py-3 flex flex-col gap-2 flex-shrink-0 transition-colors ${
            theme === 'dark' ? 'bg-[#0A0A0A] border-neutral-900' : 'bg-[#FAFAFA] border-neutral-200'
          }`}>
            <div className={`flex justify-between items-center flex-wrap gap-2 border-b pb-2 ${
              theme === 'dark' ? 'border-neutral-900' : 'border-neutral-200/85'
            }`}>
              <div className="flex items-center gap-2.5">
                <h3 className={`font-bold text-[10px] uppercase tracking-wider ${
                  theme === 'dark' ? 'text-neutral-200' : 'text-neutral-800'
                }`}>System Logs & Trade Activity</h3>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              </div>

              {/* Log filter toggles */}
              <div className={`flex gap-0.5 p-0.5 rounded-lg border ${
                theme === 'dark' ? 'bg-neutral-950/60 border-neutral-900' : 'bg-neutral-100 border-neutral-250'
              }`}>
                {(['all', 'info', 'trade', 'error'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setLogFilter(filter)}
                    className={`px-2 py-0.5 rounded-md text-[8px] uppercase font-bold transition-all ${
                      logFilter === filter 
                        ? (theme === 'dark' ? 'bg-neutral-800 text-neutral-100' : 'bg-white text-neutral-900 shadow-sm border border-neutral-200/40') 
                        : (theme === 'dark' ? 'text-neutral-500 hover:text-neutral-200' : 'text-neutral-500 hover:text-neutral-850')
                    }`}
                  >
                    {filter}
                  </button>
                ))}
                <button
                  onClick={() => setLogs([])}
                  className="px-1.5 py-0.5 rounded-md text-[8px] text-rose-500 hover:opacity-75 transition-all font-bold"
                >
                  CLEAR
                </button>
              </div>
            </div>

            {/* Render Log items */}
            <div className="flex-grow overflow-y-auto font-mono text-[10px] flex flex-col gap-1 pr-2">
              {filteredLogs.length > 0 ? (
                filteredLogs.map((log, idx) => (
                  <div key={idx} className="flex gap-2 items-start py-0.2 leading-relaxed">
                    <span className={`select-none text-[9px] ${
                      theme === 'dark' ? 'text-neutral-600' : 'text-neutral-400'
                    }`}>{log.timestamp}</span>
                    <span className={`px-1.5 py-0.2 border rounded-[3px] text-[8px] uppercase font-extrabold flex-shrink-0 ${
                      theme === 'dark' 
                        ? 'bg-neutral-900 text-neutral-450 border-neutral-800' 
                        : 'bg-neutral-200 text-neutral-600 border-neutral-300'
                    }`}>
                      {log.source}
                    </span>
                    <span className={
                      log.type === 'error' ? 'text-rose-500 font-semibold' :
                      log.type === 'warning' ? 'text-amber-500 font-medium' :
                      log.type === 'trade' ? 'text-emerald-500 font-bold' :
                      (theme === 'dark' ? 'text-neutral-300' : 'text-neutral-700')
                    }>
                      {log.message}
                    </span>
                  </div>
                ))
              ) : (
                <div className="h-full flex items-center justify-center text-neutral-400 text-xs italic">
                  Waiting for system events...
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* --- PREMIUM Apple Theme-Aware Confirmation Modal --- */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          {/* Backdrop blur overlay */}
          <div className="absolute inset-0 bg-neutral-950/40 backdrop-blur-sm" onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} />
          
          <div className={`relative rounded-xl w-full max-w-sm p-5 border flex flex-col gap-4 shadow-xl z-10 animate-in zoom-in-95 duration-200 ${
            theme === 'dark'
              ? 'bg-[#0E0E0E] border-neutral-800 text-neutral-100 shadow-neutral-950/80'
              : 'bg-white border-neutral-200 text-neutral-900 shadow-neutral-250/50'
          }`}>
            <div className={`flex justify-between items-center border-b pb-2.5 ${
              theme === 'dark' ? 'border-neutral-900' : 'border-neutral-100'
            }`}>
              <h3 className={`font-bold text-sm flex items-center gap-2 ${
                confirmModal.isDanger ? 'text-rose-500' : (theme === 'dark' ? 'text-neutral-100' : 'text-neutral-800')
              }`}>
                {confirmModal.isDanger ? <ShieldAlert size={16} /> : <CheckCircle2 size={16} />}
                {confirmModal.title}
              </h3>
              <button onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} className={`transition-colors ${
                theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-400 hover:text-neutral-700'
              }`}>
                <X size={15} />
              </button>
            </div>
            
            <p className={`text-xs leading-relaxed font-medium ${
              theme === 'dark' ? 'text-neutral-350' : 'text-neutral-600'
            }`}>
              {confirmModal.message}
            </p>
            
            <div className="flex justify-end gap-2.5 mt-1.5">
              <button
                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold tracking-wide transition-all ${
                  theme === 'dark'
                    ? 'bg-neutral-900 border-neutral-850 hover:bg-neutral-800 hover:border-neutral-750 text-neutral-300'
                    : 'bg-neutral-50 border-neutral-200 hover:bg-neutral-100 text-neutral-600'
                }`}
              >
                CANCEL
              </button>
              <button
                onClick={confirmModal.action}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all active:scale-95 text-white ${
                  confirmModal.isDanger 
                    ? 'bg-rose-600 hover:bg-rose-500' 
                    : (theme === 'dark' ? 'bg-white hover:bg-neutral-200 text-black' : 'bg-black hover:bg-neutral-800 text-white')
                }`}
              >
                PROCEED ACTION
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

