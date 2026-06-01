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

const safeParseFloat = (val: any, defaultVal: number = 0): number => {
  if (val === undefined || val === null) return defaultVal;
  const str = String(val).replace(',', '.').trim();
  const parsed = parseFloat(str);
  return isNaN(parsed) ? defaultVal : parsed;
};

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

  // Upgraded Cockpit Pad States
  const [executionTab, setExecutionTab] = useState<'entry' | 'modify' | 'manage'>('entry');
  const [entryMode, setEntryMode] = useState<'pip_risk' | 'atr_risk' | 'pending'>('pip_risk');
  
  // 1. Pip & %Risk Mode
  const [customRisk, setCustomRisk] = useState<string>('2.0');
  
  // 2. ATR & %Risk Mode
  const [atrMultiplier, setAtrMultiplier] = useState<string>('2.0');
  const [atrRiskPerc, setAtrRiskPerc] = useState<string>('2.0');
  const [atrInfo, setAtrInfo] = useState<{ atr_raw: number; atr_pips: number } | null>(null);
  const [atrLoading, setAtrLoading] = useState<boolean>(false);
  
  // 3. Pending Limit Mode
  const [entryOffsetBuy, setEntryOffsetBuy] = useState<string>('5.0');
  const [entryOffsetSell, setEntryOffsetSell] = useState<string>('5.0');
  const [limitSlPips, setLimitSlPips] = useState<string>('15.0');
  const [limitTpPips, setLimitTpPips] = useState<string>('30.0');
  const [limitSizingMode, setLimitSizingMode] = useState<'risk' | 'lots'>('risk');
  const [limitRiskPerc, setLimitRiskPerc] = useState<string>('2.0');
  const [limitLots, setLimitLots] = useState<string>('1.0');
  
  // 4. Modify Order Mode
  const [modifyOffsetBuy, setModifyOffsetBuy] = useState<string>('5.0');
  const [modifyOffsetSell, setModifyOffsetSell] = useState<string>('5.0');
  
  // 5. Manage Position Mode
  const [manageSlEntryPips, setManageSlEntryPips] = useState<string>('10.0');
  const [manageSlMidPips, setManageSlMidPips] = useState<string>('5.0');
  const [manageTpEntryPips, setManageTpEntryPips] = useState<string>('20.0');
  const [manageTpMidPips, setManageTpMidPips] = useState<string>('10.0');
  
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

  // --- Symbol Suffix Matcher & Derived Working States ---
  const matchSymbol = (brokerSymbol: string | undefined, displaySymbol: string | undefined, globalSymbol: string): boolean => {
    if (!globalSymbol) return false;
    if (displaySymbol === globalSymbol) return true;
    if (brokerSymbol === globalSymbol) return true;
    
    // Suffix matching: e.g. "EURUSD.pi", "EURUSD.raw", "EURUSD..", "EURUSD..." -> "EURUSD"
    if (brokerSymbol) {
      const cleanBroker = brokerSymbol.split(/[.\-_]/)[0];
      if (cleanBroker === globalSymbol) return true;
      if (brokerSymbol.startsWith(globalSymbol)) return true;
    }
    return false;
  };

  const activePosition = useMemo(() => {
    if (!referenceAccount?.positions || !selectedSymbol) return null;
    return referenceAccount.positions.find(pos => matchSymbol(pos.symbol, pos.displaySymbol, selectedSymbol));
  }, [referenceAccount, selectedSymbol]);

  const pendingOrder = useMemo(() => {
    if (!referenceAccount?.orders || !selectedSymbol) return null;
    return referenceAccount.orders.find(ord => matchSymbol(ord.symbol, ord.displaySymbol, selectedSymbol));
  }, [referenceAccount, selectedSymbol]);

  // --- Auto-fill SL pips based on selected symbol ---
  useEffect(() => {
    if (selectedSymbol && defaultSlPips[selectedSymbol] !== undefined) {
      const slString = defaultSlPips[selectedSymbol].toString();
      setSlPips(slString);
      setLimitSlPips(slString);
      
      const slFloat = safeParseFloat(slString);
      setLimitTpPips((slFloat * 2.0).toString());
      
      // Adjust forms for indexes vs currencies
      const isIndex = ['SP500', 'DAX40', 'FTSE100', 'NQ100', 'GOLD'].includes(selectedSymbol);
      setIsRiskBasedInput(!isIndex);
      if (isIndex) {
        setLimitSizingMode('lots');
      } else {
        setLimitSizingMode('risk');
      }
    }
  }, [selectedSymbol, defaultSlPips]);

  // --- Dynamic ATR fetcher ---
  useEffect(() => {
    if (selectedSymbol && entryMode === 'atr_risk') {
      setAtrLoading(true);
      sendRequest('get_atr', { symbol: selectedSymbol })
        .then(res => {
          if (res?.success) {
            setAtrInfo(res);
          } else {
            setAtrInfo(null);
            addLog(`Failed to fetch ATR for ${selectedSymbol}: ${res?.error || 'Unknown error'}`, 'UI', 'warning');
          }
        })
        .catch(err => {
          setAtrInfo(null);
          addLog(`ATR fetch error: ${err}`, 'UI', 'error');
        })
        .finally(() => setAtrLoading(false));
    }
  }, [selectedSymbol, entryMode]);

  // --- Upgraded Interactive Cockpit Command Triggers ---
  const handleEntryTrade = (
    direction: 'buy' | 'sell',
    ordertype: string = 'market',
    slVal: number,
    tpVal: number = 0,
    offsetVal: number = 0,
    riskPerc: number = 0,
    lotsVal: number = 0
  ) => {
    if (!selectedSymbol) return triggerAlert('Select an instrument first!', 'warning');
    if (isNaN(slVal) || slVal <= 0) return triggerAlert('Input a valid Stop Loss (pips)!', 'warning');

    const payload: any = {
      symbol: selectedSymbol,
      direction,
      ordertype,
      sl_pips: slVal,
      tp_pips: tpVal,
      offset_pips: offsetVal,
    };

    if (riskPerc > 0) {
      payload.risk = riskPerc;
      payload.qty = 0.0;
    } else {
      payload.qty = lotsVal;
      payload.risk = 0.0;
    }

    const modeText = ordertype === 'market' ? 'MARKET' : `PENDING ${ordertype.toUpperCase()}`;
    triggerAlert(`Sending scaled ${modeText} ${direction.toUpperCase()} for ${selectedSymbol}...`, 'info');

    sendRequest('trade', payload)
      .then(res => {
        triggerAlert(res?.message || `Trade placed successfully.`, 'success');
      })
      .catch(err => {
        triggerAlert(`Trade failed: ${err}`, 'danger');
      });
  };

  const handleTrade = (direction: 'buy' | 'sell') => {
    handleEntryTrade(
      direction,
      'market',
      safeParseFloat(slPips),
      0,
      0,
      isRiskBasedInput ? 2.0 : 0,
      safeParseFloat(quantity)
    );
  };

  const handleModifyOrder = (newPriceType: string) => {
    if (!selectedSymbol) return triggerAlert('Select a symbol first!', 'warning');
    
    let offsetVal = 0;
    if (newPriceType === 'offset' && pendingOrder) {
      const isBuy = pendingOrder.direction === 'BUY';
      offsetVal = safeParseFloat(isBuy ? modifyOffsetBuy : modifyOffsetSell);
      if (isNaN(offsetVal) || offsetVal < 0) {
        return triggerAlert('Please input a valid offset value!', 'warning');
      }
    }

    const payload = {
      symbol: selectedSymbol,
      new_price_type: newPriceType,
      offset_pips: offsetVal
    };

    triggerAlert(`Modifying pending order for ${selectedSymbol} to ${newPriceType.toUpperCase()}...`, 'info');

    sendRequest('modify_order', payload)
      .then(res => {
        triggerAlert(res?.message || 'Order modified successfully.', 'success');
      })
      .catch(err => {
        triggerAlert(`Modification failed: ${err}`, 'danger');
      });
  };

  const handleCancelSelectedOrder = () => {
    if (!selectedSymbol) return triggerAlert('Select a symbol first!', 'warning');
    
    setConfirmModal({
      isOpen: true,
      title: 'Cancel Pending Order',
      message: `Are you sure you want to cancel the working pending order for ${selectedSymbol} across all accounts?`,
      isDanger: true,
      action: () => {
        triggerAlert(`Cancelling pending order for ${selectedSymbol}...`, 'info');
        sendRequest('cancel_order', { symbol: selectedSymbol })
          .then(res => triggerAlert(res?.message || 'Order cancelled successfully.', 'success'))
          .catch(err => triggerAlert(`Cancellation failed: ${err}`, 'danger'));
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleManagePosition = (type: 'breakeven' | 'flatten' | 'sl_entry' | 'sl_mid' | 'tp_entry' | 'tp_mid') => {
    if (!selectedSymbol) return triggerAlert('Select a symbol first!', 'warning');

    if (type === 'flatten') {
      setConfirmModal({
        isOpen: true,
        title: 'Flatten Position',
        message: `Are you sure you want to close ALL active positions for ${selectedSymbol} at Market across all accounts?`,
        isDanger: true,
        action: () => {
          triggerAlert(`Flattening ${selectedSymbol} positions...`, 'info');
          sendRequest('flatten', { instrument: selectedSymbol })
            .then(res => triggerAlert(res?.message || 'Positions closed successfully.', 'success'))
            .catch(err => triggerAlert(`Flatten failed: ${err}`, 'danger'));
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      });
      return;
    }

    const payload: any = {
      symbol: selectedSymbol
    };

    if (type === 'breakeven') {
      payload.sl = { type: 'breakeven' };
    } else if (type === 'sl_entry') {
      const slVal = safeParseFloat(manageSlEntryPips);
      if (isNaN(slVal) || slVal < 0) return triggerAlert('Invalid SL pips value', 'warning');
      payload.sl = { type: 'pips_from_entry', value: slVal };
    } else if (type === 'sl_mid') {
      const slVal = safeParseFloat(manageSlMidPips);
      if (isNaN(slVal) || slVal < 0) return triggerAlert('Invalid SL pips value', 'warning');
      payload.sl = { type: 'pips_from_mid', value: slVal };
    } else if (type === 'tp_entry') {
      const tpVal = safeParseFloat(manageTpEntryPips);
      if (isNaN(tpVal) || tpVal < 0) return triggerAlert('Invalid TP pips value', 'warning');
      payload.tp = { type: 'pips_from_entry', value: tpVal };
    } else if (type === 'tp_mid') {
      const tpVal = safeParseFloat(manageTpMidPips);
      if (isNaN(tpVal) || tpVal < 0) return triggerAlert('Invalid TP pips value', 'warning');
      payload.tp = { type: 'pips_from_mid', value: tpVal };
    }

    triggerAlert(`Updating position stops for ${selectedSymbol}...`, 'info');

    sendRequest('manage_position_stops', payload)
      .then(res => {
        triggerAlert(res?.message || 'Position stops updated successfully.', 'success');
      })
      .catch(err => {
        triggerAlert(`Failed to update position stops: ${err}`, 'danger');
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

  const formatPnlWithPerc = (val: number | undefined, balance: number | undefined) => {
    if (val === undefined || isNaN(val)) return '0.00% (0.00$)';
    const percent = (balance && balance > 0) ? (val / balance) * 100 : 0;
    const sign = val > 0 ? '+' : '';
    const pSign = percent > 0 ? '+' : '';
    return `%${pSign}${percent.toFixed(2)} (${sign}${val.toFixed(2)}$)`;
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
              {formatPnlWithPerc(referenceAccount?.realizedPNL, referenceAccount?.cash_value)}
            </span>
          </div>

          <div className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors ${
            theme === 'dark' ? 'bg-neutral-900/50 border-neutral-850' : 'bg-neutral-100/80 border-neutral-250'
          }`}>
            <span className={theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}>Unrealized:</span>
            <span className={`font-mono font-bold transition-all duration-300 ${refPnlPulse ? 'animate-flicker' : ''} ${
              (referenceAccount?.unrealizedPNL || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {formatPnlWithPerc(referenceAccount?.unrealizedPNL, referenceAccount?.cash_value)}
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

            {/* Redesigned Execution Cockpit */}
            <div className={`flex flex-col gap-4 pb-5 border-b ${
              theme === 'dark' ? 'border-neutral-900/60' : 'border-neutral-200/85'
            }`}>
              <div className="flex justify-between items-center px-1">
                <h2 className={`text-[10px] font-bold uppercase tracking-wider ${
                  theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'
                }`}>Execution Cockpit</h2>
                <span className={`px-1.5 py-0.2 text-[8px] rounded font-mono ${
                  theme === 'dark' ? 'bg-neutral-950 text-neutral-500 border border-neutral-900' : 'bg-neutral-200 text-neutral-600 border border-neutral-250'
                }`}>Staged Cmds</span>
              </div>

              {/* Tabs Row - Beautiful pills */}
              <div className={`grid grid-cols-3 p-1 rounded-lg border transition-all ${
                theme === 'dark' ? 'bg-neutral-950/80 border-neutral-900' : 'bg-neutral-100 border-neutral-200'
              }`}>
                {/* Entry Tab Button */}
                <button
                  onClick={() => setExecutionTab('entry')}
                  className={`py-1.5 rounded-md font-bold text-[10px] uppercase tracking-wider transition-all active:scale-95 ${
                    executionTab === 'entry'
                      ? (theme === 'dark' ? 'bg-neutral-850 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                      : (theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-500 hover:text-neutral-800')
                  }`}
                >
                  Entry
                </button>

                {/* Modify Tab Button with Amber Pulsing Badge if pending order exists */}
                <button
                  onClick={() => setExecutionTab('modify')}
                  className={`py-1.5 rounded-md font-bold text-[10px] uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-1.5 relative ${
                    executionTab === 'modify'
                      ? (theme === 'dark' ? 'bg-neutral-850 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                      : (theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-500 hover:text-neutral-800')
                  }`}
                >
                  Modify
                  {pendingOrder && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                    </span>
                  )}
                </button>

                {/* Manage Tab Button with Emerald Pulsing Badge if position exists */}
                <button
                  onClick={() => setExecutionTab('manage')}
                  className={`py-1.5 rounded-md font-bold text-[10px] uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-1.5 relative ${
                    executionTab === 'manage'
                      ? (theme === 'dark' ? 'bg-neutral-850 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                      : (theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-500 hover:text-neutral-800')
                  }`}
                >
                  Manage
                  {activePosition && (
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                  )}
                </button>
              </div>

              {/* Dynamic Target Instrument */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center px-1">
                  <label className={`text-[10px] font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Select Symbol</label>
                  {selectedSymbol && (
                    <span className="flex items-center gap-1">
                      {activePosition && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-extrabold bg-emerald-950/40 border border-emerald-900/40 text-emerald-400">POS</span>
                      )}
                      {pendingOrder && (
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-extrabold bg-amber-950/40 border border-amber-900/40 text-amber-400">ORD</span>
                      )}
                    </span>
                  )}
                </div>
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

              {executionTab === 'entry' && (
                <div className="flex flex-col gap-4">
                  {/* Mode select: Pip & %Risk | ATR & %Risk | Pending Limit */}
                  <div className={`grid grid-cols-3 gap-1 p-0.5 rounded-lg border transition-all ${
                    theme === 'dark' ? 'bg-neutral-950/40 border-neutral-900' : 'bg-neutral-100/50 border-neutral-200'
                  }`}>
                    <button
                      onClick={() => setEntryMode('pip_risk')}
                      className={`py-1 rounded-md text-[9px] font-bold uppercase transition-all ${
                        entryMode === 'pip_risk'
                          ? (theme === 'dark' ? 'bg-neutral-800 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                          : (theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-500 hover:text-neutral-800')
                      }`}
                    >
                      Pip Risk
                    </button>
                    <button
                      onClick={() => setEntryMode('atr_risk')}
                      className={`py-1 rounded-md text-[9px] font-bold uppercase transition-all ${
                        entryMode === 'atr_risk'
                          ? (theme === 'dark' ? 'bg-neutral-800 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                          : (theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-500 hover:text-neutral-800')
                      }`}
                    >
                      ATR Risk
                    </button>
                    <button
                      onClick={() => setEntryMode('pending')}
                      className={`py-1 rounded-md text-[9px] font-bold uppercase transition-all ${
                        entryMode === 'pending'
                          ? (theme === 'dark' ? 'bg-neutral-800 text-white shadow-sm' : 'bg-white text-neutral-900 shadow-sm')
                          : (theme === 'dark' ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-500 hover:text-neutral-800')
                      }`}
                    >
                      Pending
                    </button>
                  </div>

                  {/* Mode 1: Pip & %Risk Form */}
                  {entryMode === 'pip_risk' && (
                    <div className="flex flex-col gap-3">
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
                          <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Risk %</label>
                          <input
                            type="number"
                            step="0.1"
                            value={customRisk}
                            onChange={(e) => setCustomRisk(e.target.value)}
                            placeholder="Risk %"
                            className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mt-1">
                        <button
                          onClick={() => handleEntryTrade('buy', 'market', parseFloat(slPips), 0, 0, parseFloat(customRisk))}
                          className="py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wide active:scale-95 transition-all flex items-center justify-center gap-1.5"
                        >
                          <ArrowUpRight size={14} />
                          BUY MKT
                        </button>
                        <button
                          onClick={() => handleEntryTrade('sell', 'market', parseFloat(slPips), 0, 0, parseFloat(customRisk))}
                          className="py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs tracking-wide active:scale-95 transition-all flex items-center justify-center gap-1.5"
                        >
                          <ArrowDownRight size={14} />
                          SELL MKT
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Mode 2: ATR & %Risk Form */}
                  {entryMode === 'atr_risk' && (
                    <div className="flex flex-col gap-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>ATR Mult</label>
                          <input
                            type="number"
                            step="0.1"
                            value={atrMultiplier}
                            onChange={(e) => setAtrMultiplier(e.target.value)}
                            placeholder="ATR mult"
                            className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Risk %</label>
                          <input
                            type="number"
                            step="0.1"
                            value={atrRiskPerc}
                            onChange={(e) => setAtrRiskPerc(e.target.value)}
                            placeholder="Risk %"
                            className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                        </div>
                      </div>

                      {/* Volatility Details */}
                      <div className={`p-2.5 rounded-lg border text-[10px] font-mono flex flex-col gap-1.5 transition-colors ${
                        theme === 'dark' ? 'bg-[#0E0E0E] border-neutral-900 text-neutral-400' : 'bg-neutral-50 border-neutral-200 text-neutral-600'
                      }`}>
                        {atrLoading ? (
                          <div className="flex items-center justify-center gap-2 py-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
                            <span>Calculating ATR...</span>
                          </div>
                        ) : atrInfo ? (
                          <>
                            <div className="flex justify-between">
                              <span>Daily ATR 14:</span>
                              <span className="font-bold text-neutral-300 dark:text-neutral-200">{atrInfo.atr_raw.toFixed(5)} ({atrInfo.atr_pips.toFixed(1)} pips)</span>
                            </div>
                            <div className="flex justify-between border-t pt-1.5 border-neutral-800/40">
                              <span>Target SL ({atrMultiplier}x ATR):</span>
                              <span className="font-bold text-emerald-500 dark:text-emerald-400">
                                {parseFloat((atrInfo.atr_pips * safeParseFloat(atrMultiplier)).toFixed(2))} pips
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="text-center text-[9px] text-rose-450 py-1">
                            No ATR volatility loaded.
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3 mt-1">
                        <button
                          disabled={!atrInfo}
                          onClick={() => {
                            if (!atrInfo) return;
                            const calculated_atr_sl = parseFloat((atrInfo.atr_pips * safeParseFloat(atrMultiplier)).toFixed(2));
                            handleEntryTrade('buy', 'market', calculated_atr_sl, 0, 0, safeParseFloat(atrRiskPerc));
                          }}
                          className="py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs tracking-wide active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ArrowUpRight size={14} />
                          BUY MKT
                        </button>
                        <button
                          disabled={!atrInfo}
                          onClick={() => {
                            if (!atrInfo) return;
                            const calculated_atr_sl = parseFloat((atrInfo.atr_pips * safeParseFloat(atrMultiplier)).toFixed(2));
                            handleEntryTrade('sell', 'market', calculated_atr_sl, 0, 0, safeParseFloat(atrRiskPerc));
                          }}
                          className="py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs tracking-wide active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ArrowDownRight size={14} />
                          SELL MKT
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Mode 3: Pending Limit Form */}
                  {entryMode === 'pending' && (
                    <div className="flex flex-col gap-3">
                      {/* Offset Inputs */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className={`text-[9px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Buy Offset Pips</label>
                          <input
                            type="number"
                            value={entryOffsetBuy}
                            onChange={(e) => setEntryOffsetBuy(e.target.value)}
                            placeholder="Buy offset"
                            className={`w-full border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className={`text-[9px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Sell Offset Pips</label>
                          <input
                            type="number"
                            value={entryOffsetSell}
                            onChange={(e) => setEntryOffsetSell(e.target.value)}
                            placeholder="Sell offset"
                            className={`w-full border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                        </div>
                      </div>

                      {/* SL & TP Pips */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label className={`text-[9px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Stop Loss Pips</label>
                          <input
                            type="number"
                            value={limitSlPips}
                            onChange={(e) => {
                              setLimitSlPips(e.target.value);
                              const v = parseFloat(e.target.value);
                              if (!isNaN(v)) {
                                setLimitTpPips((v * 2.0).toString());
                              }
                            }}
                            placeholder="SL pips"
                            className={`w-full border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className={`text-[9px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Take Profit Pips</label>
                          <input
                            type="number"
                            value={limitTpPips}
                            onChange={(e) => setLimitTpPips(e.target.value)}
                            placeholder="TP pips"
                            className={`w-full border rounded-lg px-2.5 py-1.5 text-xs font-mono transition-all font-semibold focus:outline-none ${
                              theme === 'dark'
                                ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                                : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                            }`}
                          />
                        </div>
                      </div>

                      {/* Sizing Toggle & Input */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between items-center px-1">
                          <label className={`text-[9px] font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Sizing Mode</label>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setLimitSizingMode('risk')}
                              className={`text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded transition-all ${
                                limitSizingMode === 'risk'
                                  ? (theme === 'dark' ? 'bg-neutral-800 text-white' : 'bg-neutral-200 text-neutral-800')
                                  : 'text-neutral-500 hover:text-neutral-350'
                              }`}
                            >
                              % Risk
                            </button>
                            <button
                              onClick={() => setLimitSizingMode('lots')}
                              className={`text-[8px] uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded transition-all ${
                                limitSizingMode === 'lots'
                                  ? (theme === 'dark' ? 'bg-neutral-800 text-white' : 'bg-neutral-200 text-neutral-800')
                                  : 'text-neutral-500 hover:text-neutral-350'
                              }`}
                            >
                              Lots
                            </button>
                          </div>
                        </div>

                        <input
                          type="number"
                          step={limitSizingMode === 'risk' ? '0.1' : '0.01'}
                          value={limitSizingMode === 'risk' ? limitRiskPerc : limitLots}
                          onChange={(e) => limitSizingMode === 'risk' ? setLimitRiskPerc(e.target.value) : setLimitLots(e.target.value)}
                          placeholder={limitSizingMode === 'risk' ? 'Risk %' : 'Lots'}
                          className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                            theme === 'dark'
                              ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                              : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                          }`}
                        />
                      </div>

                      {/* Staged Execution Grid */}
                      <div className="flex flex-col gap-1.5 mt-1">
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1 text-center ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                          Staged Execution Matrix
                        </span>

                        <div className="grid grid-cols-2 gap-2 text-[9px] font-bold">
                          {/* BUY Grid */}
                          <div className="flex flex-col gap-1.5">
                            <button
                              onClick={() => handleEntryTrade('buy', 'market', safeParseFloat(limitSlPips), safeParseFloat(limitTpPips), 0, limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0, limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0)}
                              className={`py-2 rounded text-[11px] font-bold uppercase transition-all border ${
                                theme === 'dark'
                                  ? 'bg-emerald-950/40 border-emerald-800/80 hover:bg-emerald-900/50 text-emerald-300'
                                  : 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              MKT
                            </button>
                            <button
                              onClick={() => handleEntryTrade('buy', 'limit_ask', safeParseFloat(limitSlPips), safeParseFloat(limitTpPips), 0, limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0, limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0)}
                              className={`py-2 rounded text-[11px] font-bold uppercase transition-all border ${
                                theme === 'dark'
                                  ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                                  : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                              }`}
                            >
                              Limit Ask
                            </button>
                            <button
                              onClick={() => handleEntryTrade('buy', 'mid', safeParseFloat(limitSlPips), safeParseFloat(limitTpPips), 0, limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0, limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0)}
                              className={`py-2 rounded text-[11px] font-bold uppercase transition-all border ${
                                theme === 'dark'
                                  ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                                  : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                              }`}
                            >
                              MID
                            </button>
                            <button
                              onClick={() => handleEntryTrade('buy', 'join_bid', safeParseFloat(limitSlPips), safeParseFloat(limitTpPips), 0, limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0, limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0)}
                              className={`py-2 rounded text-[11px] font-bold uppercase transition-all border ${
                                theme === 'dark'
                                  ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                                  : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                              }`}
                            >
                              Join Bid
                            </button>
                            <button
                              onClick={() => handleEntryTrade('buy', 'offset_buy', safeParseFloat(limitSlPips), safeParseFloat(limitTpPips), safeParseFloat(entryOffsetBuy), limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0, limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0)}
                              className={`py-2 rounded text-[11px] font-bold uppercase transition-all border ${
                                theme === 'dark'
                                  ? 'bg-amber-950/40 border-amber-800/80 hover:bg-amber-900/50 text-amber-300'
                                  : 'bg-amber-50 border-amber-200 hover:bg-amber-100 text-amber-800'
                              }`}
                            >
                              Offset (+{entryOffsetBuy})
                            </button>
                          </div>

                          {/* SELL Grid */}
                          <div className="flex flex-col gap-1.5">
                            <button
                              onClick={() => handleEntryTrade('sell', 'market', safeParseFloat(limitSlPips), safeParseFloat(limitTpPips), 0, limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0, limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0)}
                              className={`py-2 rounded text-[11px] font-bold uppercase transition-all border ${
                                theme === 'dark'
                                  ? 'bg-rose-950/40 border-rose-800/80 hover:bg-rose-900/50 text-rose-300'
                                  : 'bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-800'
                              }`}
                            >
                              MKT
                            </button>
                            <button
                              onClick={() => handleEntryTrade('sell', 'limit_bid', safeParseFloat(limitSlPips), safeParseFloat(limitTpPips), 0, limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0, limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0)}
                              className={`py-2 rounded text-[11px] font-bold uppercase transition-all border ${
                                theme === 'dark'
                                  ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                                  : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                              }`}
                            >
                              Limit Bid
                            </button>
                            <button
                              onClick={() => handleEntryTrade('sell', 'mid', safeParseFloat(limitSlPips), safeParseFloat(limitTpPips), 0, limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0, limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0)}
                              className={`py-2 rounded text-[11px] font-bold uppercase transition-all border ${
                                theme === 'dark'
                                  ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                                  : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                              }`}
                            >
                              MID
                            </button>
                            <button
                              onClick={() => handleEntryTrade('sell', 'join_ask', safeParseFloat(limitSlPips), safeParseFloat(limitTpPips), 0, limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0, limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0)}
                              className={`py-2 rounded text-[11px] font-bold uppercase transition-all border ${
                                theme === 'dark'
                                  ? 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-200'
                                  : 'bg-neutral-100 border-neutral-200 hover:bg-neutral-200 text-neutral-800'
                              }`}
                            >
                              Join Ask
                            </button>
                            <button
                              onClick={() => handleEntryTrade('sell', 'offset_sell', safeParseFloat(limitSlPips), safeParseFloat(limitTpPips), safeParseFloat(entryOffsetSell), limitSizingMode === 'risk' ? safeParseFloat(limitRiskPerc) : 0, limitSizingMode === 'lots' ? safeParseFloat(limitLots) : 0)}
                              className={`py-2 rounded text-[11px] font-bold uppercase transition-all border ${
                                theme === 'dark'
                                  ? 'bg-amber-950/40 border-amber-800/80 hover:bg-amber-900/50 text-amber-300'
                                  : 'bg-amber-50 border-amber-200 hover:bg-amber-100 text-amber-800'
                              }`}
                            >
                              Offset (-{entryOffsetSell})
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {executionTab === 'modify' && (
                <div className="flex flex-col gap-4">
                  {pendingOrder ? (
                    <div className="flex flex-col gap-3">
                      {/* Active Pending Order Details */}
                      <div className={`p-3 rounded-lg border flex flex-col gap-2 font-semibold text-xs transition-all ${
                        theme === 'dark' ? 'bg-neutral-950/70 border-neutral-900 text-neutral-200' : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                      }`}>
                        <div className="flex justify-between items-center">
                          <span className={`${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Order Target:</span>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${
                            pendingOrder.direction === 'BUY'
                              ? 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/45 dark:text-emerald-400'
                              : 'bg-rose-950/40 text-rose-500 border border-rose-900/45 dark:text-rose-400'
                          }`}>
                            {pendingOrder.direction} {pendingOrder.orderType.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className={`${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Size / Price:</span>
                          <span className="font-mono font-bold">
                            {pendingOrder.quantity.toFixed(2)} Lots @ {pendingOrder.price.toFixed(5)}
                          </span>
                        </div>
                      </div>

                      {/* Modify Offset Input depending on direction */}
                      <div className="flex flex-col gap-1">
                        <label className={`text-[10px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                          Offset Pips
                        </label>
                        <input
                          type="number"
                          value={pendingOrder.direction === 'BUY' ? modifyOffsetBuy : modifyOffsetSell}
                          onChange={(e) => {
                            if (pendingOrder.direction === 'BUY') {
                              setModifyOffsetBuy(e.target.value);
                            } else {
                              setModifyOffsetSell(e.target.value);
                            }
                          }}
                          placeholder="Offset pips"
                          className={`w-full border rounded-lg px-3 py-2 text-xs font-mono transition-all font-semibold focus:outline-none ${
                            theme === 'dark'
                              ? 'bg-neutral-900/85 border-neutral-800 text-neutral-200 focus:border-neutral-600'
                              : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                          }`}
                        />
                      </div>

                      {/* Modify Actions Matrix */}
                      <div className="grid grid-cols-2 gap-2 text-[10px] font-bold mt-1">
                        <button
                          onClick={() => handleModifyOrder('mkt')}
                          className={`py-2 rounded border transition-all ${
                            theme === 'dark' ? 'bg-neutral-900 border-neutral-850 hover:border-neutral-700 text-neutral-200 hover:bg-neutral-800/40' : 'bg-white border-neutral-200 hover:border-neutral-350 text-neutral-800 hover:bg-neutral-50'
                          }`}
                        >
                          Move to MKT
                        </button>
                        <button
                          onClick={() => handleModifyOrder(pendingOrder.direction === 'BUY' ? 'ask' : 'bid')}
                          className={`py-2 rounded border transition-all ${
                            theme === 'dark' ? 'bg-neutral-900 border-neutral-850 hover:border-neutral-700 text-neutral-200 hover:bg-neutral-800/40' : 'bg-white border-neutral-200 hover:border-neutral-350 text-neutral-800 hover:bg-neutral-50'
                          }`}
                        >
                          Move to {pendingOrder.direction === 'BUY' ? 'Ask' : 'Bid'}
                        </button>
                        <button
                          onClick={() => handleModifyOrder('mid')}
                          className={`py-2 rounded border transition-all ${
                            theme === 'dark' ? 'bg-neutral-900 border-neutral-850 hover:border-neutral-700 text-neutral-200 hover:bg-neutral-800/40' : 'bg-white border-neutral-200 hover:border-neutral-350 text-neutral-800 hover:bg-neutral-50'
                          }`}
                        >
                          Move to MID
                        </button>
                        <button
                          onClick={() => handleModifyOrder('offset')}
                          className={`py-2 rounded border transition-all bg-amber-950/20 border-amber-900/40 hover:bg-amber-900/30 text-amber-400 font-extrabold`}
                        >
                          Move Offset
                        </button>
                      </div>

                      {/* Cancel Order */}
                      <button
                        onClick={handleCancelSelectedOrder}
                        className="w-full py-2.5 rounded-lg border border-rose-900/50 hover:bg-rose-950/30 text-rose-500 dark:text-rose-400 text-[10px] font-bold tracking-wider transition-all flex items-center justify-center gap-2 active:scale-95 mt-2"
                      >
                        <XOctagon size={12} className="animate-pulse text-rose-500" />
                        CANCEL WORKING ORDER
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {/* Elegant information card stating no pending orders */}
                      <div className={`p-4 rounded-lg border text-center transition-all ${
                        theme === 'dark' ? 'bg-neutral-950/50 border-neutral-900 text-neutral-500' : 'bg-neutral-50 border-neutral-250 text-neutral-450'
                      }`}>
                        <p className="text-xs font-semibold">No active pending order for {selectedSymbol || 'selected symbol'}</p>
                      </div>

                      {/* Quick select list of other symbols with pending orders */}
                      {referenceAccount?.orders && referenceAccount.orders.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          <span className={`text-[9px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                            Symbols with Working Orders:
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {Array.from(new Set(referenceAccount.orders.map(o => o.displaySymbol || o.symbol))).map(sym => (
                              <button
                                key={sym}
                                onClick={() => setSelectedSymbol(sym)}
                                className={`px-2.5 py-1 rounded text-[9px] font-bold border transition-all active:scale-95 ${
                                  theme === 'dark'
                                    ? 'bg-neutral-900 border-neutral-850 hover:border-neutral-700 text-neutral-300'
                                    : 'bg-white border-neutral-250 hover:border-neutral-350 text-neutral-800'
                                }`}
                              >
                                {sym}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center text-[9px] opacity-65">
                          No pending orders active across any symbol.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {executionTab === 'manage' && (
                <div className="flex flex-col gap-4">
                  {activePosition ? (
                    <div className="flex flex-col gap-3">
                      {/* Active Position Details */}
                      <div className={`p-3 rounded-lg border flex flex-col gap-2 font-semibold text-xs transition-all ${
                        theme === 'dark' ? 'bg-neutral-950/70 border-neutral-900 text-neutral-250' : 'bg-neutral-50 border-neutral-200 text-neutral-800'
                      }`}>
                        <div className="flex justify-between items-center">
                          <span className={`${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Position:</span>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${
                            activePosition.direction === 'BUY'
                              ? 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/45 dark:text-emerald-400'
                              : 'bg-rose-950/40 text-rose-500 border border-rose-900/45 dark:text-rose-400'
                          }`}>
                            {activePosition.direction} ({activePosition.quantity.toFixed(2)} Lots)
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className={`${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Avg Entry:</span>
                          <span className="font-mono font-bold">
                            {activePosition.avgPrice.toFixed(5)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center border-t pt-1.5 border-neutral-900/40">
                          <span className={`${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>Unrealized PnL:</span>
                          <span className={`font-mono font-extrabold text-xs ${(activePosition.pnl || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {formatPnlWithPerc(activePosition.pnl, referenceAccount?.cash_value)}
                          </span>
                        </div>
                      </div>

                      {/* Flatten Position MKT button */}
                      <button
                        onClick={() => handleManagePosition('flatten')}
                        className="w-full py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-extrabold tracking-wider transition-all flex items-center justify-center gap-2 active:scale-95 shadow-sm"
                      >
                        <XOctagon size={12} className="animate-pulse" />
                        FLATTEN POSITION MKT
                      </button>

                      {/* Stop Loss Controls */}
                      <div className="flex flex-col gap-2 border-t pt-2.5 border-neutral-900/40">
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1 ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                          Stop Loss Management
                        </span>
                        
                        <button
                          onClick={() => handleManagePosition('breakeven')}
                          className={`w-full py-1.5 rounded font-bold text-[9px] border transition-all active:scale-95 ${
                            theme === 'dark' ? 'bg-neutral-900 border-neutral-850 hover:border-neutral-700 text-emerald-400 hover:bg-neutral-800/40' : 'bg-white border-neutral-200 hover:border-neutral-350 text-emerald-600 font-extrabold hover:bg-neutral-50'
                          }`}
                        >
                          MOVE TO BREAKEVEN (B/E)
                        </button>

                        <div className="grid grid-cols-2 gap-2 mt-1">
                          <div className="flex flex-col gap-1">
                            <input
                              type="number"
                              value={manageSlEntryPips}
                              onChange={(e) => setManageSlEntryPips(e.target.value)}
                              placeholder="From Entry"
                              className={`w-full border rounded-lg px-2.5 py-1.5 text-[11px] font-mono transition-all font-semibold focus:outline-none ${
                                theme === 'dark'
                                  ? 'bg-neutral-900/85 border-neutral-850 text-neutral-250 focus:border-neutral-600'
                                  : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                              }`}
                            />
                            <button
                              onClick={() => handleManagePosition('sl_entry')}
                              className="py-1 rounded bg-neutral-900 hover:bg-neutral-850 text-neutral-300 text-[8px] font-bold uppercase border border-neutral-850 active:scale-95 transition-all"
                            >
                              SL from Entry
                            </button>
                          </div>

                          <div className="flex flex-col gap-1">
                            <input
                              type="number"
                              value={manageSlMidPips}
                              onChange={(e) => setManageSlMidPips(e.target.value)}
                              placeholder="From Mid"
                              className={`w-full border rounded-lg px-2.5 py-1.5 text-[11px] font-mono transition-all font-semibold focus:outline-none ${
                                theme === 'dark'
                                  ? 'bg-neutral-900/85 border-neutral-855 text-neutral-250 focus:border-neutral-600'
                                  : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                              }`}
                            />
                            <button
                              onClick={() => handleManagePosition('sl_mid')}
                              className="py-1 rounded bg-neutral-900 hover:bg-neutral-850 text-neutral-300 text-[8px] font-bold uppercase border border-neutral-855 active:scale-95 transition-all"
                            >
                              SL from Mid
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Take Profit Controls */}
                      <div className="flex flex-col gap-2 border-t pt-2.5 border-neutral-900/40">
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1 ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                          Take Profit Management
                        </span>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1">
                            <input
                              type="number"
                              value={manageTpEntryPips}
                              onChange={(e) => setManageTpEntryPips(e.target.value)}
                              placeholder="From Entry"
                              className={`w-full border rounded-lg px-2.5 py-1.5 text-[11px] font-mono transition-all font-semibold focus:outline-none ${
                                theme === 'dark'
                                  ? 'bg-neutral-900/85 border-neutral-850 text-neutral-250 focus:border-neutral-600'
                                  : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                              }`}
                            />
                            <button
                              onClick={() => handleManagePosition('tp_entry')}
                              className="py-1 rounded bg-neutral-900 hover:bg-neutral-850 text-neutral-300 text-[8px] font-bold uppercase border border-neutral-850 active:scale-95 transition-all"
                            >
                              TP from Entry
                            </button>
                          </div>

                          <div className="flex flex-col gap-1">
                            <input
                              type="number"
                              value={manageTpMidPips}
                              onChange={(e) => setManageTpMidPips(e.target.value)}
                              placeholder="From Mid"
                              className={`w-full border rounded-lg px-2.5 py-1.5 text-[11px] font-mono transition-all font-semibold focus:outline-none ${
                                theme === 'dark'
                                  ? 'bg-neutral-900/85 border-neutral-850 text-neutral-250 focus:border-neutral-600'
                                  : 'bg-white border-neutral-200 text-neutral-800 focus:border-neutral-400'
                              }`}
                            />
                            <button
                              onClick={() => handleManagePosition('tp_mid')}
                              className="py-1 rounded bg-neutral-900 hover:bg-neutral-850 text-neutral-300 text-[8px] font-bold uppercase border border-neutral-850 active:scale-95 transition-all"
                            >
                              TP from Mid
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {/* Elegant information card stating no positions open */}
                      <div className={`p-4 rounded-lg border text-center transition-all ${
                        theme === 'dark' ? 'bg-neutral-950/50 border-neutral-900 text-neutral-500' : 'bg-neutral-50 border-neutral-250 text-neutral-450'
                      }`}>
                        <p className="text-xs font-semibold">No active position for {selectedSymbol || 'selected symbol'}</p>
                      </div>

                      {/* Quick select list of other symbols with open positions */}
                      {referenceAccount?.positions && referenceAccount.positions.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          <span className={`text-[9px] px-1 font-bold ${theme === 'dark' ? 'text-neutral-500' : 'text-neutral-450'}`}>
                            Symbols with Active Positions:
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {Array.from(new Set(referenceAccount.positions.map(p => p.displaySymbol || p.symbol))).map(sym => (
                              <button
                                key={sym}
                                onClick={() => setSelectedSymbol(sym)}
                                className={`px-2.5 py-1 rounded text-[9px] font-bold border transition-all active:scale-95 ${
                                  theme === 'dark'
                                    ? 'bg-neutral-900 border-neutral-850 hover:border-neutral-700 text-neutral-300'
                                    : 'bg-white border-neutral-250 hover:border-neutral-350 text-neutral-800'
                                }`}
                              >
                                {sym}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="text-center text-[9px] opacity-65">
                          No active positions across any symbol.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
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
                        {formatPnlWithPerc(activePositionsTotalPnL, referenceAccount?.cash_value)}
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
                                {formatPnlWithPerc(pos.pnl, referenceAccount?.cash_value)}
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
                                {formatPnlWithPerc(acc.realizedPNL, acc.cash_value)}
                              </td>
                              <td className={`py-2.5 px-3 text-right font-mono text-xs font-semibold transition-all duration-300 ${
                                farmPnlPulse[acc.id] ? 'animate-flicker' : ''
                              } ${
                                pnlVal >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                              }`}>
                                {formatPnlWithPerc(acc.unrealizedPNL, acc.cash_value)}
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

